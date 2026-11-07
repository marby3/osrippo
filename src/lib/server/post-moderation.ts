// 質疑・答弁・補足の通報と非表示（設計書 docs/spec/80.md）。受け取る値の形は呼ぶ側が確かめる
import { and, count, desc, eq, inArray, isNotNull, ne, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { billModerationLogs, bills, postReports, posts } from '../db/schema';
import { PAGE_SIZE } from '../domain/issues';
import { LIMITS } from '../domain/limits';
import { countsTowardHide, HIDE_THRESHOLD, isHidden, POST_HIDDEN, type HideReason, type IssueStatus, type SolutionReportReason } from '../domain/reports';
import { staffRoleOf } from './chairs';
import { refuse, type Actor } from './issues';
import type { Db } from './law';
import { notify } from './notifications';
import { POST_HIDDEN_SQL } from './post-status';
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
		.select({ id: posts.id, billId: posts.billId, userId: posts.userId, status: posts.status, parentStatus: parent.status })
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
	if (!post || post.billId !== target.billId) return { ok: false as const, reason: 'missing' as const };
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
	if (!post) return 'missing';
	if (post.userId === staff.userId) return 'own';
	return (await involvedInBill(db, post.billId, staff.userId, staff.role)) ? 'involved' : 'ok';
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
		rows: rows.slice(0, PAGE_SIZE).map(({ amendmentId, kind, ...r }) => ({ ...r, kind: amendmentId !== null || kind === null ? ('amendment' as const) : kind })),
		hasNext: rows.length > PAGE_SIZE
	};
}
