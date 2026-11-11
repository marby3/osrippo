// 質疑・答弁・補足の通報と非表示（設計書 docs/spec/80.md）。受け取る値の形は呼ぶ側が確かめる
import { and, count, desc, eq, gt, inArray, isNotNull, ne, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { billModerationLogs, bills, postReports, posts } from '../db/schema';
import { billProgress, referralSession } from '../domain/bills';
import { evaluationOpen } from '../domain/evaluations';
import { PAGE_SIZE } from '../domain/issues';
import { QUESTION_PAGE_SIZE } from '../domain/posts';
import { LIMITS } from '../domain/limits';
import { countsTowardHide, HIDE_THRESHOLD, isHidden, POST_HIDDEN, POST_SHOWN, type HideReason, type IssueStatus, type SolutionReportReason } from '../domain/reports';
import { staffRoleOf } from './chairs';
import { refuse, type Actor } from './issues';
import type { BatchDb, Db } from './law';
import { notify } from './notifications';
import { POST_HIDDEN_SQL, POST_SHOWN_SQL } from './post-status';
import { reportsInDay, type Role } from './reports';
import { involvedInBill, involvedSql, partyToBill } from './results';

type Staff = { userId: string; role: Role };
type PostStatus = (typeof posts.status.enumValues)[number];

/** 投稿を書いた人 */
const postAuthor = (postId: number) => sql`SELECT user_id FROM posts WHERE id = ${postId}`;

/** 投稿の法案、書いた人、状態、親の質疑の状態 */
export async function postMeta(db: Db, postId: number) {
	const parent = alias(posts, 'parent');
	const [row] = await db
		.select({ id: posts.id, billId: posts.billId, sessionKey: posts.sessionKey, kind: posts.kind, userId: posts.userId, status: posts.status, parentStatus: parent.status })
		.from(posts)
		.leftJoin(parent, eq(parent.id, posts.parentId))
		.where(eq(posts.id, postId));
	return row ?? null;
}

/**
 * 通報する（決定B〜D）。投稿がその法案のものか → 自分のもの → 状態 → 2回目 → 上限 → 保存。
 * 数に入れるかは通報のときに決める（投稿は発議のあとにしか書けず、賛同と共同提出者の増減は下書きのあいだだけなので、あとで関わりは変わらない）
 */
export async function reportPost(db: Db, actor: Actor, target: { id: number; billId: number }, value: { reason: SolutionReportReason; note: string | null }, now: number) {
	const post = await postMeta(db, target.id);
	// まとめられた質疑は行がないのと同じ（docs/spec/104.md）
	if (!post || post.billId !== target.billId || post.status === 'merged') return { ok: false as const, reason: 'missing' as const };
	if (post.userId === actor.userId) return { ok: false as const, reason: 'own' as const };
	if (isHidden(post.status) || (post.parentStatus !== null && isHidden(post.parentStatus))) return { ok: false as const, reason: 'hidden' as const };
	const mine = and(eq(postReports.postId, target.id), eq(postReports.userId, actor.userId));
	if ((await db.select({ id: postReports.id }).from(postReports).where(mine)).length > 0) return { ok: true as const, already: true };
	if ((await reportsInDay(db, actor.userId, now)) >= LIMITS.reportPerDay) return { ...(await refuse(db, actor, { kind: 'report-day' }, now)), reason: 'limit' as const };

	const counted = countsTowardHide(value.reason, actor.registeredAt, now) && !(await partyToBill(db, post.billId, actor.userId));
	const inserted = await db
		.insert(postReports)
		.values({ postId: target.id, userId: actor.userId, reason: value.reason, note: value.note, counted, createdAt: now })
		.onConflictDoNothing()
		.returning({ id: postReports.id });
	if (inserted.length === 0) return { ok: true as const, already: true };

	// 数に入る通報が3件以上で、表示中（visible）の投稿だけを自動で非表示にする。記録はトリガーが書く
	const hidden = await db
		.update(posts)
		.set({ status: 'auto_hidden', statusActor: 'auto', statusActorUserId: null, statusReason: 'reports', statusNote: null, statusChangedAt: now })
		.where(and(eq(posts.id, target.id), eq(posts.status, 'visible'), sql`(SELECT count(*) FROM ${postReports} WHERE ${postReports.postId} = ${target.id} AND ${postReports.counted} = 1) >= ${HIDE_THRESHOLD}`))
		.returning({ id: posts.id });
	if (hidden.length) await notify(db, postAuthor(target.id), 'post_hidden', target.id, now, now);
	return { ok: true as const, already: false };
}

/** 運営の操作。from のどれかの状態のときだけ to に変え、変わったら true。記録はトリガーが書く */
export async function changePostStatus(db: Db, postId: number, from: IssueStatus[], to: 'hidden' | 'restored', staff: Staff, reason: HideReason | null, note: string, now: number) {
	const changed = await db
		.update(posts)
		.set({ status: to, statusActor: staff.role, statusActorUserId: staff.userId, statusReason: reason, statusNote: note, statusChangedAt: now })
		.where(and(eq(posts.id, postId), inArray(posts.status, from as PostStatus[])))
		.returning({ id: posts.id });
	if (!changed.length) return false;
	await notify(db, postAuthor(postId), to === 'hidden' ? 'post_hidden' : 'post_restored', postId, now, now);
	return true;
}

/** その投稿を扱えるか：ない番号、自分のもの、関わった法案（決定O） */
export async function postStaffAccess(db: Db, postId: number, staff: Staff): Promise<'missing' | 'own' | 'involved' | 'ok'> {
	const post = await postMeta(db, postId);
	if (!post || post.status === 'merged') return 'missing';
	if (post.userId === staff.userId) return 'own';
	return (await involvedInBill(db, post.billId, staff.userId, staff.role)) ? 'involved' : 'ok';
}

const shownPost = (status: PostStatus) => (POST_SHOWN as readonly string[]).includes(status);
/** visible で通報を受けている質疑は統合先にできない（まだだれも確認していないので）。t は統合先の別名 */
const notUnderReport = (t: ReturnType<typeof sql>) => sql`(${t}.status <> 'visible' OR NOT EXISTS (SELECT 1 FROM post_reports r WHERE r.post_id = ${t}.id))`;

/** 法案の3週目と4週目で、元の質疑がいまの会期のものか（docs/spec/104.md の決定R） */
async function mergeWindowOf(db: Db, source: { billId: number; sessionKey: string }, now: number, minutes: number | null) {
	const [bill] = await db.select({ status: bills.status, proposedAt: bills.proposedAt }).from(bills).where(eq(bills.id, source.billId));
	if (!bill || bill.proposedAt === null) return false;
	return evaluationOpen(billProgress(bill, now, minutes)) && referralSession(bill.proposedAt, minutes).key === source.sessionKey;
}

/** その質疑をいままとめられる時期か（運営の画面の候補を出すかに使う） */
export async function mergeWindowOpen(db: Db, sourceId: number, now: number, minutes: number | null) {
	const source = await postMeta(db, sourceId);
	return source !== null && (await mergeWindowOf(db, source, now, minutes));
}

/** まとめられるかを確かめる。順は 元の存在 → 元が自分のもの → 関わり → 統合先が自分のもの → 時期 → 状態（docs/spec/104.md） */
export async function checkMerge(db: Db, sourceId: number, targetId: number, staff: Staff, now: number, minutes: number | null): Promise<'ok' | 'missing' | 'own' | 'involved' | 'ownTarget' | 'closed' | 'invalid'> {
	const source = await postMeta(db, sourceId);
	if (!source || source.status === 'merged') return 'missing';
	if (source.userId === staff.userId) return 'own';
	if (await involvedInBill(db, source.billId, staff.userId, staff.role)) return 'involved';
	const target = await postMeta(db, targetId);
	if (target?.userId === staff.userId) return 'ownTarget';
	if (!(await mergeWindowOf(db, source, now, minutes))) return 'closed';
	if (!target || sourceId === targetId || source.kind !== 'question' || target.kind !== 'question' || target.billId !== source.billId || target.sessionKey !== source.sessionKey) return 'invalid';
	if (!shownPost(source.status) || !shownPost(target.status)) return 'invalid';
	if (target.status === 'visible') {
		const [report] = await db.select({ id: postReports.id }).from(postReports).where(eq(postReports.postId, targetId)).limit(1);
		if (report) return 'invalid';
	}
	return 'ok';
}

/**
 * 元の質疑を統合先へまとめる。変わったら true。1つのトランザクションで、(a) 元の行を merged に、(b) 元にまとめられていた行を統合先へ、(c) 答弁と補足を統合先へ。
 * (a) に元と統合先の今の状態を入れる（A→B と B→A が同時でも循環しない）。(b)(c) は「元が今 merged で統合先がこれ」のときだけ当たる。記録はトリガーが書く。元に戻せない
 */
export async function mergeQuestion(db: BatchDb, sourceId: number, targetId: number, staff: Staff, note: string, now: number) {
	const mergedHere = sql`EXISTS (SELECT 1 FROM posts s WHERE s.id = ${sourceId} AND s.status = 'merged' AND s.merged_into = ${targetId})`;
	const results = (await db.batch([
		db
			.update(posts)
			.set({ status: 'merged', mergedInto: targetId, statusActor: staff.role, statusActorUserId: staff.userId, statusReason: null, statusNote: note, statusChangedAt: now })
			.where(
				and(
					eq(posts.id, sourceId),
					eq(posts.kind, 'question'),
					inArray(posts.status, POST_SHOWN),
					sql`EXISTS (SELECT 1 FROM posts t WHERE t.id = ${targetId} AND t.id <> ${sourceId} AND t.kind = 'question' AND t.status IN (${POST_SHOWN_SQL}) AND t.bill_id = ${posts}.bill_id AND t.session_key = ${posts}.session_key AND ${notUnderReport(sql`t`)})`
				)
			)
			.returning({ id: posts.id }),
		db
			.update(posts)
			.set({ mergedInto: targetId })
			.where(and(eq(posts.mergedInto, sourceId), eq(posts.status, 'merged'), mergedHere)),
		db
			.update(posts)
			.set({ parentId: targetId })
			.where(and(eq(posts.parentId, sourceId), mergedHere))
	] as never)) as unknown as unknown[][];
	if (results[0].length === 0) return false;
	await notify(db, postAuthor(sourceId), 'question_merged', sourceId, now, now);
	return true;
}

/** まとめる先の候補：同じ法案と会期の表示中の質疑。元、見ている人の質疑、通報を受けて未確認の質疑を除く。新しい順に50件 */
export async function mergeCandidates(db: Db, sourceId: number, staff: Staff) {
	const source = await postMeta(db, sourceId);
	if (!source || source.kind !== 'question' || !shownPost(source.status)) return [];
	return db
		.select({ id: posts.id, body: posts.body })
		.from(posts)
		.where(and(eq(posts.billId, source.billId), eq(posts.sessionKey, source.sessionKey), eq(posts.kind, 'question'), inArray(posts.status, POST_SHOWN), ne(posts.id, sourceId), ne(posts.userId, staff.userId), notUnderReport(sql`${posts}`)))
		.orderBy(desc(posts.id))
		.limit(50);
}

/** 質疑のタブの「まとめられた質疑」の欄：書いた本人にだけ、元の本文と統合先へのリンク。統合先が非表示なら href は null。新しい順 */
export async function mergedPostsFor(db: Db, billId: number, userId: string | null) {
	if (userId === null) return [];
	const target = alias(posts, 'target');
	const rows = await db
		.select({ id: posts.id, body: posts.body, targetId: target.id, targetStatus: target.status })
		.from(posts)
		.innerJoin(target, eq(target.id, posts.mergedInto))
		.where(and(eq(posts.billId, billId), eq(posts.userId, userId), eq(posts.status, 'merged')))
		.orderBy(desc(posts.id));
	// 同じ統合先は1回だけ数える
	const newerOf = new Map<number, Promise<number>>();
	const newerThan = (targetId: number) => {
		const known = newerOf.get(targetId);
		if (known) return known;
		const counted = db
			.select({ n: count() })
			.from(posts)
			.where(and(eq(posts.billId, billId), eq(posts.kind, 'question'), inArray(posts.status, POST_SHOWN), gt(posts.id, targetId)))
			.then(([row]) => row.n);
		newerOf.set(targetId, counted);
		return counted;
	};
	return Promise.all(
		rows.map(async ({ id, body, targetId, targetStatus }) => {
			if (!shownPost(targetStatus)) return { id, body, href: null };
			// 統合先より新しい表示中の質疑の数からページを求める（一覧は新しい順）
			const page = Math.floor((await newerThan(targetId)) / QUESTION_PAGE_SIZE) + 1;
			return { id, body, href: `/houan/${billId}/shitsugi${page > 1 ? `?page=${page}` : ''}#shitsugi-${targetId}` };
		})
	);
}

/** その法案を運営として見られるか：運営の画面の権限があり、関わっていない（決定H） */
export async function staffOnBill(db: Db, billId: number, userId: string, now: number, minutes: number | null) {
	const role = await staffRoleOf(db, userId, now, minutes);
	return role !== null && !(await involvedInBill(db, billId, userId, role));
}

/**
 * 運営の画面の一覧：通報を受けた投稿（と focus の投稿）。自動で非表示が先、その中は最後の通報が新しい順に100件。
 * 自分のものと関わった法案は100件に絞る前に SQL で除く（本文も通報の文面も渡さない。決定N）。書いた人は渡さない
 */
export async function reportedPosts(db: Db, staff: Staff, focus: number | null) {
	const reasonCount = (r: SolutionReportReason) => sql<number>`coalesce(sum(case when ${postReports.reason} = ${r} then 1 else 0 end), 0)`;
	const rows = await db
		.select({
			id: posts.id,
			kind: posts.kind,
			body: posts.body,
			status: posts.status,
			billId: posts.billId,
			billTitle: bills.title,
			total: count(postReports.id),
			counted: sql<number>`coalesce(sum(${postReports.counted}), 0)`,
			attack: reasonCount('attack'),
			spam: reasonCount('spam'),
			other: reasonCount('other'),
			none: reasonCount('none'),
			afterRestore: sql<number>`coalesce(sum(case when ${posts.status} = 'restored' and ${postReports.createdAt} > ${posts.statusChangedAt} then 1 else 0 end), 0)`,
			parentHidden: sql<number | null>`(SELECT q.status FROM posts q WHERE q.id = ${posts}.parent_id) IN (${POST_HIDDEN_SQL})`
		})
		.from(posts)
		.innerJoin(bills, eq(bills.id, posts.billId))
		.leftJoin(postReports, eq(postReports.postId, posts.id))
		// 投稿の総数ではなく、通報された投稿の数だけ読む
		.where(
			and(
				or(inArray(posts.id, db.selectDistinct({ id: postReports.postId }).from(postReports)), focus === null ? undefined : eq(posts.id, focus)),
				ne(posts.userId, staff.userId),
				ne(posts.status, 'merged'),
				sql`NOT ${involvedSql(staff.userId, staff.role)}`
			)
		)
		.groupBy(posts.id)
		.orderBy(desc(sql`${posts.id} = ${focus ?? -1}`), desc(sql`${posts.status} = 'auto_hidden'`), desc(sql`max(${postReports.createdAt})`), desc(posts.id))
		.limit(100);
	// 番号は JSON の1つの値で渡す（D1 は1文に100個までしか値を結び付けられない）
	const notes = rows.length
		? await db
				.select({ postId: postReports.postId, note: postReports.note })
				.from(postReports)
				.where(and(sql`post_id IN (SELECT value FROM json_each(${JSON.stringify(rows.map((r) => r.id))}))`, isNotNull(postReports.note)))
				.orderBy(desc(postReports.createdAt), desc(postReports.id))
		: [];
	return rows.map((r) => ({ ...r, parentHidden: Boolean(r.parentHidden), notes: notes.filter((n) => n.postId === r.id).map((n) => n.note as string) }));
}

/**
 * その人がその法案で通報した投稿の番号（通報済みの表示に使う）。
 * カードの件数に上限がないので、1ページの番号を IN に並べない（D1 の値100個の上限に当たり、本番のタブだけが落ちる）
 */
export async function reportedPostIds(db: Db, userId: string | null, billId: number) {
	if (userId === null) return [];
	const rows = await db
		.select({ id: postReports.postId })
		.from(postReports)
		.innerJoin(posts, eq(posts.id, postReports.postId))
		.where(and(eq(postReports.userId, userId), eq(posts.billId, billId)));
	return rows.map((r) => r.id);
}

/**
 * 質疑のタブの「非表示の投稿」の欄（決定E・H）。staffHere なら法案の非表示の投稿を全部、そうでなければ自分のもの。
 * 親の質疑が非表示の答弁と補足は、書いた本人にだけ返す（質疑の中身は返さない）。新しい順
 */
export async function hiddenPostsFor(db: Db, billId: number, userId: string | null, staffHere: boolean) {
	if (userId === null) return [];
	const parent = alias(posts, 'parent');
	const hiddenSelf = inArray(posts.status, POST_HIDDEN);
	const rows = await db
		.select({ id: posts.id, kind: posts.kind, body: posts.body, status: posts.status, statusReason: posts.statusReason, userId: posts.userId, parentStatus: parent.status })
		.from(posts)
		.leftJoin(parent, eq(parent.id, posts.parentId))
		.where(and(eq(posts.billId, billId), or(staffHere ? hiddenSelf : and(hiddenSelf, eq(posts.userId, userId)), and(eq(posts.userId, userId), inArray(parent.status, POST_HIDDEN)))))
		.orderBy(desc(posts.id));
	return rows.map(({ userId: author, parentStatus, ...r }) => ({
		...r,
		mine: author === userId,
		// 自分の投稿も非表示なら、自分の投稿の理由だけを出す
		parentHidden: !isHidden(r.status) && parentStatus !== null && isHidden(parentStatus)
	}));
}

/** 公開の記録：投稿と修正案の対応。新しい順に50件ごと。本文、書いた人、対応した人の ID、番号は返さない */
export async function billModerationLogPage(db: Db, page: number) {
	const rows = await db
		.select({
			id: billModerationLogs.id,
			billId: billModerationLogs.billId,
			title: bills.title,
			kind: posts.kind,
			amendmentId: billModerationLogs.amendmentId,
			commentaryId: billModerationLogs.commentaryId,
			action: billModerationLogs.action,
			actor: billModerationLogs.actor,
			reason: billModerationLogs.reason,
			note: billModerationLogs.note,
			createdAt: billModerationLogs.createdAt
		})
		.from(billModerationLogs)
		.innerJoin(bills, eq(bills.id, billModerationLogs.billId))
		.leftJoin(posts, eq(posts.id, billModerationLogs.postId))
		.orderBy(desc(billModerationLogs.id))
		.limit(PAGE_SIZE + 1)
		.offset((page - 1) * PAGE_SIZE);
	return {
		rows: rows.slice(0, PAGE_SIZE).map(({ amendmentId, commentaryId, kind, ...r }) => ({
			...r,
			// 専門家の解説への対応（Issue #152）
			kind: commentaryId !== null ? ('commentary' as const) : amendmentId !== null || kind === null ? ('amendment' as const) : kind
		})),
		hasNext: rows.length > PAGE_SIZE
	};
}
