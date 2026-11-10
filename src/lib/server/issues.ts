// 課題と「わかる」の DB（設計書 docs/spec/25.md）
import { and, count, countDistinct, desc, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import { actions, bans, issueSupports, issues, topics } from '../db/schema';
import { PAGE_SIZE, type IssueInput, type ListQuery } from '../domain/issues';
import {
	banUntil,
	checkPost,
	checkSupport,
	COUNTS_AS_VIOLATION,
	DAY,
	LIMITS,
	type Refusal
} from '../domain/limits';
import type { Db } from './law';
import { indexTexts, issueMatchSql } from './search';
import type { Word } from '../domain/search';
import { billCountOfIssue } from './issue-bills';

/** 押す操作として合わせて数える actions の種類 */
export const PRESS_KINDS = ['support_add', 'support_remove', 'reaction_add', 'reaction_remove'] as const;

/** 書き込む人。ipHash はハッシュにした IP（生の IP は受け取らない） */
export type Actor = { userId: string; registeredAt: number; ipHash: string };

/** 最近「わかる」が増えている順で数える長さ */
const RISING_WINDOW = 7 * DAY;

/** 今回のお題：id が最大の行 */
export async function currentTopic(db: Db) {
	const [row] = await db.select().from(topics).orderBy(desc(topics.id)).limit(1);
	return row ?? null;
}

/** words は「課題を探す」の言葉（空なら探さない。設計書 docs/spec/38.md 決めたこと5） */
export async function listIssues(db: Db, q: ListQuery, topicId: number | null, now: number, words: Word[] = []) {
	const supports = sql<number>`count(${issueSupports.userId})`;
	const recent = sql<number>`count(case when ${issueSupports.createdAt} > ${now - RISING_WINDOW} then 1 end)`;
	const order = {
		support: [desc(supports), desc(issues.id)],
		new: [desc(issues.id)],
		rising: [desc(recent), desc(supports), desc(issues.id)]
	}[q.sort];
	const rows = await db
		.select({
			id: issues.id,
			title: issues.title,
			topicName: topics.name,
			supports,
			// 「わかる」と同じ JOIN に足すと行が掛け算で増えるので、相関サブクエリで数える（設計書 docs/spec/34.md 決めたこと8）
			// 非表示の解決策は数えない（設計書 docs/spec/36.md 決めたこと4）
			solutions: sql<number>`(SELECT count(*) FROM solutions WHERE solutions.issue_id = ${issues.id} AND solutions.status IN ('visible', 'restored'))`,
			// この課題から生まれた法案（Issue #125）
			bills: billCountOfIssue(sql`${issues}.id`)
		})
		.from(issues)
		.leftJoin(issueSupports, eq(issueSupports.issueId, issues.id))
		.leftJoin(topics, eq(topics.id, issues.topicId))
		.where(
			and(
				// 非表示の課題は出さない（設計書 docs/spec/28.md 決めたこと4）
				inArray(issues.status, ['visible', 'restored']),
				// 今回のお題がまだないときは、絞り込むと0件
				q.topic === 'current' ? eq(issues.topicId, topicId ?? -1) : undefined,
				q.solutions
					? sql`EXISTS (SELECT 1 FROM solutions WHERE solutions.issue_id = ${issues.id} AND solutions.status IN ('visible', 'restored'))`
					: undefined,
				q.bills ? sql`${billCountOfIssue(sql`${issues}.id`)} > 0` : undefined,
				words.length ? sql`${issues.id} IN (${issueMatchSql(words)})` : undefined
			)
		)
		.groupBy(issues.id)
		.orderBy(...order)
		.limit(PAGE_SIZE + 1)
		.offset((q.page - 1) * PAGE_SIZE);
	return { rows: rows.slice(0, PAGE_SIZE), hasNext: rows.length > PAGE_SIZE };
}

export async function getIssue(db: Db, id: number, userId: string | null) {
	const [issue] = await db
		.select({
			id: issues.id,
			title: issues.title,
			affected: issues.affected,
			example: issues.example,
			topicName: topics.name,
			userId: issues.userId,
			status: issues.status,
			statusReason: issues.statusReason,
			mergedInto: issues.mergedInto
		})
		.from(issues)
		.leftJoin(topics, eq(topics.id, issues.topicId))
		.where(eq(issues.id, id));
	if (!issue) return null;
	return { ...issue, supports: await supportCount(db, id), supported: userId ? await isSupported(db, id, userId) : false };
}

/** 書いた人と状態だけ（操作の前の確かめ） */
export async function issueMeta(db: Db, id: number) {
	const [row] = await db.select({ userId: issues.userId, status: issues.status }).from(issues).where(eq(issues.id, id));
	return row ?? null;
}

async function supportCount(db: Db, issueId: number) {
	const [row] = await db.select({ n: count() }).from(issueSupports).where(eq(issueSupports.issueId, issueId));
	return row.n;
}

async function isSupported(db: Db, issueId: number, userId: string) {
	const [row] = await db
		.select({ n: count() })
		.from(issueSupports)
		.where(and(eq(issueSupports.issueId, issueId), eq(issueSupports.userId, userId)));
	return row.n > 0;
}

/** 締め出しの期限。締め出されていなければ null */
export async function activeBan(db: Db, userId: string, now: number): Promise<number | null> {
	const [row] = await db
		.select({ until: bans.until })
		.from(bans)
		.where(and(eq(bans.userId, userId), gt(bans.until, now)));
	return row?.until ?? null;
}

/** 断ったことを記録する。違反に数えるものは、24時間に3回でアカウントを締め出す */
export async function refuse(db: Db, actor: Actor, refusal: Refusal, now: number) {
	if (COUNTS_AS_VIOLATION[refusal.kind]) {
		await db.insert(actions).values({ kind: 'violation', userId: actor.userId, ipHash: actor.ipHash, createdAt: now });
		const [row] = await db
			.select({ n: count() })
			.from(actions)
			.where(and(eq(actions.userId, actor.userId), eq(actions.kind, 'violation'), gt(actions.createdAt, now - DAY)));
		const until = banUntil(row.n, now);
		if (until !== null) {
			await db
				.insert(bans)
				.values({ userId: actor.userId, until, createdAt: now })
				.onConflictDoUpdate({ target: bans.userId, set: { until, createdAt: now } });
		}
	}
	return { ok: false as const, refusal };
}

export async function createIssue(db: Db, actor: Actor, value: IssueInput, now: number) {
	const since = now - DAY;
	const accountPosts = await db
		.select({ at: actions.createdAt })
		.from(actions)
		.where(and(eq(actions.userId, actor.userId), eq(actions.kind, 'issue_post'), gt(actions.createdAt, since)));
	const [ip] = await db
		.select({ n: count() })
		.from(actions)
		.where(and(eq(actions.ipHash, actor.ipHash), eq(actions.kind, 'issue_post'), gt(actions.createdAt, since)));
	const refusal = checkPost(
		{ accountPostTimes: accountPosts.map((r) => r.at), ipPosts: ip.n, registeredAt: actor.registeredAt },
		now
	);
	if (refusal) return refuse(db, actor, refusal, now);

	const [row] = await db
		.insert(issues)
		.values({ ...value, userId: actor.userId, createdAt: now })
		.returning({ id: issues.id });
	await db.insert(actions).values({ kind: 'issue_post', userId: actor.userId, ipHash: actor.ipHash, targetId: row.id, createdAt: now });
	// 全文検索の行（題名・困っている人・具体例を別の行に。設計書 docs/spec/38.md「行の作り方」）
	await indexTexts(db, 'issue', row.id, [value.title, value.affected, value.example]);
	return { ok: true as const, id: row.id };
}

/** 「わかる」を付ける・外す。いまと同じ状態への操作は何もせず、数えない */
export async function setSupport(db: Db, actor: Actor, issueId: number, op: 'add' | 'remove', now: number) {
	const supported = await isSupported(db, issueId, actor.userId);
	if ((op === 'add') === supported) {
		return { ok: true as const, supported, count: await supportCount(db, issueId) };
	}

	// 課題の「わかる」と解決策の「わかる」「考えが変わった」は合わせて数える（設計書 docs/spec/34.md 決めたこと5）
	const supportKinds = inArray(actions.kind, PRESS_KINDS);
	const mine = eq(actions.userId, actor.userId);
	const [day] = await db
		.select({ n: count() })
		.from(actions)
		.where(and(mine, supportKinds, gt(actions.createdAt, now - DAY)));
	const [burst] = await db
		.select({ n: count() })
		.from(actions)
		.where(and(mine, supportKinds, gt(actions.createdAt, now - LIMITS.burstWindow)));
	// 同じ課題に付けた記録（取り消すと消える issue_supports ではなく、actions から数える）
	const addedHere = and(eq(actions.kind, 'support_add'), eq(actions.targetId, issueId), gt(actions.createdAt, now - DAY));
	const [others] = await db
		.select({ n: countDistinct(actions.userId) })
		.from(actions)
		.where(and(addedHere, eq(actions.ipHash, actor.ipHash), ne(actions.userId, actor.userId)));
	const [self] = await db.select({ n: count() }).from(actions).where(and(addedHere, mine));

	const refusal = checkSupport({
		op,
		accountDay: day.n,
		accountBurst: burst.n,
		otherAccountsOnIp: others.n,
		selfAddedRecently: self.n > 0
	});
	if (refusal) return refuse(db, actor, refusal, now);

	if (op === 'add') {
		await db.insert(issueSupports).values({ issueId, userId: actor.userId, createdAt: now }).onConflictDoNothing();
	} else {
		await db
			.delete(issueSupports)
			.where(and(eq(issueSupports.issueId, issueId), eq(issueSupports.userId, actor.userId)));
	}
	await db.insert(actions).values({
		kind: op === 'add' ? 'support_add' : 'support_remove',
		userId: actor.userId,
		ipHash: actor.ipHash,
		targetId: issueId,
		createdAt: now
	});
	return { ok: true as const, supported: op === 'add', count: await supportCount(db, issueId) };
}
