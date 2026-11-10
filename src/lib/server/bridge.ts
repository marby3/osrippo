// 立場を超えた支持順（課題の橋渡しスコア。Issue #126、設計書 docs/spec/126.md）。
// 直近に締め切った会期の数えた票で「賛成寄り」「反対寄り」に分け、課題ごとにグループの中で「わかる」を付けた人の割合の低いほうで並べる。
// 割合・人数・だれがどちらかは返さない（並べるためにだけ使う。基準5）
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { issueSupports, issues, user, votes } from '../db/schema';
import type { Session } from '../domain/session';
import type { Db } from './law';
import { countedCondition } from './votes';

/** 匿名化の基準（仕様書「10人未満の区分は表示しない」）。グループ全体にも、課題ごとの区分にも当てはめる（決めること E） */
export const BRIDGE_MIN = 10;

/**
 * 並べるための部品。グループの CTE は1つの文の中で1回だけ作り、人数と課題ごとの集計の両方に使う（設計書 6）。
 * supports は課題ごとの「わかる」の数の式
 */
export function bridgeParts(db: Db, previous: Session, supports: SQL<number>) {
	const yes = sql`sum(${votes.choice} = 'yes')`;
	const no = sql`sum(${votes.choice} = 'no')`;
	const groups = db.$with('bridge_groups').as(
		db
			.select({
				userId: sql<string>`${votes.userId}`.as('bridge_user_id'),
				// 賛成が多い人は賛成寄り、反対が多い人は反対寄り。同じ数と棄権だけの人はどちらにも入れない（決めること A）
				side: sql<string | null>`CASE WHEN ${yes} > ${no} THEN 'for' WHEN ${no} > ${yes} THEN 'against' END`.as('side')
			})
			.from(votes)
			.innerJoin(user, eq(user.id, votes.userId))
			.where(
				and(
					eq(votes.sessionKey, previous.key),
					// 数えた票だけ（採決の結果と同じ条件）。参考の票は使わない
					countedCondition(previous, votes),
					// 確認中と無効にした法案の票は使わない（設計書 1）
					sql`NOT EXISTS (SELECT 1 FROM vote_reviews r WHERE r.session_key = ${votes}.session_key AND r.bill_id = ${votes}.bill_id AND r.status IN ('open', 'voided'))`
				)
			)
			.groupBy(votes.userId)
	);
	const size = (side: 'for' | 'against') => sql<number>`(SELECT count(*) FROM bridge_groups WHERE side = ${side})`;
	const total = { for: size('for'), against: size('against') };
	const count = (side: 'for' | 'against') => sql<number>`count(CASE WHEN ${groups.side} = ${side} THEN 1 END)`;
	const supporters = { for: count('for'), against: count('against') };
	/** グループ全体が10人未満なら「わかる」の多い順にする（基準3） */
	const fallback = sql<number>`(${total.for} < ${BRIDGE_MIN} OR ${total.against} < ${BRIDGE_MIN})`;
	/** 割合を使う課題：グループ全体も、その課題の区分もどちらも10人以上（決めること E） */
	const scored = sql`(NOT ${fallback} AND ${supporters.for} >= ${BRIDGE_MIN} AND ${supporters.against} >= ${BRIDGE_MIN})`;
	const score = sql`min(${supporters.for} * 1.0 / ${total.for}, ${supporters.against} * 1.0 / ${total.against})`;
	return {
		groups,
		join: eq(groups.userId, issueSupports.userId),
		fallback,
		// 割合を使う課題が先で割合の高い順、そのあと（と足りないとき）は「わかる」の多い順 → 新しい順
		order: [sql`CASE WHEN ${scored} THEN 0 ELSE 1 END`, sql`CASE WHEN ${scored} THEN ${score} END DESC`, sql`${supports} DESC`, sql`${issues.id} DESC`]
	};
}
