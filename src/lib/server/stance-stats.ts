// 採決の結果の立場別の分布と考えの動き（Issue #87、設計書 docs/spec/87.md）。一度作って stance_stats に残し、あとは残した値を返す
import { and, asc, eq } from 'drizzle-orm';
import { stanceLog, stanceStats, user, votes } from '../db/schema';
import { referralSession } from '../domain/bills';
import { tallyStanceStats, type StanceStatsData } from '../domain/stance-stats';
import type { Db } from './law';
import { resultOf, reviewOf } from './results';
import { countedCondition } from './votes';

/**
 * 法案の丸める前の人数。結果がない、確認中、無効のときは null で、作りもしない（設計書 B）。
 * 結果の行は呼ぶ側が先に作る（resultOnRead）。ここでは結果の行を読むだけ
 */
export async function stanceStatsOf(db: Db, bill: { id: number; proposedAt: number | null }, minutes: number | null, now: number): Promise<StanceStatsData | null> {
	if (bill.proposedAt === null) return null;
	const session = referralSession(bill.proposedAt, minutes);
	if (!(await resultOf(db, session.key, bill.id))) return null;
	const review = await reviewOf(db, session.key, bill.id);
	if (review?.status === 'open' || review?.status === 'voided') return null;
	const saved = await savedOf(db, session.key, bill.id);
	if (saved) return saved;
	const counted = await db
		.select({ userId: votes.userId, choice: votes.choice })
		.from(votes)
		.innerJoin(user, eq(user.id, votes.userId))
		.where(and(eq(votes.sessionKey, session.key), eq(votes.billId, bill.id), countedCondition(session, votes)));
	const logs = await db
		.select({ userId: stanceLog.userId, stance: stanceLog.stance, createdAt: stanceLog.createdAt })
		.from(stanceLog)
		.where(and(eq(stanceLog.billId, bill.id), eq(stanceLog.sessionKey, session.key)))
		.orderBy(asc(stanceLog.id));
	const data = tallyStanceStats(counted, logs, session);
	// 同時に作ったら最初の1行だけが残る。読み直して、残った値を返す
	await db.insert(stanceStats).values({ sessionKey: session.key, billId: bill.id, data: JSON.stringify(data), createdAt: now }).onConflictDoNothing();
	return (await savedOf(db, session.key, bill.id)) ?? data;
}

async function savedOf(db: Db, sessionKey: string, billId: number): Promise<StanceStatsData | null> {
	const [row] = await db
		.select({ data: stanceStats.data })
		.from(stanceStats)
		.where(and(eq(stanceStats.sessionKey, sessionKey), eq(stanceStats.billId, billId)));
	return row ? (JSON.parse(row.data) as StanceStatsData) : null;
}
