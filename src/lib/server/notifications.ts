// アプリ内通知を入れる（Issue #78。設計書 docs/spec/78.md）。行を書くだけで、ほかの server の関数に頼らない（どこからでも読めるように）。
// Cron の入口からも読むので、cloudflare:workers と import.meta.env に頼らない
import { eq, sql, type SQL } from 'drizzle-orm';
import { billRelations, notifications } from '../db/schema';
import type { NotificationKind } from '../domain/notifications';
import type { BatchDb, Db } from './law';

/** 受け取る人（user_id の列を返す SELECT）に入れる文。同じ行は入らない（決めたこと3）。batch に入れられる */
export const notifyStatement = (db: Db, users: SQL, kind: NotificationKind, targetId: number, refId: number, now: number) =>
	db
		.insert(notifications)
		.select(sql`SELECT NULL, u.user_id, ${kind}, ${targetId}, ${refId}, ${now} FROM (${users}) u WHERE true`)
		.onConflictDoNothing();

/** 通知を入れる。失敗しても元の操作を失敗させない（決めたこと4。失敗するとその通知は届かない） */
export async function notify(db: Db, users: SQL, kind: NotificationKind, targetId: number, refId: number, now: number): Promise<void> {
	try {
		await notifyStatement(db, users, kind, targetId, refId, now);
	} catch (e) {
		console.error(e);
	}
}

export const oneUser = (userId: string) => sql`SELECT ${userId} AS user_id`;

/** 法案の提出者と共同提出者。except は操作した人 */
export const billMembers = (billId: number, except: string | null = null) =>
	sql`SELECT user_id FROM bills WHERE id = ${billId} AND user_id IS NOT ${except} UNION SELECT user_id FROM bill_cosponsors WHERE bill_id = ${billId} AND status = 'accepted' AND user_id IS NOT ${except}`;

/** 統合案の元の法案の提出者と共同提出者 */
export const mergeOriginMembers = (mergedId: number, except: string | null = null) =>
	sql`SELECT b.user_id FROM bill_relations r JOIN bills b ON b.id = r.origin_bill_id WHERE r.merged_bill_id = ${mergedId} AND b.user_id IS NOT ${except}
	UNION SELECT c.user_id FROM bill_relations r JOIN bill_cosponsors c ON c.bill_id = r.origin_bill_id AND c.status = 'accepted' WHERE r.merged_bill_id = ${mergedId} AND c.user_id IS NOT ${except}`;

/**
 * 発議を知らせる。統合案は元の法案の人と統合案の共同提出者の和に1件（ふつうの申し出で加わった人もいる）。
 * ふつうの法案は共同提出者に。統合案かどうかの読み取りの失敗でも、元の操作を失敗させない
 */
export async function notifyProposed(db: Db, billId: number, rev: number, actorId: string, now: number): Promise<void> {
	try {
		const merged = await db.select({ id: billRelations.originBillId }).from(billRelations).where(eq(billRelations.mergedBillId, billId)).limit(1);
		if (merged.length) await notifyStatement(db, sql`${mergeOriginMembers(billId, actorId)} UNION ${billMembers(billId, actorId)}`, 'merge_proposed', billId, rev, now);
		else await notifyStatement(db, billMembers(billId, actorId), 'bill_proposed', billId, rev, now);
	} catch (e) {
		console.error(e);
	}
}

/** 確認の状態と結果から、届ける種類を決める式。確認の間は可決か否決かを出さない */
const OUTCOME_KIND = sql`CASE WHEN v.status = 'open' THEN 'bill_reviewing' WHEN v.status = 'voided' THEN 'bill_voided' WHEN r.outcome = 'passed' THEN 'bill_passed' WHEN r.outcome = 'rejected' THEN 'bill_rejected' ELSE 'bill_lapsed' END`;

/**
 * 会期の結果の通知（決めたこと5）。結果と確認と要調整の今の状態から入れるので、途中で失敗しても次の実行で届く。
 * 結果の行がない確認の行には入れない。提出者と共同提出者を別の文にして、全部の法案の和を作らない
 */
export async function notifyBillOutcomes(db: BatchDb, sessionKey: string, now: number): Promise<void> {
	const results = sql`FROM bill_results r LEFT JOIN vote_reviews v ON v.session_key = r.session_key AND v.bill_id = r.bill_id`;
	const insert = (select: SQL) => db.insert(notifications).select(select).onConflictDoNothing();
	try {
		await db.batch([
			insert(sql`SELECT NULL, b.user_id, ${OUTCOME_KIND}, r.bill_id, r.settled_at, ${now} ${results} JOIN bills b ON b.id = r.bill_id WHERE r.session_key = ${sessionKey}`),
			insert(sql`SELECT NULL, c.user_id, ${OUTCOME_KIND}, r.bill_id, r.settled_at, ${now} ${results} JOIN bill_cosponsors c ON c.bill_id = r.bill_id AND c.status = 'accepted' WHERE r.session_key = ${sessionKey}`),
			insert(sql`SELECT NULL, b.user_id, 'bill_adjustment', a.bill_id, a.created_at, ${now} FROM bill_adjustments a JOIN bills b ON b.id = a.bill_id WHERE a.session_key = ${sessionKey}`),
			insert(sql`SELECT NULL, c.user_id, 'bill_adjustment', a.bill_id, a.created_at, ${now} FROM bill_adjustments a JOIN bill_cosponsors c ON c.bill_id = a.bill_id AND c.status = 'accepted' WHERE a.session_key = ${sessionKey}`)
		] as never);
	} catch (e) {
		console.error(e);
	}
}
