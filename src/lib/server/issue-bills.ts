// 課題から生まれた法案（Issue #125）。課題の一覧の「法案あり」と、課題のページの「この課題から生まれた法案」で同じ数え方にする。
// 数えるのは、いまの版でこの課題の解決策を1つでも引いている、保存した法案。下書きも発議した法案も数え、取り下げた法案は数えない（決めること A）。
// 統合で解決策は統合先へ移るので統合先で数え（B）、引いた解決策があとで非表示になっても数える（C）
import { and, countDistinct, desc, eq, gt, inArray, sql, type SQL } from 'drizzle-orm';
import { bills, billSolutions, solutions } from '../db/schema';
import type { BillTab } from '../domain/bills';
import type { BILL_STATUSES } from '../db/schema';
import type { Db } from './law';

/** 数える法案の状態（取り下げた法案は数えない）。名前を変えたら型で気づけるよう BILL_STATUSES から選ぶ */
const COUNTED_STATUSES = ['draft', 'proposed'] as const satisfies readonly (typeof BILL_STATUSES)[number][];
const COUNTED = sql.raw(COUNTED_STATUSES.map((s) => `'${s}'`).join(', '));

/**
 * 法案（表の名前か別名 bill）が、いまの版でこの課題の解決策を引いている。
 * 列を ${bills.rev} で埋めると drizzle が表名なしの "rev" にして副問い合わせの中の列を指すので、表の名前を書く
 */
const citesIssue = (bill: SQL, issueId: SQL) =>
	sql`EXISTS (SELECT 1 FROM bill_solutions bs JOIN solutions s ON s.id = bs.solution_id WHERE bs.bill_id = ${bill}.id AND bs.rev = ${bill}.rev AND s.issue_id = ${issueId})`;

/** 法案（数えるもの）がいまの版で引いている解決策の課題。法案から始めて1回だけ読む（bill_solutions は法案と版の索引で引く） */
const citedIssues = sql`SELECT s.issue_id AS issue_id, b.id AS bill_id FROM bills b JOIN bill_solutions bs ON bs.bill_id = b.id AND bs.rev = b.rev JOIN solutions s ON s.id = bs.solution_id WHERE b.rev > 0 AND b.status IN (${COUNTED})`;

/**
 * 課題の一覧の「法案あり」：相関させない副問い合わせにして1回だけ評価させる。
 * 課題の行ごと（「わかる」と JOIN した行ごと）に法案を読みにいかないように（#125 のレビュー）
 */
export const hasBills = (issueId: SQL) => sql`${issueId} IN (SELECT issue_id FROM (${citedIssues}))`;

/** 課題ごとの法案の数。一覧のページに出る課題の分だけ、まとめて1回で数える */
export async function billCounts(db: Db, issueIds: number[]): Promise<Map<number, number>> {
	if (!issueIds.length) return new Map();
	const rows = await db
		.select({ issueId: solutions.issueId, n: countDistinct(bills.id) })
		.from(bills)
		.innerJoin(billSolutions, and(eq(billSolutions.billId, bills.id), eq(billSolutions.rev, bills.rev)))
		.innerJoin(solutions, eq(solutions.id, billSolutions.solutionId))
		.where(and(gt(bills.rev, 0), inArray(bills.status, COUNTED_STATUSES), inArray(solutions.issueId, issueIds)))
		.groupBy(solutions.issueId);
	return new Map(rows.map((r) => [r.issueId, r.n]));
}

const fromIssue = (issueId: number) => and(sql`${bills}.rev > 0`, sql`${bills}.status IN (${COUNTED})`, citesIssue(sql`${bills}`, sql`${issueId}`));

/** この課題から生まれた法案の数 */
export async function issueBillCount(db: Db, issueId: number): Promise<number> {
	const [row] = await db.select({ n: sql<number>`count(*)` }).from(bills).where(fromIssue(issueId));
	return row.n;
}

/** この課題から生まれた法案。作ったのが新しい順。before は lapsedBefore の値で、これより前に発議した法案は終わった（法案の一覧のタブと同じ分け方） */
export async function issueBills(db: Db, issueId: number, before: number): Promise<{ id: number; kind: (typeof bills.$inferSelect)['kind']; title: string; tab: BillTab }[]> {
	const rows = await db
		.select({ id: bills.id, kind: bills.kind, title: bills.title, status: bills.status, proposedAt: bills.proposedAt })
		.from(bills)
		.where(fromIssue(issueId))
		.orderBy(desc(bills.createdAt), desc(bills.id));
	return rows.map(({ id, kind, title, status, proposedAt }) => ({
		id,
		kind,
		title,
		tab: status === 'draft' ? 'shitagaki' : proposedAt !== null && proposedAt < before ? 'owari' : 'shingi'
	}));
}
