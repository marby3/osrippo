// 統合案（Issue #76。設計書 docs/spec/76.md 決めたこと13）。元の法案は2本で、提出者が違う法案
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { actions, billCosponsors, billMergeConsents, billRelations, billSupports, bills } from '../db/schema';
import { billProgress, COSPONSOR_MAX, withdrawableSince } from '../domain/bills';
import { billById, createUnconfirmedDraft, draftInputOf, draftRefusal, savedBill, type Bill } from './bills';
import { refuse, type Actor } from './issues';
import type { BatchDb, Db } from './law';
import { mergeOriginMembers, notify } from './notifications';

type BillLike = NonNullable<Bill>;
const MERGED_SHOWN = 10;

/** 取り下げられる状態：下書きか、発議から採決が始まる前まで */
const removable = (bill: Pick<BillLike, 'status' | 'proposedAt'>, now: number, minutes: number | null) => {
	const progress = billProgress(bill, now, minutes);
	return progress === 'draft' || progress === 'proposed' || progress === 'deliberation';
};

/** 文の条件に入れる形（o は元の法案の別名） */
export const originRemovable = (now: number, minutes: number | null) => sql`(o.status = 'draft' OR (o.status = 'proposed' AND o.proposed_at >= ${withdrawableSince(now, minutes)}))`;

/** 元の法案の提出者と共同提出者 */
async function membersOf(db: Db, billIds: number[]) {
	if (!billIds.length) return [];
	const [authors, accepted] = await Promise.all([
		db.select({ billId: bills.id, userId: bills.userId }).from(bills).where(inArray(bills.id, billIds)),
		db.select({ billId: billCosponsors.billId, userId: billCosponsors.userId }).from(billCosponsors).where(and(inArray(billCosponsors.billId, billIds), eq(billCosponsors.status, 'accepted')))
	]);
	return [...authors, ...accepted];
}

const originIdsOf = async (db: Db, mergedId: number) =>
	(await db.select({ id: billRelations.originBillId }).from(billRelations).where(eq(billRelations.mergedBillId, mergedId)).orderBy(asc(billRelations.originBillId))).map((r) => r.id);

/** 統合案の側にある法案か（下書きも発議のあとも）。統合案を元にはできない */
const isMerged = async (db: Db, billId: number) => (await originIdsOf(db, billId)).length > 0;

export type MergeRefused = 'forbidden' | 'closed' | 'stale' | 'full';

/** 統合案を作る。自分の法案の読む版を複製する。同じ組があれば作らずそこへ移る */
export async function createMerge(db: Db, actor: Actor, bill: BillLike, withId: number, now: number, minutes: number | null) {
	const closed = (reason: MergeRefused) => ({ ok: false as const, reason });
	if (bill.userId !== actor.userId) return closed('forbidden');
	const [same] = await db
		.select({ id: bills.id })
		.from(bills)
		.where(
			and(
				savedBill,
				sql`EXISTS (SELECT 1 FROM bill_relations r WHERE r.merged_bill_id = ${bills}.id AND r.origin_bill_id = ${bill.id})`,
				sql`EXISTS (SELECT 1 FROM bill_relations r WHERE r.merged_bill_id = ${bills}.id AND r.origin_bill_id = ${withId})`
			)
		);
	if (same && bill.id !== withId) return { ok: true as const, id: same.id, created: false };

	const other = bill.id === withId ? undefined : await billById(db, withId);
	if (!other || other.userId === bill.userId || other.committeeId !== bill.committeeId) return closed('closed');
	if (!removable(bill, now, minutes) || !removable(other, now, minutes)) return closed('closed');
	if ((await isMerged(db, bill.id)) || (await isMerged(db, other.id))) return closed('closed');
	const members = new Set((await membersOf(db, [bill.id, other.id])).map((m) => m.userId));
	// 統合案の提出者を除いた全員が共同提出者になる
	if (members.size - 1 > COSPONSOR_MAX) return closed('closed');

	const refusal = await draftRefusal(db, actor, now);
	if (refusal) return refuse(db, actor, refusal, now);
	const id = await createUnconfirmedDraft(db, actor.userId, draftInputOf(bill), now);
	await db.insert(billRelations).values([bill.id, other.id].map((originBillId) => ({ mergedBillId: id, originBillId, createdAt: now })));
	await db.update(bills).set({ rev: 1 }).where(and(eq(bills.id, id), eq(bills.rev, 0)));
	await db.insert(actions).values({ kind: 'bill_draft', userId: actor.userId, ipHash: actor.ipHash, targetId: id, createdAt: now });
	await notify(db, mergeOriginMembers(id, actor.userId), 'merge_requested', id, 0, now);
	return { ok: true as const, id, created: true };
}

/**
 * 統合案の読んだ版に同意する。同意した人は統合案の共同提出者になり、賛同は外れる。
 * 3つの文を一緒に流し、どの文にも「統合案が下書きで、版が同じで、その人が元の法案の提出者か共同提出者」を入れる（確かめのあとに保存が走っても何も変わらない）
 */
export async function consentMerge(db: BatchDb, actor: Actor, merged: BillLike, rev: number, now: number): Promise<{ ok: true } | { ok: false; reason: MergeRefused }> {
	const origins = await originIdsOf(db, merged.id);
	if (!origins.length || merged.status !== 'draft') return { ok: false, reason: 'closed' };
	const members = await membersOf(db, origins);
	if (!members.some((m) => m.userId === actor.userId)) return { ok: false, reason: 'forbidden' };
	if (merged.rev !== rev) return { ok: false, reason: 'stale' };
	// 抜けた人と断られた人は同意できない（決定G・I）。統合案の行で見る
	const [seat] = await db.select({ status: billCosponsors.status }).from(billCosponsors).where(and(eq(billCosponsors.billId, merged.id), eq(billCosponsors.userId, actor.userId)));
	if (seat?.status === 'left' || seat?.status === 'declined') return { ok: false, reason: 'closed' };
	const json = JSON.stringify(origins);
	const belongs = sql`EXISTS (
		SELECT 1 FROM json_each(${json}) o
		WHERE EXISTS (SELECT 1 FROM bills b WHERE b.id = o.value AND b.user_id = ${actor.userId})
		OR EXISTS (SELECT 1 FROM bill_cosponsors c WHERE c.bill_id = o.value AND c.user_id = ${actor.userId} AND c.status = 'accepted')
	)`;
	const current = sql`EXISTS (SELECT 1 FROM bills m WHERE m.id = ${merged.id} AND m.status = 'draft' AND m.rev = ${rev}) AND ${belongs}`;
	const seated = sql`(${merged.userId} = ${actor.userId} OR EXISTS (SELECT 1 FROM bill_cosponsors c WHERE c.bill_id = ${merged.id} AND c.user_id = ${actor.userId} AND c.status = 'accepted'))`;
	const statements = [];
	if (merged.userId !== actor.userId) {
		statements.push(
			db
				.insert(billCosponsors)
				.select(sql`SELECT NULL, ${merged.id}, ${actor.userId}, 'accepted', ${now}, ${now} WHERE ${current} AND (SELECT count(*) FROM bill_cosponsors c WHERE c.bill_id = ${merged.id} AND c.status = 'accepted') < ${COSPONSOR_MAX}`)
				.onConflictDoUpdate({ target: [billCosponsors.billId, billCosponsors.userId], set: { status: 'accepted', acceptedAt: now }, where: eq(billCosponsors.status, 'requested') }),
			db.delete(billSupports).where(and(eq(billSupports.billId, merged.id), eq(billSupports.userId, actor.userId), current, seated))
		);
	}
	statements.push(
		db
			.insert(billMergeConsents)
			.select(
				sql`SELECT ${merged.id}, r.origin_bill_id, ${actor.userId}, ${rev}, ${now} FROM bill_relations r
				WHERE r.merged_bill_id = ${merged.id} AND ${current} AND ${seated}
				AND (EXISTS (SELECT 1 FROM bills b WHERE b.id = r.origin_bill_id AND b.user_id = ${actor.userId}) OR EXISTS (SELECT 1 FROM bill_cosponsors c WHERE c.bill_id = r.origin_bill_id AND c.user_id = ${actor.userId} AND c.status = 'accepted'))`
			)
			.onConflictDoUpdate({ target: [billMergeConsents.mergedBillId, billMergeConsents.originBillId, billMergeConsents.userId], set: { rev, createdAt: now } })
	);
	await db.batch(statements as never);

	const [consent] = await db
		.select({ rev: billMergeConsents.rev })
		.from(billMergeConsents)
		.where(and(eq(billMergeConsents.mergedBillId, merged.id), eq(billMergeConsents.userId, actor.userId), eq(billMergeConsents.rev, rev)));
	if (consent) return { ok: true };
	const [fresh] = await db.select({ rev: bills.rev, status: bills.status }).from(bills).where(eq(bills.id, merged.id));
	if (fresh?.rev !== rev) return { ok: false, reason: 'stale' };
	return { ok: false, reason: fresh.status === 'draft' ? 'full' : 'closed' };
}

/** 同意を取り消す。共同提出者のまま */
export async function revokeMerge(db: Db, actor: Actor, merged: BillLike) {
	if (merged.status !== 'draft') return false;
	const done = await db
		.delete(billMergeConsents)
		.where(and(eq(billMergeConsents.mergedBillId, merged.id), eq(billMergeConsents.userId, actor.userId), sql`EXISTS (SELECT 1 FROM bills m WHERE m.id = ${merged.id} AND m.status = 'draft')`))
		.returning({ id: billMergeConsents.originBillId });
	return done.length > 0;
}

/** 統合案をやめる：同意とつながりを消して普通の下書きに戻す。共同提出者はそのまま */
export async function cancelMerge(db: BatchDb, actor: Actor, merged: BillLike) {
	if (merged.userId !== actor.userId || merged.status !== 'draft') return false;
	if (!(await isMerged(db, merged.id))) return false;
	const draft = sql`EXISTS (SELECT 1 FROM bills m WHERE m.id = ${merged.id} AND m.status = 'draft')`;
	await db.batch([db.delete(billMergeConsents).where(and(eq(billMergeConsents.mergedBillId, merged.id), draft)), db.delete(billRelations).where(and(eq(billRelations.mergedBillId, merged.id), draft))] as never);
	return !(await isMerged(db, merged.id));
}

/** 元の法案ごとの、いまの版への同意の状況 */
async function consentState(db: Db, merged: Pick<BillLike, 'id' | 'userId' | 'rev'>, origins: number[]) {
	const [members, consents, seats] = await Promise.all([
		membersOf(db, origins),
		db
			.select({ originId: billMergeConsents.originBillId, userId: billMergeConsents.userId })
			.from(billMergeConsents)
			.where(and(eq(billMergeConsents.mergedBillId, merged.id), eq(billMergeConsents.rev, merged.rev))),
		db.select({ userId: billCosponsors.userId }).from(billCosponsors).where(and(eq(billCosponsors.billId, merged.id), eq(billCosponsors.status, 'accepted')))
	]);
	const seated = new Set([merged.userId, ...seats.map((s) => s.userId)]);
	const missing = members.filter((m) => !seated.has(m.userId) || !consents.some((c) => c.originId === m.billId && c.userId === m.userId));
	return { members, consents, missing };
}

/** 発議を断る理由。発議の文と同じ条件を、理由を出すために先に読む */
export async function mergeBlock(db: Db, bill: Pick<BillLike, 'id' | 'userId' | 'rev'>, now: number, minutes: number | null): Promise<'merge' | 'mergeClosed' | null> {
	const origins = await originIdsOf(db, bill.id);
	if (!origins.length) return null;
	const rows = await db.select({ status: bills.status, proposedAt: bills.proposedAt }).from(bills).where(inArray(bills.id, origins));
	if (rows.length !== origins.length || !rows.every((r) => removable(r, now, minutes))) return 'mergeClosed';
	return (await consentState(db, bill, origins)).missing.length ? 'merge' : null;
}

/**
 * 統合案を発議する。発議の文の条件に全部の確かめを入れ、同じ batch の次の文で元の法案を撤回する。
 * 確かめのあとに共同提出者が増えても、だれかが抜けても、採決が始まっても、元の法案は撤回されない
 */
export async function proposeMerged(db: BatchDb, actor: Actor, bill: Pick<BillLike, 'id' | 'rev'>, rev: number, required: number, now: number, minutes: number | null) {
	const M = bill.id;
	await db.batch([
		db
			.update(bills)
			.set({ status: 'proposed', proposedAt: now, proposedRev: sql`rev`, updatedAt: now })
			.where(
				sql`id = ${M} AND user_id = ${actor.userId} AND status = 'draft' AND rev = ${rev}
				AND (SELECT count(*) FROM bill_supports s WHERE s.bill_id = ${M} AND s.rev = ${rev} AND s.user_id <> ${actor.userId}) >= ${required}
				AND (SELECT count(*) FROM bill_relations r WHERE r.merged_bill_id = ${M}) = 2
				AND NOT EXISTS (
					SELECT 1 FROM bill_relations r JOIN bills o ON o.id = r.origin_bill_id WHERE r.merged_bill_id = ${M} AND NOT ${originRemovable(now, minutes)}
				)
				AND NOT EXISTS (
					SELECT 1 FROM bill_relations r
					JOIN (SELECT o.id AS origin, o.user_id AS member FROM bills o UNION ALL SELECT c.bill_id, c.user_id FROM bill_cosponsors c WHERE c.status = 'accepted') people ON people.origin = r.origin_bill_id
					WHERE r.merged_bill_id = ${M}
					AND (
						NOT EXISTS (SELECT 1 FROM bill_merge_consents k WHERE k.merged_bill_id = ${M} AND k.origin_bill_id = r.origin_bill_id AND k.user_id = people.member AND k.rev = ${rev})
						OR (people.member <> ${actor.userId} AND NOT EXISTS (SELECT 1 FROM bill_cosponsors c WHERE c.bill_id = ${M} AND c.user_id = people.member AND c.status = 'accepted'))
					)
				)`
			),
		db
			.update(bills)
			.set({ status: 'withdrawn', withdrawnAt: now, updatedAt: now })
			.where(
				sql`id IN (SELECT r.origin_bill_id FROM bill_relations r WHERE r.merged_bill_id = ${M})
				AND EXISTS (SELECT 1 FROM bills m WHERE m.id = ${M} AND m.status = 'proposed' AND m.proposed_at = ${now})
				AND (status = 'draft' OR (status = 'proposed' AND proposed_at >= ${withdrawableSince(now, minutes)}))`
			)
	] as never);
	const [row] = await db.select({ status: bills.status }).from(bills).where(eq(bills.id, M));
	return row?.status === 'proposed';
}

/** 画面のリンク。元の法案のページの統合案は、発議の前は元の法案の提出者と共同提出者にだけ（他人のページへ好きな題名を載せられないように） */
export async function mergeLinksOf(db: Db, bill: Pick<BillLike, 'id' | 'userId' | 'rev' | 'status'>, userId: string | null) {
	const origins = await originIdsOf(db, bill.id);
	const titled = origins.length ? await db.select({ id: bills.id, title: bills.title }).from(bills).where(inArray(bills.id, origins)).orderBy(asc(bills.id)) : [];
	const state = origins.length ? await consentState(db, bill, origins) : null;
	const members = state?.members ?? [];
	const member = userId !== null && members.some((m) => m.userId === userId);
	const [seatRow] = state && userId !== null ? await db.select({ status: billCosponsors.status }).from(billCosponsors).where(and(eq(billCosponsors.billId, bill.id), eq(billCosponsors.userId, userId))) : [];
	const seat = seatRow?.status ?? null;
	const asMerged = {
		origins: titled.map((o) => ({ ...o, waiting: bill.status === 'draft' && Boolean(state?.missing.some((m) => m.billId === o.id)) })),
		consent: state
			? {
					// 両方の元の法案に属する人も1人に数える
					total: new Set(members.map((m) => m.userId)).size,
					consented: new Set(members.map((m) => m.userId)).size - new Set(state.missing.map((m) => m.userId)).size,
					member,
					isAuthor: userId === bill.userId,
					// 抜けた人と断られた人は同意できない（決定G・I）
					canConsent: member && seat !== 'left' && seat !== 'declined',
					mine: member && !state.missing.some((m) => m.userId === userId)
				}
			: null
	};
	const isMember = userId !== null && (bill.userId === userId || (await membersOf(db, [bill.id])).some((m) => m.userId === userId));
	const rows = await db
		.select({ id: bills.id, title: bills.title, status: bills.status })
		.from(billRelations)
		.innerJoin(bills, eq(bills.id, billRelations.mergedBillId))
		.where(and(eq(billRelations.originBillId, bill.id), savedBill))
		.orderBy(desc(bills.id));
	// 見える範囲で絞ってから切る（新しい下書きに押されて発議済みの統合案が消えないように）
	const merged = rows.filter((r) => r.status !== 'draft' || isMember).slice(0, MERGED_SHOWN);
	// 統合案があとで撤回されても、統合された事実は残す（統合案は発議を経ないと撤回にならない）
	const into = rows.find((r) => r.status !== 'draft');
	return { ...asMerged, merged: merged.map(({ id, title }) => ({ id, title })), mergedInto: bill.status === 'withdrawn' && into ? { id: into.id, title: into.title } : null };
}

/** 統合案を作れるか（画面のボタン用）：取り下げられる状態で、統合案でない */
export async function canStartMerge(db: Db, bill: BillLike, now: number, minutes: number | null) {
	return removable(bill, now, minutes) && !(await isMerged(db, bill.id));
}
