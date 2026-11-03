// 解決策の DB（設計書 docs/spec/34.md）
import { and, count, countDistinct, desc, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import { actions, solutionReactions, solutions } from '../db/schema';
import { checkSolutionPost, checkSupport, DAY, LIMITS } from '../domain/limits';
import type { Reaction } from '../domain/solutions';
import { PRESS_KINDS, refuse, type Actor } from './issues';
import type { Db } from './law';

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
		WHERE EXISTS (SELECT 1 FROM issues WHERE id = ${issueId} AND status IN ('visible', 'restored'))
		RETURNING id`);
	if (rows.length === 0) return { ok: true as const, created: false as const };
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
		.where(eq(solutions.issueId, issueId))
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

export async function solutionCount(db: Db, issueId: number) {
	const [row] = await db.select({ n: count() }).from(solutions).where(eq(solutions.issueId, issueId));
	return row.n;
}

export async function solutionMeta(db: Db, id: number) {
	const [row] = await db.select({ issueId: solutions.issueId, userId: solutions.userId }).from(solutions).where(eq(solutions.id, id));
	return row ?? null;
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
