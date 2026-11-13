// 会期のリプレイ（Issue #170。決めたことは Issue #198 の「#170」の節）。会期の終わりの処理では作らず、読むときに組む（結果も反映も書かない）。
// 個人の票、立場別の区分、「考えが変わった」の数は返さない
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { amendments, billResults, issues } from '../db/schema';
import { articlePlace } from '../domain/bills';
import type { DiffPart } from '../domain/law/compare';
import { excerptDiff } from '../domain/law/excerpt';
import { LISTED } from '../domain/reports';
import type { Session } from '../domain/session';
import { billById, billChangeViews, changeViewShared } from './bills';
import { ifPlacesOf, type IfPlace } from './if-world';
import type { Db } from './law';
import { changedRanking, sessionResults } from './toukei';

type Counts = { yes: number; no: number; abstain: number };
export type ReplayVote =
	| { billId: number; title: string; state: 'reviewing' }
	| { billId: number; title: string; state: 'passed' | 'rejected' | 'lapsed'; counted: Counts; reference: Counts };
export type ReplayChange = { location: string; parts: DiffPart[] | null };
export type ReplayIfBill = { billId: number; changes: ReplayChange[]; places: IfPlace[] };

/** 修正案が取り込まれた（提出者が取り込んだか、本案より先に可決した）とみなす状態 */
const TAKEN_IN = ['accepted', 'passed'] as const;

/** その会期の法案のもとになった課題（採決した版の解決策の課題）。表示中の課題だけを、「わかる」の多い順に */
async function sourceIssues(db: Db, session: Session) {
	// 結合のない select では列に表名が付かないので、サブクエリの中は表名を書いて相関させる
	const rows = await db
		.select({
			id: issues.id,
			title: issues.title,
			supports: sql<number>`(SELECT count(*) FROM issue_supports s WHERE s.issue_id = issues.id)`,
			solutions: sql<number>`(SELECT count(*) FROM solutions x WHERE x.issue_id = issues.id AND x.status IN ('visible', 'restored'))`
		})
		.from(issues)
		.where(
			and(
				inArray(issues.status, LISTED),
				sql`issues.id IN (SELECT so.issue_id FROM bill_results r JOIN bill_solutions bs ON bs.bill_id = r.bill_id AND bs.rev = r.rev JOIN solutions so ON so.id = bs.solution_id WHERE r.session_key = ${session.key})`
			)
		);
	return rows.sort((a, b) => b.supports - a.supports || a.id - b.id);
}

/** 修正案が取り込まれた法案の数 */
async function amendedCount(db: Db, session: Session) {
	const rows = await db
		.selectDistinct({ billId: amendments.billId })
		.from(amendments)
		.where(
			and(
				eq(amendments.sessionKey, session.key),
				inArray(amendments.status, [...TAKEN_IN]),
				sql`amendments.bill_id IN (SELECT r.bill_id FROM bill_results r WHERE r.session_key = ${session.key})`
			)
		);
	return rows.length;
}

/** IF世界の節に条を出す法案の数。超えた分は数だけ出し、それぞれの結果のページに任せる */
export const REPLAY_IF_BILLS = 10;

/**
 * 可決して IF世界に入った法案の、変わった条（変わったところの前後だけ）。確認中・無効・要調整の法案は入らない。
 * 読むのは番号の小さい REPLAY_IF_BILLS 本だけ。比べの予算はページ全体で1つにし、基にした条は法令・版ごとに1回だけ読む
 */
async function ifChanges(db: Db, session: Session): Promise<{ bills: ReplayIfBill[]; more: number }> {
	// 結合のない select では列に表名が付かないので、サブクエリの中は表名を書いて相関させる
	const applied = await db
		.select({ billId: billResults.billId, rev: billResults.rev })
		.from(billResults)
		.where(
			and(
				eq(billResults.sessionKey, session.key),
				eq(billResults.outcome, 'passed'),
				sql`NOT EXISTS (SELECT 1 FROM vote_reviews v WHERE v.session_key = bill_results.session_key AND v.bill_id = bill_results.bill_id AND v.status IN ('open', 'voided'))`,
				sql`(EXISTS (SELECT 1 FROM if_revisions i WHERE i.bill_id = bill_results.bill_id AND i.bill_rev = bill_results.rev) OR EXISTS (SELECT 1 FROM if_laws l WHERE l.bill_id = bill_results.bill_id AND l.bill_rev = bill_results.rev))`
			)
		)
		.orderBy(asc(billResults.billId));
	const shared = changeViewShared();
	const out: ReplayIfBill[] = [];
	for (const r of applied.slice(0, REPLAY_IF_BILLS)) {
		const [places, bill] = await Promise.all([ifPlacesOf(db, r.billId, r.rev), billById(db, r.billId)]);
		// 可決して反映した版は変わらないが、違えば別の版の条文を出さない
		if (!places.length || !bill || bill.rev !== r.rev) continue;
		// 法令が1本なら billChangeViews は法令名を付けないので、ここで付ける
		const single = bill.laws.length === 1 ? places[0].title : null;
		const changes: ReplayChange[] = (await billChangeViews(db, bill, shared))
			.filter((c) => c.op !== 'supplementary')
			.map((c) => {
				const parts = c.after ?? c.before;
				return { location: single ? articlePlace(single, c.location) : c.location, parts: parts ? excerptDiff(parts) : null };
			});
		out.push({ billId: r.billId, changes, places });
	}
	return { bills: out, more: Math.max(0, applied.length - REPLAY_IF_BILLS) };
}

export async function replayOf(db: Db, session: Session) {
	const rows = await sessionResults(db, session);
	const [issueRows, amended, points, ifBills] = await Promise.all([
		sourceIssues(db, session),
		amendedCount(db, session),
		changedRanking(db, session, new Set(rows.map((r) => r.billId))),
		ifChanges(db, session)
	]);
	const votes: ReplayVote[] = rows.map((r) =>
		r.review === 'open'
			? { billId: r.billId, title: r.title, state: 'reviewing' }
			: {
					billId: r.billId,
					title: r.title,
					// 無効の行の可否は可決のまま残っているので、廃案として返す
					state: r.review === 'voided' ? 'lapsed' : r.outcome,
					counted: { yes: r.yes, no: r.no, abstain: r.abstain },
					reference: { yes: r.refYes, no: r.refNo, abstain: r.refAbstain }
				}
	);
	return {
		issues: issueRows,
		bills: rows.map((r) => ({ id: r.billId, title: r.title })),
		amended,
		points,
		votes,
		ifBills: ifBills.bills,
		ifMore: ifBills.more
	};
}
