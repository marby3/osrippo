// 法案の下書きを作る・保存する・読む（設計書 docs/spec/45.md 決めたこと1・7・8）。
// 受け取る値は、呼ぶ側（#46）が validateBill・checkChanges・基にした版の比べを通したもの。ここでは確かめずに書く
import { and, asc, count, eq, gt, inArray, sql, type SQL } from 'drizzle-orm';
import { actions, billChanges, billLaws, bills, billSolutions, committeeLaws, issues, laws, solutions, user } from '../db/schema';
import { articleBodyText, articleLabel, compareNum, type DiffPart, type Paragraph } from '../domain/law';
import { changeDiff, DIFF_MAX_EDIT, DIFF_PAGE_BUDGET, formalName, type BillChange, type BillKind } from '../domain/bills';
import { checkBillDraft, checkBillSave, DAY } from '../domain/limits';
import { LISTED, SOLUTION_SHOWN as SHOWN } from '../domain/reports';
import { refuse, type Actor } from './issues';
import { articlesOfRevision, currentRevision, type Db } from './law';

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

// ---- 書く画面と法案のページ（Issue #46） ----

/** 委員会の対象の法令（書く画面の「対象の法令」） */
export async function committeeLawList(db: Db, committeeId: number) {
	return db
		.select({ id: laws.id, title: laws.title })
		.from(committeeLaws)
		.innerJoin(laws, eq(laws.id, committeeLaws.lawId))
		.where(eq(committeeLaws.committeeId, committeeId))
		.orderBy(asc(laws.id));
}

/** 書く画面に出す法令の条：いま施行されている版と、その条の見出しと本文。委員会の対象でなければ undefined */
export async function draftArticles(db: Db, committeeId: number, lawId: string) {
	const [allowed] = await db
		.select({ id: committeeLaws.lawId })
		.from(committeeLaws)
		.where(and(eq(committeeLaws.committeeId, committeeId), eq(committeeLaws.lawId, lawId)));
	const current = allowed && (await currentRevision(db, lawId));
	if (!current) return undefined;
	const articles = await articlesOfRevision(db, current.id);
	return {
		revisionId: current.id,
		articles: articles.map((a) => ({ num: a.num, label: a.label, caption: a.caption, body: articleBodyText(a.paragraphs) }))
	};
}

/** 表示中の解決策と、その課題（課題が一覧に出る状態のときだけ） */
export async function citableSolution(db: Db, solutionId: number) {
	const [row] = await db
		.select({ id: solutions.id, issueId: solutions.issueId })
		.from(solutions)
		.innerJoin(issues, eq(issues.id, solutions.issueId))
		.where(and(eq(solutions.id, solutionId), inArray(solutions.status, SHOWN), inArray(issues.status, LISTED)));
	return row;
}

/** 引用の候補：その課題の表示中の解決策（古い順） */
export async function candidateSolutions(db: Db, issueId: number) {
	return db
		.select({ id: solutions.id, body: solutions.body })
		.from(solutions)
		.where(and(eq(solutions.issueId, issueId), inArray(solutions.status, SHOWN)))
		.orderBy(asc(solutions.id));
}

const countSince = async (db: Db, kind: 'bill_draft' | 'bill_save', who: SQL, now: number) => {
	const [row] = await db
		.select({ n: count() })
		.from(actions)
		.where(and(eq(actions.kind, kind), who, gt(actions.createdAt, now - DAY)));
	return row.n;
};

/** 上限を確かめて下書きを作る（Issue #46 決めたこと2） */
export async function createDraftLimited(db: Db, actor: Actor, input: DraftInput, now: number) {
	const refusal = checkBillDraft({
		accountDrafts: await countSince(db, 'bill_draft', eq(actions.userId, actor.userId), now),
		ipDrafts: await countSince(db, 'bill_draft', eq(actions.ipHash, actor.ipHash), now)
	});
	if (refusal) return refuse(db, actor, refusal, now);
	const id = await createDraft(db, actor.userId, input, now);
	await db.insert(actions).values({ kind: 'bill_draft', userId: actor.userId, ipHash: actor.ipHash, targetId: id, createdAt: now });
	return { ok: true as const, id };
}

/** 上限を確かめて下書きを保存する。saved が false なら、ほかの画面で先に保存された */
export async function saveDraftLimited(db: Db, actor: Actor, billId: number, expectedRev: number, input: DraftInput, now: number) {
	const refusal = checkBillSave({ accountSaves: await countSince(db, 'bill_save', eq(actions.userId, actor.userId), now) });
	if (refusal) return refuse(db, actor, refusal, now);
	const saved = await saveDraft(db, billId, actor.userId, expectedRev, input, now);
	if (saved) await db.insert(actions).values({ kind: 'bill_save', userId: actor.userId, ipHash: actor.ipHash, targetId: billId, createdAt: now });
	return { ok: true as const, saved };
}

/** 条の文字列（見出しがなければ本文だけ） */
const textOf = (caption: string | null, paragraphs: Paragraph[]) => [caption ?? '', articleBodyText(paragraphs)].filter(Boolean).join('\n');

export type ChangeView = { location: string; op: 'amend' | 'add' | 'delete' | 'supplementary'; before: DiffPart[] | null; after: DiffPart[] | null };

const changesOf = (bill: NonNullable<Bill>) => bill.laws.reduce((n, l) => n + l.changes.length, 0);

/** 法案のページの上の部分と概要のタブに出すもの。文字の比べは変更点のタブだけで行う（billChangeViews） */
export async function billView(db: Db, bill: NonNullable<Bill>) {
	const [author] = await db.select({ name: user.name }).from(user).where(eq(user.id, bill.userId));
	const lawIds = bill.laws.map((l) => l.lawId).filter((id): id is string => id !== null);
	const titles = new Map(
		(lawIds.length ? await db.select({ id: laws.id, title: laws.title }).from(laws).where(inArray(laws.id, lawIds)) : []).map((r) => [r.id, r.title])
	);
	const lawTitle = (l: (typeof bill.laws)[number]) => (l.lawId ? (titles.get(l.lawId) ?? '') : (l.newTitle ?? ''));

	const cited = bill.solutionIds.length
		? await db
				.select({ id: solutions.id, body: solutions.body, status: solutions.status, issueId: issues.id, issueTitle: issues.title, issueStatus: issues.status })
				.from(solutions)
				.innerJoin(issues, eq(issues.id, solutions.issueId))
				.where(inArray(solutions.id, bill.solutionIds))
		: [];
	const byId = new Map(cited.map((c) => [c.id, c]));
	const repealed = bill.laws.filter((l) => l.action === 'repeal').map(lawTitle);

	return {
		id: bill.id,
		kind: bill.kind,
		status: bill.status,
		title: bill.title,
		formalName: formalName(
			bill.kind,
			bill.laws.map((l) => ({ action: l.action, title: lawTitle(l) }))
		),
		summary: bill.summary ? bill.summary.split('\n') : [],
		affected: bill.affected,
		sideEffects: bill.sideEffects,
		author: author?.name ?? '',
		solutions: bill.solutionIds.map((id) => {
			const c = byId.get(id);
			// 解決策か課題が非表示なら本文も課題も出さない（非表示の課題の解決策は本人と運営にしか渡さない。docs/spec/28.md 決めたこと4）
			const shown = c && (SHOWN as readonly string[]).includes(c.status) && LISTED.includes(c.issueStatus);
			return shown ? { id, body: c.body as string | null, issue: { id: c.issueId, title: c.issueTitle } as { id: number; title: string } | null } : { id, body: null, issue: null };
		}),
		repealed,
		changeCount: changesOf(bill) + repealed.length + (bill.supplementary ? 1 : 0)
	};
}

/** 変更点のタブに出すもの：条ごとの「いま」と「変更後」。附則は最後に出す */
export async function billChangeViews(db: Db, bill: NonNullable<Bill>): Promise<ChangeView[]> {
	const changes: ChangeView[] = [];
	let budget = DIFF_PAGE_BUDGET;
	for (const l of bill.laws) {
		const base = l.baseRevisionId && l.changes.length ? new Map((await articlesOfRevision(db, l.baseRevisionId)).map((a) => [a.id, a])) : new Map();
		for (const c of l.changes) {
			const location = articleLabel(c.num);
			const old = c.provisionId === null ? undefined : base.get(c.provisionId);
			const before = old ? textOf(old.caption, old.paragraphs) : null;
			const after = c.paragraphs ? textOf(c.caption, c.paragraphs) : null;
			if (before !== null && after !== null) {
				const { parts, cost } = changeDiff(before, after, Math.min(DIFF_MAX_EDIT, budget));
				budget -= cost;
				changes.push({ location, op: c.op, before: parts, after: parts });
			} else {
				changes.push({
					location,
					op: c.op,
					before: before === null ? null : [{ value: before, removed: true }],
					after: after === null ? null : [{ value: after, added: true }]
				});
			}
		}
	}
	if (bill.supplementary) changes.push({ location: '', op: 'supplementary', before: null, after: [{ value: bill.supplementary, added: true }] });
	return changes;
}

/** 直す画面の引用の候補：引用した解決策の課題ごとに、表示中の解決策 */
export async function citedCandidates(db: Db, solutionIds: number[]) {
	if (!solutionIds.length) return [];
	const rows = await db
		.select({ issueId: solutions.issueId })
		.from(solutions)
		.innerJoin(issues, eq(issues.id, solutions.issueId))
		.where(and(inArray(solutions.id, solutionIds), inArray(issues.status, LISTED)));
	const issueIds = [...new Set(rows.map((r) => r.issueId))];
	const lists = await Promise.all(issueIds.map((id) => candidateSolutions(db, id)));
	return lists.flat();
}
