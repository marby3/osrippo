// 法案の下書きを作る・保存する・読む（設計書 docs/spec/45.md 決めたこと1・7・8）。
// 受け取る値は、呼ぶ側（#46）が validateBill・checkChanges・基にした版の比べを通したもの。ここでは確かめずに書く
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { billChanges, billLaws, bills, billSolutions } from '../db/schema';
import { compareNum, type Paragraph } from '../domain/law';
import type { BillChange, BillKind } from '../domain/bills';
import type { Db } from './law';

/** 作りかけ（rev = 0）を除く条件。法案を引くところは必ずこれを使う */
export const savedBill = gt(bills.rev, 0);

export type DraftLaw = { action: BillKind; lawId: string | null; baseRevisionId: string | null; newTitle: string | null; changes: BillChange[] };
export type DraftInput = {
	kind: BillKind;
	committeeId: number;
	title: string;
	affected: string;
	sideEffects: string;
	summary: string | null;
	supplementary: string | null;
	laws: DraftLaw[];
	solutionIds: number[];
};

/** D1 は1文に100個までしか値を結び付けられないので、行を分けて入れる（bill_changes は1行8個） */
const CHANGE_ROWS_PER_STATEMENT = 12;

/** 版 rev の子の行（対象の法令 → 変更点 → 元になった解決策の順。変更点は法令への外部キーを持つ） */
async function insertContent(db: Db, billId: number, rev: number, input: DraftInput) {
	await db.insert(billLaws).values(
		input.laws.map((l, seq) => ({ billId, rev, seq, action: l.action, lawId: l.lawId, baseRevisionId: l.baseRevisionId, newTitle: l.newTitle }))
	);
	const changes = input.laws.flatMap((l, lawSeq) =>
		l.changes.map((c) => ({
			billId,
			rev,
			lawSeq,
			num: c.num,
			op: c.op,
			provisionId: c.provisionId,
			// 空の見出しは NULL にそろえる（任意の欄は空なら NULL）
			caption: c.caption || null,
			body: c.paragraphs === null ? null : JSON.stringify(c.paragraphs)
		}))
	);
	for (let i = 0; i < changes.length; i += CHANGE_ROWS_PER_STATEMENT) {
		await db.insert(billChanges).values(changes.slice(i, i + CHANGE_ROWS_PER_STATEMENT));
	}
	await db.insert(billSolutions).values(input.solutionIds.map((solutionId, seq) => ({ billId, rev, seq, solutionId })));
}

const fields = (input: DraftInput) => ({
	title: input.title,
	affected: input.affected,
	sideEffects: input.sideEffects,
	summary: input.summary,
	supplementary: input.supplementary
});

/** 下書きを作り、法案の番号を返す。rev = 0 で足し、中身を版 1 で入れてから rev = 1 にする */
export async function createDraft(db: Db, userId: string, input: DraftInput, now: number): Promise<number> {
	const [row] = await db
		.insert(bills)
		.values({ userId, committeeId: input.committeeId, kind: input.kind, rev: 0, nextRev: 2, ...fields(input), createdAt: now, updatedAt: now })
		.returning({ id: bills.id });
	await insertContent(db, row.id, 1, input);
	await db.update(bills).set({ rev: 1 }).where(and(eq(bills.id, row.id), eq(bills.rev, 0)));
	return row.id;
}

/**
 * 下書きを保存する。開いたときの rev（expectedRev）と同じで、提出者で、下書きのときだけ。保存したかを返す。
 * 版の番号は保存のたびに必ず違う値を取るので、同時に保存しても子の行は混ざらない。負けた保存の子の行は、どの rev からも指されず読まれない
 */
export async function saveDraft(db: Db, billId: number, userId: string, expectedRev: number, input: DraftInput, now: number): Promise<boolean> {
	if (!Number.isInteger(expectedRev) || expectedRev < 1) return false;
	// kind は作ったあとは変えないので、違う kind の中身は保存しない
	const editable = and(eq(bills.id, billId), eq(bills.userId, userId), eq(bills.status, 'draft'), eq(bills.kind, input.kind), savedBill);
	// 開いたときの rev でなければ、子の行を書く前に止める（古い画面から何度押しても行が増えないように）。
	// 同時の保存は両方ここを通りうるが、最後の UPDATE で片方だけが通る
	const [taken] = await db
		.update(bills)
		.set({ nextRev: sql`${bills.nextRev} + 1` })
		.where(and(editable, eq(bills.rev, expectedRev)))
		.returning({ next: bills.nextRev });
	if (!taken) return false;
	const rev = taken.next - 1;
	await insertContent(db, billId, rev, input);
	const done = await db
		.update(bills)
		.set({ rev, ...fields(input), updatedAt: now })
		.where(and(editable, eq(bills.rev, expectedRev)))
		.returning({ id: bills.id });
	return done.length === 1;
}

export type Bill = Awaited<ReturnType<typeof billById>>;

/** 法案（bills.rev の版の中身）。作りかけか、ない番号なら undefined */
export async function billById(db: Db, billId: number) {
	const [bill] = await db
		.select()
		.from(bills)
		.where(and(eq(bills.id, billId), savedBill));
	if (!bill) return undefined;
	const at = (t: typeof billLaws | typeof billChanges | typeof billSolutions) => and(eq(t.billId, billId), eq(t.rev, bill.rev));
	const [laws, changes, solutions] = await Promise.all([
		db.select().from(billLaws).where(at(billLaws)).orderBy(asc(billLaws.seq)),
		db.select().from(billChanges).where(at(billChanges)),
		db.select().from(billSolutions).where(at(billSolutions)).orderBy(asc(billSolutions.seq))
	]);
	const { nextRev: _, ...rest } = bill;
	return {
		...rest,
		laws: laws.map((l) => ({
			seq: l.seq,
			action: l.action,
			lawId: l.lawId,
			baseRevisionId: l.baseRevisionId,
			newTitle: l.newTitle,
			changes: changes
				.filter((c) => c.lawSeq === l.seq)
				.sort((a, b) => compareNum(a.num, b.num))
				.map(
					(c): BillChange => ({
						op: c.op,
						num: c.num,
						provisionId: c.provisionId,
						caption: c.caption,
						paragraphs: c.body === null ? null : (JSON.parse(c.body) as Paragraph[])
					})
				)
		})),
		solutionIds: solutions.map((s) => s.solutionId)
	};
}
