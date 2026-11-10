// 議員ダッシュボード（Issue #149、設計書 docs/spec/149.md の 3）
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { billLaws, billResults, billSolutions, bills, ifLaws, issues, laws, solutionReactions, solutions } from '../db/schema';
import { LISTED, SOLUTION_SHOWN as SHOWN } from '../domain/reports';
import type { Db } from './law';

/** 一覧の1ページの件数（SpMember の「もっと見る」） */
export const GIIN_PAGE_SIZE = 20;

/** 表示中の課題の数（課題のタブの件数） */
export async function listedIssueCount(db: Db): Promise<number> {
	const [row] = await db.select({ n: count() }).from(issues).where(inArray(issues.status, [...LISTED]));
	return row.n;
}

/** 課題ごとのいちばんの解決策：表示中の解決策のうち「わかる」が最も多いもの（同じなら先に書かれたもの） */
export async function topSolutions(db: Db, issueIds: number[]): Promise<Map<number, string>> {
	if (!issueIds.length) return new Map();
	const supports = sql<number>`(SELECT count(*) FROM ${solutionReactions} r WHERE r.solution_id = ${solutions.id} AND r.kind = 'support')`;
	const rows = await db
		.select({ issueId: solutions.issueId, body: solutions.body, supports })
		.from(solutions)
		.where(and(inArray(solutions.issueId, issueIds), inArray(solutions.status, [...SHOWN])))
		.orderBy(desc(supports), asc(solutions.id));
	const top = new Map<number, string>();
	for (const r of rows) if (!top.has(r.issueId)) top.set(r.issueId, r.body);
	return top;
}

/** 法案ごとの元の課題：いまの版で引用した解決策の課題（表示中のもの）の最初の1つ */
export async function originIssues(db: Db, billIds: number[]): Promise<Map<number, { id: number; title: string }>> {
	if (!billIds.length) return new Map();
	const rows = await db
		.select({ billId: billSolutions.billId, id: issues.id, title: issues.title })
		.from(billSolutions)
		.innerJoin(bills, and(eq(bills.id, billSolutions.billId), eq(bills.rev, billSolutions.rev)))
		.innerJoin(solutions, eq(solutions.id, billSolutions.solutionId))
		.innerJoin(issues, eq(issues.id, solutions.issueId))
		.where(and(inArray(billSolutions.billId, billIds), inArray(issues.status, [...LISTED])))
		.orderBy(asc(billSolutions.seq));
	const origin = new Map<number, { id: number; title: string }>();
	for (const r of rows) if (!origin.has(r.billId)) origin.set(r.billId, { id: r.id, title: r.title });
	return origin;
}

/**
 * 可決して IF世界の法律になった法案の条件：結果が可決で、確認中・無効にしていない。
 * その会期にぶつかって要調整になった結果は、IF世界に入っていないので出さない（直して次の会期に可決すれば、その結果が出る。1つの法案は1行）
 */
const passed = and(
	eq(billResults.outcome, 'passed'),
	sql`NOT EXISTS (SELECT 1 FROM vote_reviews v WHERE v.session_key = ${billResults.sessionKey} AND v.bill_id = ${billResults.billId} AND v.status IN ('open', 'voided'))`,
	sql`NOT EXISTS (SELECT 1 FROM bill_adjustments a WHERE a.session_key = ${billResults.sessionKey} AND a.bill_id = ${billResults.billId})`
);

/** IF世界で可決のタブ：新しい会期の順（同じ会期は新しい法案から）。対象の法令は IF世界の法令へのリンク */
export async function passedBills(db: Db, page: number) {
	const rows = await db
		.select({ id: bills.id, title: bills.title, sessionKey: billResults.sessionKey, rev: billResults.rev })
		.from(billResults)
		.innerJoin(bills, eq(bills.id, billResults.billId))
		.where(passed)
		.orderBy(desc(billResults.sessionKey), desc(bills.id))
		.limit(GIIN_PAGE_SIZE + 1)
		.offset((page - 1) * GIIN_PAGE_SIZE);
	const shown = rows.slice(0, GIIN_PAGE_SIZE);
	const lawRows = shown.length
		? await db
				.select({ billId: billLaws.billId, rev: billLaws.rev, seq: billLaws.seq, lawId: billLaws.lawId, title: laws.title, newTitle: billLaws.newTitle, ifLawId: ifLaws.id })
				.from(billLaws)
				.leftJoin(laws, eq(laws.id, billLaws.lawId))
				.leftJoin(ifLaws, eq(ifLaws.billId, billLaws.billId))
				.where(inArray(billLaws.billId, shown.map((b) => b.id)))
				.orderBy(asc(billLaws.seq))
		: [];
	return {
		rows: shown.map(({ rev, ...b }) => ({
			...b,
			laws: lawRows
				.filter((l) => l.billId === b.id && l.rev === rev)
				.map((l) => ({ id: l.lawId ?? l.ifLawId, title: l.title ?? l.newTitle ?? '' }))
				.filter((l): l is { id: string; title: string } => l.id !== null)
		})),
		hasNext: rows.length > GIIN_PAGE_SIZE
	};
}

/** IF世界で可決のタブの件数 */
export async function passedCount(db: Db): Promise<number> {
	const [row] = await db.select({ n: count() }).from(billResults).where(passed);
	return row.n;
}
