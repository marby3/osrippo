// 廃案・否決の法案からの出し直し（Issue #75。設計書 docs/spec/75.md）
import { and, eq, sql } from 'drizzle-orm';
import { actions, bills } from '../db/schema';
import { canResubmit, type BillStage } from '../domain/votes';
import { createUnconfirmedDraft, draftInputOf, draftRefusal, savedBill, type Bill } from './bills';
import { repealedLawIds } from './if-world';
import { refuse, type Actor } from './issues';
import type { Db } from './law';

/** この法案から出し直した法案。確定した行だけ（リンクは確定のときに入れる） */
async function resubmittedOf(db: Db, billId: number) {
	const [row] = await db
		.select({ id: bills.id, title: bills.title })
		.from(bills)
		.where(and(eq(bills.resubmittedFrom, billId), savedBill))
		.limit(1);
	return row ?? null;
}

/** 出し直せるかと、出し直した法案。提出者かどうかは呼ぶ側が確かめる */
export async function resubmitStateOf(db: Db, bill: { id: number; laws: { lawId: string | null }[] }, stage: BillStage) {
	const repealed = await repealedLawIds(db);
	// すべての法令が廃止されたときだけ断る。一部なら、写した下書きで廃止された法令を外せる（docs/spec/53.md 決めたこと5）
	const lawGone = bill.laws.every((l) => l.lawId !== null && repealed.has(l.lawId));
	return { can: canResubmit(stage, lawGone), next: await resubmittedOf(db, bill.id) };
}

/**
 * 作りかけの下書きを確定する。D1 は書き込みを順に処理するので、同時に押しても確定するのは1つだけ（1つの法案からの出し直しは1本）。
 * 確定できなければ false。作りかけの行は残るが、読むところはすべて savedBill で除く
 */
export async function confirmResubmit(db: Db, draftId: number, originId: number, now: number) {
	const done = await db
		.update(bills)
		.set({ rev: 1, resubmittedFrom: originId, updatedAt: now })
		.where(and(eq(bills.id, draftId), eq(bills.rev, 0), sql`NOT EXISTS (SELECT 1 FROM bills b WHERE b.resubmitted_from = ${originId})`))
		.returning({ id: bills.id });
	return done.length > 0;
}

/** 読む版の中身を複製した新しい下書きを作る。すでに出し直した法案があれば、作らずその番号を返す */
export async function resubmitBill(db: Db, actor: Actor, bill: NonNullable<Bill>, now: number) {
	const known = await resubmittedOf(db, bill.id);
	if (known) return { ok: true as const, id: known.id, created: false };
	const refusal = await draftRefusal(db, actor, now);
	if (refusal) return refuse(db, actor, refusal, now);

	const id = await createUnconfirmedDraft(db, actor.userId, draftInputOf(bill), now);
	if (!(await confirmResubmit(db, id, bill.id, now))) {
		// 同時に押した相手が先に確定した。確定した行は消えないので必ずある
		const winner = await resubmittedOf(db, bill.id);
		if (!winner) throw new Error(`法案 ${bill.id} の出し直しを確定できませんでした`);
		return { ok: true as const, id: winner.id, created: false };
	}
	await db.insert(actions).values({ kind: 'bill_draft', userId: actor.userId, ipHash: actor.ipHash, targetId: id, createdAt: now });
	return { ok: true as const, id, created: true };
}
