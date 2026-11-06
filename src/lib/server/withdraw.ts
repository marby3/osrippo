// 撤回（Issue #76。設計書 docs/spec/76.md 決めたこと12）。提出者と共同提出者の全員の同意で、採決が始まる前まで
import { and, eq, sql } from 'drizzle-orm';
import { actions, billCosponsors, billWithdrawConsents, bills, user } from '../db/schema';
import { billProgress, withdrawableSince } from '../domain/bills';
import { supportRev, type Bill } from './bills';
import { cosponsorStatus } from './cosponsors';
import type { Actor } from './issues';
import type { BatchDb, Db } from './law';
import { billMembers, notify } from './notifications';

type BillLike = NonNullable<Bill>;

/** 同意する人：提出者と共同提出者（抜けた人は入らない） */
async function isMember(db: Db, bill: BillLike, userId: string) {
	return bill.userId === userId || (await cosponsorStatus(db, bill.id, userId)) === 'accepted';
}

/** 同意する。最後の1人で撤回になる。同意の行と確定の文を一緒に流すので、押し直しでも確定の文が走る */
export async function consentWithdraw(db: BatchDb, actor: Actor, bill: BillLike, now: number, minutes: number | null): Promise<{ ok: true; withdrawn: boolean } | { ok: false; reason: 'forbidden' | 'closed' }> {
	if (!(await isMember(db, bill, actor.userId))) return { ok: false, reason: 'forbidden' };
	const progress = billProgress(bill, now, minutes);
	if (progress !== 'proposed' && progress !== 'deliberation') return { ok: false, reason: 'closed' };
	const rev = supportRev(bill);
	await db.batch([
		db.insert(billWithdrawConsents).values({ billId: bill.id, proposedRev: rev, userId: actor.userId, createdAt: now }).onConflictDoNothing(),
		db
			.update(bills)
			.set({ status: 'withdrawn', withdrawnAt: now, updatedAt: now })
			.where(
				sql`${eq(bills.id, bill.id)} AND status = 'proposed' AND proposed_at >= ${withdrawableSince(now, minutes)} AND proposed_rev = ${rev}
				AND NOT EXISTS (
					SELECT 1 FROM (SELECT m.user_id AS member FROM bills m WHERE m.id = ${bill.id} UNION ALL SELECT c.user_id FROM bill_cosponsors c WHERE c.bill_id = ${bill.id} AND c.status = 'accepted') people
					WHERE NOT EXISTS (SELECT 1 FROM bill_withdraw_consents w WHERE w.bill_id = ${bill.id} AND w.proposed_rev = ${rev} AND w.user_id = people.member)
				)`
			)
	] as never);
	const [row] = await db.select({ status: bills.status, at: bills.withdrawnAt }).from(bills).where(eq(bills.id, bill.id));
	if (row?.status !== 'withdrawn') {
		// 同意した人には求めない（今押した人も同意の行に入っている）
		await notify(db, sql`SELECT user_id FROM (${billMembers(bill.id)}) WHERE user_id NOT IN (SELECT w.user_id FROM bill_withdraw_consents w WHERE w.bill_id = ${bill.id} AND w.proposed_rev = ${rev})`, 'withdraw_requested', bill.id, rev, now);
		return { ok: true, withdrawn: false };
	}
	if (row.at === now) {
		await db.insert(actions).values({ kind: 'bill_withdraw', userId: actor.userId, ipHash: actor.ipHash, targetId: bill.id, createdAt: now });
		await notify(db, billMembers(bill.id, actor.userId), 'bill_withdrawn', bill.id, 0, now);
	}
	return { ok: true, withdrawn: true };
}

/** 同意を取り消す。撤回になったあとは取り消せない */
export async function cancelWithdraw(db: Db, actor: Actor, bill: BillLike) {
	const done = await db
		.delete(billWithdrawConsents)
		.where(and(eq(billWithdrawConsents.billId, bill.id), eq(billWithdrawConsents.userId, actor.userId), sql`EXISTS (SELECT 1 FROM bills b WHERE b.id = ${bill.id} AND b.status = 'proposed')`))
		.returning({ id: billWithdrawConsents.billId });
	return done.length > 0;
}

/** 同意の状況 */
export async function withdrawStateOf(db: Db, bill: BillLike, userId: string | null = null) {
	const rev = supportRev(bill);
	const accepted = await db.select({ userId: billCosponsors.userId }).from(billCosponsors).where(and(eq(billCosponsors.billId, bill.id), eq(billCosponsors.status, 'accepted')));
	const members = new Set([bill.userId, ...accepted.map((r) => r.userId)]);
	const rows = await db
		.select({ userId: billWithdrawConsents.userId, name: user.name })
		.from(billWithdrawConsents)
		.innerJoin(user, eq(user.id, billWithdrawConsents.userId))
		.where(and(eq(billWithdrawConsents.billId, bill.id), eq(billWithdrawConsents.proposedRev, rev)));
	const counted = rows.filter((r) => members.has(r.userId));
	return { total: members.size, consented: counted.length, names: counted.map((r) => r.name), member: userId !== null && members.has(userId), mine: counted.some((r) => r.userId === userId) };
}
