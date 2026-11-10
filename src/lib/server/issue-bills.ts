// 課題から生まれた法案（Issue #125）。課題の一覧の「法案あり」と、課題のページの「この課題から生まれた法案」で同じ数え方にする。
// 数えるのは、いまの版でこの課題の解決策を1つでも引いている、保存した法案。下書きも発議した法案も数え、取り下げた法案は数えない（決めること A）。
// 統合で解決策は統合先へ移るので統合先で数え（B）、引いた解決策があとで非表示になっても数える（C）
import { and, desc, sql, type SQL } from 'drizzle-orm';
import { bills } from '../db/schema';
import type { BillTab } from '../domain/bills';
import type { Db } from './law';

/** 数える法案の状態 */
const COUNTED = sql.raw(`'draft', 'proposed'`);

/**
 * 法案（表の名前か別名 bill）が、いまの版でこの課題の解決策を引いている。
 * 列を ${bills.rev} で埋めると drizzle が表名なしの "rev" にして副問い合わせの中の列を指すので、表の名前を書く
 */
const citesIssue = (bill: SQL, issueId: SQL) =>
	sql`EXISTS (SELECT 1 FROM bill_solutions bs JOIN solutions s ON s.id = bs.solution_id WHERE bs.bill_id = ${bill}.id AND bs.rev = ${bill}.rev AND s.issue_id = ${issueId})`;

/** 課題ごとの数（課題の一覧の相関副問い合わせ。issueId は課題の id の列） */
export const billCountOfIssue = (issueId: SQL) =>
	sql<number>`(SELECT count(*) FROM bills b WHERE b.rev > 0 AND b.status IN (${COUNTED}) AND ${citesIssue(sql.raw('b'), issueId)})`;

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
