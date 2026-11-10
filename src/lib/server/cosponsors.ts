// 共同提出者（Issue #76。設計書 docs/spec/76.md）。下書きのあいだだけ変えられ、発議で固定する
import { and, asc, count, eq, gt, sql } from 'drizzle-orm';
import { actions, billCosponsors, billSupports, user } from '../db/schema';
import { COSPONSOR_MAX } from '../domain/bills';
import { checkBillCosponsor, DAY } from '../domain/limits';
import { answererRole, type BillRole } from '../domain/posts';
import type { Bill } from './bills';
import { refuse, type Actor } from './issues';
import type { BatchDb, Db } from './law';
import { notify, oneUser } from './notifications';
import { isSupporter } from './posts';
import { personOf, verifiedColumns, verifiedJoin, verifiedTable } from './verifications';

export type CosponsorStatus = 'requested' | 'accepted' | 'left' | 'declined';
type BillLike = Pick<NonNullable<Bill>, 'id' | 'userId' | 'status'>;
const REQUESTS_SHOWN = 20;

/** その人の行の状態。なければ null */
export async function cosponsorStatus(db: Db, billId: number, userId: string): Promise<CosponsorStatus | null> {
	const [row] = await db
		.select({ status: billCosponsors.status })
		.from(billCosponsors)
		.where(and(eq(billCosponsors.billId, billId), eq(billCosponsors.userId, userId)));
	return row?.status ?? null;
}

/** 下書きを編集できるか。申し出ているだけでは編集できない */
export async function canEditDraft(db: Db, bill: BillLike, userId: string) {
	if (bill.status !== 'draft') return false;
	return bill.userId === userId || (await cosponsorStatus(db, bill.id, userId)) === 'accepted';
}

/** 提出者の側か（提出者、共同提出者、一度でも共同提出者になった人。決定G） */
export async function isBillSide(db: Db, bill: BillLike, userId: string) {
	if (bill.userId === userId) return true;
	const status = await cosponsorStatus(db, bill.id, userId);
	return status === 'accepted' || status === 'left';
}

/** その人の役割。答弁と評価はすべてここから求める（抜けた人は former で、答弁はできず、評価では提出者の側） */
export async function billRoleOf(db: Db, bill: Pick<NonNullable<Bill>, 'id' | 'userId' | 'rev' | 'proposedRev'>, userId: string | null): Promise<BillRole | null> {
	if (userId === null) return null;
	if (bill.userId === userId) return 'author';
	const status = await cosponsorStatus(db, bill.id, userId);
	if (status === 'left') return 'former';
	return answererRole(bill, userId, status !== 'accepted' && (await isSupporter(db, bill, userId)), status === 'accepted');
}

/** 名前を出す共同提出者（承認の順） */
export async function cosponsorsOf(db: Db, billId: number, now: number) {
	const rows = await db
		.select({ name: user.name, ...verifiedColumns })
		.from(billCosponsors)
		.innerJoin(user, eq(user.id, billCosponsors.userId))
		.leftJoin(verifiedTable, verifiedJoin(now))
		.where(and(eq(billCosponsors.billId, billId), eq(billCosponsors.status, 'accepted')))
		.orderBy(asc(billCosponsors.acceptedAt), asc(billCosponsors.id));
	return rows.map(personOf);
}

/** 提出者に出す一覧。内部IDは渡さず、行の番号で指す */
export async function cosponsorPanel(db: Db, billId: number, now: number) {
	const rows = await db
		.select({ id: billCosponsors.id, name: user.name, status: billCosponsors.status, ...verifiedColumns })
		.from(billCosponsors)
		.innerJoin(user, eq(user.id, billCosponsors.userId))
		.leftJoin(verifiedTable, verifiedJoin(now))
		.where(eq(billCosponsors.billId, billId))
		.orderBy(asc(billCosponsors.id));
	const requests = rows.filter((r) => r.status === 'requested');
	return {
		requests: requests.slice(0, REQUESTS_SHOWN).map((r) => ({ id: r.id, person: personOf(r) })),
		moreRequests: Math.max(0, requests.length - REQUESTS_SHOWN),
		members: rows.filter((r) => r.status === 'accepted').map((r) => ({ id: r.id, person: personOf(r) })),
		full: rows.filter((r) => r.status === 'accepted').length >= COSPONSOR_MAX
	};
}

export type CosponsorRefused = 'author' | 'closed' | 'left' | 'declined' | 'forbidden' | 'full';

/** 申し出る。いまと同じ状態への操作は何もせず成功にする。記録と上限はここだけ */
export async function requestCosponsor(db: Db, actor: Actor, bill: BillLike, now: number) {
	const closed = (reason: CosponsorRefused) => ({ ok: false as const, reason });
	if (bill.status !== 'draft') return closed('closed');
	if (bill.userId === actor.userId) return closed('author');
	const status = await cosponsorStatus(db, bill.id, actor.userId);
	if (status === 'left' || status === 'declined') return closed(status);
	if (status) return { ok: true as const, changed: false };
	const [day] = await db
		.select({ n: count() })
		.from(actions)
		.where(and(eq(actions.kind, 'bill_cosponsor'), eq(actions.userId, actor.userId), gt(actions.createdAt, now - DAY)));
	const refusal = checkBillCosponsor({ accountDay: day.n });
	if (refusal) return refuse(db, actor, refusal, now);
	const added = await db
		.insert(billCosponsors)
		.select(sql`SELECT NULL, id, ${actor.userId}, 'requested', ${now}, NULL FROM bills WHERE id = ${bill.id} AND status = 'draft' AND rev > 0 AND user_id <> ${actor.userId}`)
		.onConflictDoNothing()
		.returning({ id: billCosponsors.id });
	if (added.length === 0) return closed('closed');
	await db.insert(actions).values({ kind: 'bill_cosponsor', userId: actor.userId, ipHash: actor.ipHash, targetId: bill.id, createdAt: now });
	await notify(db, oneUser(bill.userId), 'cosponsor_requested', bill.id, added[0].id, now);
	return { ok: true as const, changed: true };
}

/** 申し出の行の人 */
const seatUser = (rowId: number) => sql`SELECT user_id FROM bill_cosponsors WHERE id = ${rowId}`;

const stillDraft = (billId: number) => sql`EXISTS (SELECT 1 FROM bills b WHERE b.id = ${billId} AND b.status = 'draft')`;

/** 本人が申し出を取り下げる（行を消すので、また申し出られる） */
export async function cancelCosponsorRequest(db: Db, actor: Actor, bill: BillLike) {
	const done = await db
		.delete(billCosponsors)
		.where(and(eq(billCosponsors.billId, bill.id), eq(billCosponsors.userId, actor.userId), eq(billCosponsors.status, 'requested'), stillDraft(bill.id)))
		.returning({ id: billCosponsors.id });
	return done.length > 0;
}

/** 提出者が申し出を決める。承認の文と賛同を消す文を一緒に流し、賛同を消す文にも状態を条件に入れる（通らなかった承認で賛同だけ消さない） */
export async function decideCosponsor(db: BatchDb, actor: Actor, bill: BillLike, rowId: number, decision: 'accept' | 'decline', now: number): Promise<{ ok: true } | { ok: false; reason: CosponsorRefused }> {
	if (bill.userId !== actor.userId) return { ok: false, reason: 'forbidden' };
	const here = and(eq(billCosponsors.id, rowId), eq(billCosponsors.billId, bill.id));
	if (decision === 'decline') {
		const done = await db
			.update(billCosponsors)
			.set({ status: 'declined' })
			.where(and(here, eq(billCosponsors.status, 'requested'), stillDraft(bill.id)))
			.returning({ id: billCosponsors.id });
		if (!done.length) return { ok: false, reason: 'closed' };
		await notify(db, seatUser(rowId), 'cosponsor_declined', bill.id, rowId, now);
		return { ok: true };
	}
	await db.batch([
		db
			.update(billCosponsors)
			.set({ status: 'accepted', acceptedAt: now })
			.where(and(here, eq(billCosponsors.status, 'requested'), stillDraft(bill.id), sql`(SELECT count(*) FROM bill_cosponsors c WHERE c.bill_id = ${bill.id} AND c.status = 'accepted') < ${COSPONSOR_MAX}`)),
		db.delete(billSupports).where(and(eq(billSupports.billId, bill.id), sql`user_id = (SELECT c.user_id FROM bill_cosponsors c WHERE c.id = ${rowId} AND c.bill_id = ${bill.id} AND c.status = 'accepted')`, stillDraft(bill.id)))
	] as never);
	const [row] = await db.select({ status: billCosponsors.status }).from(billCosponsors).where(here);
	if (row?.status === 'accepted') {
		await notify(db, seatUser(rowId), 'cosponsor_accepted', bill.id, rowId, now);
		return { ok: true };
	}
	if (row?.status !== 'requested') return { ok: false, reason: 'closed' };
	const [draft] = await db.all<unknown[]>(sql`SELECT 1 FROM bills WHERE id = ${bill.id} AND status = 'draft'`);
	return { ok: false, reason: draft ? 'full' : 'closed' };
}

/** 抜ける（rowId が null）か、提出者が外す。left は戻らない（決定G） */
export async function leaveCosponsor(db: Db, actor: Actor, bill: BillLike, rowId: number | null, now: number): Promise<{ ok: true } | { ok: false; reason: CosponsorRefused }> {
	if (bill.status !== 'draft') return { ok: false, reason: 'closed' };
	if (rowId !== null && bill.userId !== actor.userId) return { ok: false, reason: 'forbidden' };
	const who = rowId !== null ? eq(billCosponsors.id, rowId) : eq(billCosponsors.userId, actor.userId);
	const done = await db
		.update(billCosponsors)
		.set({ status: 'left' })
		.where(and(eq(billCosponsors.billId, bill.id), who, eq(billCosponsors.status, 'accepted'), stillDraft(bill.id)))
		.returning({ id: billCosponsors.id });
	if (done.length) {
		// 抜けたことは提出者に、外したことは外された人に
		if (rowId === null) await notify(db, oneUser(bill.userId), 'cosponsor_left', bill.id, done[0].id, now);
		else await notify(db, seatUser(rowId), 'cosponsor_removed', bill.id, rowId, now);
		return { ok: true };
	}
	return { ok: false, reason: rowId === null ? 'forbidden' : 'closed' };
}
