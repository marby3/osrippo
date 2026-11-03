// 解決策の DB（設計書 docs/spec/34.md）
import { and, count, countDistinct, desc, eq, gt, inArray, isNotNull, ne, or, sql } from 'drizzle-orm';
import { actions, issues, solutionReactions, solutionReports, solutions } from '../db/schema';
import { checkSolutionPost, checkSupport, DAY, LIMITS } from '../domain/limits';
import {
	countsTowardHide,
	HIDE_THRESHOLD,
	LISTED,
	type HideReason,
	type IssueStatus,
	type SolutionReportReason
} from '../domain/reports';
import type { Reaction } from '../domain/solutions';
import { PRESS_KINDS, refuse, type Actor } from './issues';
import type { Db } from './law';
import { reportsInDay, type Role } from './reports';
import { indexTexts } from './search';

/** 表示中の解決策の状態（解決策には merged がない） */
const SHOWN = ['visible', 'restored'] as const;

/** 解決策を書く。上限を確かめ、課題が一覧に出る状態のときだけ1文で入れる（設計書 決めたこと1・2） */
export async function createSolution(db: Db, actor: Actor, issueId: number, body: string, now: number) {
	const since = now - DAY;
	const mine = await db
		.select({ at: actions.createdAt })
		.from(actions)
		.where(and(eq(actions.userId, actor.userId), eq(actions.kind, 'solution_post'), gt(actions.createdAt, since)));
	const [ip] = await db
		.select({ n: count() })
		.from(actions)
		.where(and(eq(actions.ipHash, actor.ipHash), eq(actions.kind, 'solution_post'), gt(actions.createdAt, since)));
	const refusal = checkSolutionPost(
		{ accountPostTimes: mine.map((r) => r.at), ipPosts: ip.n, registeredAt: actor.registeredAt },
		now
	);
	if (refusal) return refuse(db, actor, refusal, now);

	// 画面を開いてから送るまでに統合・非表示になっても、元の課題に解決策が残って見えなくならないように
	const rows = await db.all<{ id: number }>(sql`
		INSERT INTO ${solutions} (issue_id, user_id, body, created_at)
		SELECT ${issueId}, ${actor.userId}, ${body}, ${now}
		WHERE EXISTS (SELECT 1 FROM issues WHERE id = ${issueId} AND status IN (${sql.join(
			LISTED.map((s) => sql`${s}`),
			sql`, `
		)}))
		RETURNING id`);
	if (rows.length === 0) return { ok: true as const, created: false as const };
	// 全文検索の行（設計書 docs/spec/38.md「行の作り方」）
	await indexTexts(db, 'solution', rows[0].id, [body]);
	await db
		.insert(actions)
		.values({ kind: 'solution_post', userId: actor.userId, ipHash: actor.ipHash, targetId: rows[0].id, createdAt: now });
	return { ok: true as const, created: true as const, id: rows[0].id };
}

const reactionCount = (kind: Reaction) =>
	sql<number>`(SELECT count(*) FROM ${solutionReactions} WHERE ${solutionReactions.solutionId} = ${solutions.id} AND ${solutionReactions.kind} = ${kind})`;
const pressedBy = (kind: Reaction, userId: string | null) =>
	userId === null
		? sql<number>`0`
		: sql<number>`EXISTS (SELECT 1 FROM ${solutionReactions} WHERE ${solutionReactions.solutionId} = ${solutions.id} AND ${solutionReactions.kind} = ${kind} AND ${solutionReactions.userId} = ${userId})`;

/** 課題の解決策：「わかる」の多い順、同じなら新しい順（設計書 決めたこと3・4） */
export async function listSolutions(db: Db, issueId: number, userId: string | null, limit: number, offset = 0) {
	const support = reactionCount('support');
	const rows = await db
		.select({
			id: solutions.id,
			body: solutions.body,
			userId: solutions.userId,
			support,
			changed: reactionCount('changed'),
			mySupport: pressedBy('support', userId),
			myChanged: pressedBy('changed', userId)
		})
		.from(solutions)
		// 非表示の解決策は出さない（本人・運営には listHiddenSolutions で別に出す。設計書 docs/spec/36.md 決めたこと4）
		.where(and(eq(solutions.issueId, issueId), inArray(solutions.status, SHOWN)))
		.orderBy(desc(support), desc(solutions.id))
		.limit(limit)
		.offset(offset);
	// 書いた人は渡さず、自分の解決策かどうかだけを渡す
	return rows.map(({ userId: author, mySupport, myChanged, ...r }) => ({
		...r,
		mine: userId !== null && author === userId,
		pressed: { support: Boolean(mySupport), changed: Boolean(myChanged) }
	}));
}

/** 表示中の解決策の数 */
export async function solutionCount(db: Db, issueId: number) {
	const [row] = await db
		.select({ n: count() })
		.from(solutions)
		.where(and(eq(solutions.issueId, issueId), inArray(solutions.status, SHOWN)));
	return row.n;
}

export async function solutionMeta(db: Db, id: number) {
	const [row] = await db
		.select({ issueId: solutions.issueId, userId: solutions.userId, status: solutions.status })
		.from(solutions)
		.where(eq(solutions.id, id));
	return row ?? null;
}

/** 本人と運営に見せる非表示の解決策：運営なら全部、本人なら自分のもの。新しい順（設計書 docs/spec/36.md 決めたこと4） */
export async function listHiddenSolutions(db: Db, issueId: number, userId: string | null, staff: boolean) {
	if (userId === null) return [];
	const rows = await db
		.select({
			id: solutions.id,
			body: solutions.body,
			status: solutions.status,
			statusReason: solutions.statusReason,
			support: reactionCount('support'),
			changed: reactionCount('changed')
		})
		.from(solutions)
		.where(
			and(
				eq(solutions.issueId, issueId),
				inArray(solutions.status, ['auto_hidden', 'hidden']),
				staff ? undefined : eq(solutions.userId, userId)
			)
		)
		.orderBy(desc(solutions.id));
	return rows;
}

/** 本人と運営に見せる非表示の解決策が、1つでもあるか（課題のページのリンクに使う） */
export async function hasHiddenSolutions(db: Db, issueId: number, userId: string | null, staff: boolean) {
	if (userId === null) return false;
	const [row] = await db
		.select({ id: solutions.id })
		.from(solutions)
		.where(
			and(
				eq(solutions.issueId, issueId),
				inArray(solutions.status, ['auto_hidden', 'hidden']),
				staff ? undefined : eq(solutions.userId, userId)
			)
		)
		.limit(1);
	return Boolean(row);
}

/** その人が通報した解決策の番号（通報済みの表示に使う） */
export async function reportedSolutionIds(db: Db, userId: string | null, ids: number[]) {
	if (userId === null || ids.length === 0) return [];
	const rows = await db
		.select({ id: solutionReports.solutionId })
		.from(solutionReports)
		.where(and(eq(solutionReports.userId, userId), inArray(solutionReports.solutionId, ids)));
	return rows.map((r) => r.id);
}

/** 解決策を通報する。2回目は何もせず already。保存したら自動非表示を確かめる（設計書 docs/spec/36.md 決めたこと2・3） */
export async function reportSolution(
	db: Db,
	actor: Actor,
	solutionId: number,
	value: { reason: SolutionReportReason; note: string | null },
	now: number
) {
	if ((await reportedSolutionIds(db, actor.userId, [solutionId])).length > 0) return { ok: true as const, already: true };
	if ((await reportsInDay(db, actor.userId, now)) >= LIMITS.reportPerDay) return refuse(db, actor, { kind: 'report-day' }, now);
	const inserted = await db
		.insert(solutionReports)
		.values({
			solutionId,
			userId: actor.userId,
			reason: value.reason,
			note: value.note,
			counted: countsTowardHide(value.reason, actor.registeredAt, now),
			createdAt: now
		})
		.onConflictDoNothing()
		.returning({ id: solutionReports.id });
	if (inserted.length === 0) return { ok: true as const, already: true };
	// 数に入る通報が3件以上で、表示中（visible）の解決策だけを自動で非表示にする。記録はトリガーが書く
	await db
		.update(solutions)
		.set({
			status: 'auto_hidden',
			statusActor: 'auto',
			statusActorUserId: null,
			statusReason: 'reports',
			statusNote: null,
			statusChangedAt: now
		})
		.where(
			and(
				eq(solutions.id, solutionId),
				eq(solutions.status, 'visible'),
				sql`(SELECT count(*) FROM ${solutionReports} WHERE ${solutionReports.solutionId} = ${solutionId} AND ${solutionReports.counted} = 1) >= ${HIDE_THRESHOLD}`
			)
		);
	return { ok: true as const, already: false };
}

/** 運営の操作。from のどれかの状態のときだけ to に変え、変わったら true。記録はトリガーが書く */
export async function changeSolutionStatus(
	db: Db,
	solutionId: number,
	from: IssueStatus[],
	to: 'hidden' | 'restored',
	staff: { userId: string; role: Role },
	reason: HideReason | null,
	note: string,
	now: number
) {
	const changed = await db
		.update(solutions)
		.set({
			status: to,
			statusActor: staff.role,
			statusActorUserId: staff.userId,
			statusReason: reason,
			statusNote: note,
			statusChangedAt: now
		})
		.where(and(eq(solutions.id, solutionId), inArray(solutions.status, from as ('visible' | 'auto_hidden' | 'hidden' | 'restored')[])))
		.returning({ id: solutions.id });
	return changed.length > 0;
}

/** 運営の画面：通報を受けた解決策（と focus の解決策）。自動で非表示が先、その中は最後の通報が新しい順に100件 */
export async function reportedSolutions(db: Db, focus: number | null) {
	const reasonCount = (r: SolutionReportReason) =>
		sql<number>`coalesce(sum(case when ${solutionReports.reason} = ${r} then 1 else 0 end), 0)`;
	const rows = await db
		.select({
			id: solutions.id,
			body: solutions.body,
			userId: solutions.userId,
			status: solutions.status,
			issueId: solutions.issueId,
			issueTitle: issues.title,
			total: count(solutionReports.id),
			counted: sql<number>`coalesce(sum(${solutionReports.counted}), 0)`,
			attack: reasonCount('attack'),
			spam: reasonCount('spam'),
			other: reasonCount('other'),
			none: reasonCount('none'),
			afterRestore: sql<number>`coalesce(sum(case when ${solutions.status} = 'restored' and ${solutionReports.createdAt} > ${solutions.statusChangedAt} then 1 else 0 end), 0)`
		})
		.from(solutions)
		.innerJoin(issues, eq(issues.id, solutions.issueId))
		.leftJoin(solutionReports, eq(solutionReports.solutionId, solutions.id))
		// 解決策の総数ではなく、通報された解決策の数だけ読む
		.where(
			or(
				inArray(solutions.id, db.selectDistinct({ id: solutionReports.solutionId }).from(solutionReports)),
				focus === null ? undefined : eq(solutions.id, focus)
			)
		)
		.groupBy(solutions.id)
		.orderBy(
			desc(sql`${solutions.id} = ${focus ?? -1}`),
			desc(sql`${solutions.status} = 'auto_hidden'`),
			desc(sql`max(${solutionReports.createdAt})`),
			desc(solutions.id)
		)
		.limit(100);
	const ids = rows.map((r) => r.id);
	const notes = ids.length
		? await db
				.select({ solutionId: solutionReports.solutionId, note: solutionReports.note })
				.from(solutionReports)
				.where(and(inArray(solutionReports.solutionId, ids), isNotNull(solutionReports.note)))
				.orderBy(desc(solutionReports.createdAt), desc(solutionReports.id))
		: [];
	return rows.map((r) => ({ ...r, notes: notes.filter((n) => n.solutionId === r.id).map((n) => n.note as string) }));
}

/** 「わかる」「考えが変わった」を付ける・外す。いまと同じ状態への操作は何もせず、数えない（設計書 決めたこと5） */
export async function react(db: Db, actor: Actor, solutionId: number, kind: Reaction, op: 'add' | 'remove', now: number) {
	const mineHere = and(
		eq(solutionReactions.solutionId, solutionId),
		eq(solutionReactions.userId, actor.userId),
		eq(solutionReactions.kind, kind)
	);
	const [current] = await db.select({ n: count() }).from(solutionReactions).where(mineHere);
	if ((op === 'add') === current.n > 0) return { ok: true as const };

	const mine = eq(actions.userId, actor.userId);
	const pressed = inArray(actions.kind, PRESS_KINDS);
	const [day] = await db.select({ n: count() }).from(actions).where(and(mine, pressed, gt(actions.createdAt, now - DAY)));
	const [burst] = await db
		.select({ n: count() })
		.from(actions)
		.where(and(mine, pressed, gt(actions.createdAt, now - LIMITS.burstWindow)));
	// 同じ解決策に同じ回線から押したアカウント（「わかる」「考えが変わった」のどちらでも）
	const addedHere = and(eq(actions.kind, 'reaction_add'), eq(actions.targetId, solutionId), gt(actions.createdAt, now - DAY));
	const [others] = await db
		.select({ n: countDistinct(actions.userId) })
		.from(actions)
		.where(and(addedHere, eq(actions.ipHash, actor.ipHash), ne(actions.userId, actor.userId)));
	const [self] = await db.select({ n: count() }).from(actions).where(and(addedHere, mine));
	const refusal = checkSupport(
		{ op, accountDay: day.n, accountBurst: burst.n, otherAccountsOnIp: others.n, selfAddedRecently: self.n > 0 },
		'reaction-ip'
	);
	if (refusal) return refuse(db, actor, refusal, now);

	if (op === 'add') {
		await db.insert(solutionReactions).values({ solutionId, userId: actor.userId, kind, createdAt: now }).onConflictDoNothing();
	} else {
		await db.delete(solutionReactions).where(mineHere);
	}
	await db.insert(actions).values({
		kind: op === 'add' ? 'reaction_add' : 'reaction_remove',
		userId: actor.userId,
		ipHash: actor.ipHash,
		targetId: solutionId,
		createdAt: now
	});
	return { ok: true as const };
}
