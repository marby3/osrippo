// 統計ページ（Issue #154、設計書 docs/spec/154.md）。結果は作らない（C）。人数と「考えが変わった」の数は返さない
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { billResults, bills, posts, voteReviews } from '../db/schema';
import { POST_SHOWN } from '../domain/reports';
import type { PostRole } from '../domain/posts';
import type { Session } from '../domain/session';
import { STATS_MIN } from '../domain/stance-stats';
import { billBridge, excerpt, rankBridges, rankChanged, sessionFromKey } from '../domain/toukei';
import { sessionPostScores } from './evaluations';
import type { Db } from './law';
import { stanceStatsIn } from './stance-stats';

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
			refYes: billResults.refYes,
			refNo: billResults.refNo,
			refAbstain: billResults.refAbstain,
			rev: billResults.rev,
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
export async function bridgeRanking(db: Db, session: Session, rows: Awaited<ReturnType<typeof sessionResults>>, now: number) {
	const scored = [];
	for (const r of rows) {
		if (r.review === 'open' || r.review === 'voided') continue;
		// 選んだ会期の分を読む（発議の日付から会期を求めない）
		const stats = await stanceStatsIn(db, { id: r.billId }, session, now);
		scored.push({ billId: r.billId, title: r.title, bridge: stats ? billBridge(stats.votes) : null });
	}
	return rankBridges(scored);
}

/** role は答弁のその法案での役（会期のリプレイのタグ。Issue #169） */
export type ChangedItem = { postId: number; kind: 'question' | 'answer'; role: PostRole | null; excerpt: string; billId: number; billTitle: string; questionId: number };

/**
 * 「考えが変わった」が多く付いた質疑と答弁（G・H）。数は並びに使うだけで返さない。見えている投稿だけで並べてから、10件の本文を読む。
 * billIds を渡すと、その法案の投稿だけ（会期のリプレイ、Issue #170）
 */
export async function changedRanking(db: Db, session: Session, billIds?: ReadonlySet<number>): Promise<ChangedItem[]> {
	const scores = await sessionPostScores(db, session.key);
	const ids = [...scores].filter(([, s]) => s.changed >= STATS_MIN).map(([id]) => id);
	if (ids.length === 0) return [];
	const inIds = (list: number[]) => sql`${posts.id} IN (SELECT value FROM json_each(${JSON.stringify(list)}))`;
	const shown = await db
		.select({ id: posts.id, kind: posts.kind, parentId: posts.parentId, billId: posts.billId })
		.from(posts)
		.where(and(inIds(ids), inArray(posts.status, POST_SHOWN), inArray(posts.kind, ['question', 'answer'])))
		.then((rows) => (billIds ? rows.filter((p) => billIds.has(p.billId)) : rows));
	// 答弁は親の質疑も見えているものだけ（見えない質疑へのリンクにしない）
	const parents = shown.filter((p) => p.kind === 'answer' && p.parentId !== null).map((p) => p.parentId as number);
	const shownParents = new Set(parents.length ? (await db.select({ id: posts.id }).from(posts).where(and(inIds(parents), inArray(posts.status, POST_SHOWN)))).map((r) => r.id) : []);
	const eligible = shown.filter((p) => p.kind !== 'answer' || (p.parentId !== null && shownParents.has(p.parentId)));
	const ranked = rankChanged(eligible.map((p) => ({ postId: p.id, changed: scores.get(p.id)?.changed ?? 0 })));
	if (ranked.length === 0) return [];
	const details = await db
		.select({ id: posts.id, kind: posts.kind, role: posts.role, body: posts.body, parentId: posts.parentId, billId: posts.billId, billTitle: bills.title })
		.from(posts)
		.innerJoin(bills, eq(bills.id, posts.billId))
		.where(inIds(ranked));
	const byId = new Map(details.map((p) => [p.id, p]));
	return ranked.flatMap((id) => {
		const p = byId.get(id);
		if (!p) return [];
		return [
			{
				postId: p.id,
				kind: p.kind as 'question' | 'answer',
				role: p.role,
				excerpt: excerpt(p.body),
				billId: p.billId,
				billTitle: p.billTitle,
				questionId: p.kind === 'answer' && p.parentId !== null ? p.parentId : p.id
			}
		];
	});
}
