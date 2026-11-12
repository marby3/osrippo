// 統計ページ（Issue #154、設計書 docs/spec/154.md）。結果は作らない（C）。人数と「考えが変わった」の数は返さない
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { billResults, bills, posts, voteReviews } from '../db/schema';
import { POST_SHOWN } from '../domain/reports';
import type { Session } from '../domain/session';
import { billBridge, excerpt, rankBridges, rankChanged, sessionFromKey } from '../domain/toukei';
import { sessionPostScores } from './evaluations';
import type { Db } from './law';
import { stanceStatsOf } from './stance-stats';

/** 結果の行がある、終わった会期を、始まりの新しい順に（B） */
export async function finishedSessions(db: Db, now: number, minutes: number | null): Promise<Session[]> {
	const rows = await db.selectDistinct({ key: billResults.sessionKey }).from(billResults);
	return rows
		.map((r) => sessionFromKey(r.key, minutes))
		.filter((s): s is Session => s !== null && s.endsAt <= now)
		.sort((a, b) => b.startsAt - a.startsAt);
}

export type SessionResult =
	| { billId: number; title: string; state: 'reviewing' }
	| { billId: number; title: string; state: 'passed' | 'rejected' | 'lapsed'; yes: number; no: number; abstain: number };

/** 会期の法案の結果（E）。確認中は可否と票の数を入れない。無効は廃案 */
export async function sessionResults(db: Db, session: Session) {
	const rows = await db
		.select({
			billId: billResults.billId,
			title: bills.title,
			proposedAt: bills.proposedAt,
			outcome: billResults.outcome,
			yes: billResults.yes,
			no: billResults.no,
			abstain: billResults.abstain,
			review: voteReviews.status
		})
		.from(billResults)
		.innerJoin(bills, eq(bills.id, billResults.billId))
		.leftJoin(voteReviews, and(eq(voteReviews.sessionKey, billResults.sessionKey), eq(voteReviews.billId, billResults.billId)))
		.where(eq(billResults.sessionKey, session.key))
		.orderBy(asc(billResults.billId));
	return rows;
}

export const resultView = (r: Awaited<ReturnType<typeof sessionResults>>[number]): SessionResult =>
	r.review === 'open'
		? { billId: r.billId, title: r.title, state: 'reviewing' }
		: { billId: r.billId, title: r.title, state: r.review === 'voided' ? 'lapsed' : r.outcome, yes: r.yes, no: r.no, abstain: r.abstain };

/** 立場を超えた支持が多い法案（F）。確認中・無効の法案は stanceStatsOf が null を返すので入らない */
export async function bridgeRanking(db: Db, rows: Awaited<ReturnType<typeof sessionResults>>, minutes: number | null, now: number) {
	const scored = [];
	for (const r of rows) {
		if (r.review === 'open' || r.review === 'voided') continue;
		const stats = await stanceStatsOf(db, { id: r.billId, proposedAt: r.proposedAt }, minutes, now);
		scored.push({ billId: r.billId, title: r.title, bridge: stats ? billBridge(stats.votes) : null });
	}
	return rankBridges(scored);
}

export type ChangedItem = { postId: number; kind: 'question' | 'answer'; excerpt: string; billId: number; billTitle: string; questionId: number };

/** 「考えが変わった」が多く付いた質疑と答弁（G・H）。数は並びに使うだけで返さない */
export async function changedRanking(db: Db, session: Session): Promise<ChangedItem[]> {
	const scores = await sessionPostScores(db, session.key);
	const candidates = [...scores].map(([postId, s]) => ({ postId, changed: s.changed }));
	// 見えている投稿だけにしてから選ぶ（まとめた投稿などを除いたあとで10件にする）
	const ids = candidates.filter((c) => c.changed > 0).map((c) => c.postId);
	if (ids.length === 0) return [];
	const shown = await db
		.select({ id: posts.id, kind: posts.kind, body: posts.body, parentId: posts.parentId, billId: posts.billId, billTitle: bills.title })
		.from(posts)
		.innerJoin(bills, eq(bills.id, posts.billId))
		.where(and(sql`${posts.id} IN (SELECT value FROM json_each(${JSON.stringify(ids)}))`, inArray(posts.status, POST_SHOWN), inArray(posts.kind, ['question', 'answer'])));
	// 答弁は親の質疑も見えているものだけ（見えない質疑へのリンクにしない）
	const parents = shown.filter((p) => p.kind === 'answer' && p.parentId !== null).map((p) => p.parentId as number);
	const shownParents = parents.length
		? new Set(
				(
					await db
						.select({ id: posts.id })
						.from(posts)
						.where(and(sql`${posts.id} IN (SELECT value FROM json_each(${JSON.stringify(parents)}))`, inArray(posts.status, POST_SHOWN)))
				).map((r) => r.id)
			)
		: new Set<number>();
	const byId = new Map(shown.filter((p) => p.kind !== 'answer' || (p.parentId !== null && shownParents.has(p.parentId))).map((p) => [p.id, p]));
	return rankChanged(candidates.filter((c) => byId.has(c.postId))).map((id) => {
		const p = byId.get(id)!;
		return {
			postId: p.id,
			kind: p.kind as 'question' | 'answer',
			excerpt: excerpt(p.body),
			billId: p.billId,
			billTitle: p.billTitle,
			questionId: p.kind === 'answer' && p.parentId !== null ? p.parentId : p.id
		};
	});
}
