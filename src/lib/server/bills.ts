// 法案の下書きを作る・保存する・読む（設計書 docs/spec/45.md 決めたこと1・7・8）。
// 受け取る値は、呼ぶ側（#46）が validateBill・checkChanges・基にした版の比べを通したもの。ここでは確かめずに書く
import { and, asc, count, countDistinct, desc, eq, gt, gte, inArray, lt, ne, sql, type SQL, or } from 'drizzle-orm';
import { notify, notifyProposed } from './notifications';
import { actions, billChanges, billLaws, bills, lawRevisions, billSolutions, billSupports, committeeLaws, issues, laws, sessionParticipantCounts, solutions, user, billCosponsors, billRelations } from '../db/schema';
import { articleBodyText, articleLabel, compareNum, headingPaths, type DiffPart, type Paragraph } from '../domain/law';
import { articlePlace, baseToken, changeDiff, DIFF_MAX_EDIT, DIFF_PAGE_BUDGET, formalName, PARTICIPANT_KINDS, referralSession, type BillChange, type BillKind, type BillTab } from '../domain/bills';
import { PAGE_SIZE } from '../domain/issues';
import { checkBillDraft, checkBillSave, checkBillSupport, DAY, LIMITS } from '../domain/limits';
import { sessionAt, type Session } from '../domain/session';
import { LISTED, SOLUTION_SHOWN as SHOWN } from '../domain/reports';
import { refuse, type Actor } from './issues';
import { mergeBlock, proposeMerged } from './merge';
import { baseArticlesOf, ifArticles, ifHeadOf, repealedLawIds } from './if-world';
import type { Db, BatchDb } from './law';

/** 作りかけ（rev = 0）を除く条件。法案を引くところは必ずこれを使う */
export const savedBill = gt(bills.rev, 0);

export type DraftLaw = { action: BillKind; lawId: string | null; baseRevisionId: string | null; baseIfSeq: number; newTitle: string | null; changes: BillChange[] };
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
export async function insertContent(db: Db, billId: number, rev: number, input: DraftInput) {
	await db.insert(billLaws).values(
		input.laws.map((l, seq) => ({ billId, rev, seq, action: l.action, lawId: l.lawId, baseRevisionId: l.baseRevisionId, baseIfSeq: l.baseIfSeq, newTitle: l.newTitle }))
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

export const fields = (input: DraftInput) => ({
	title: input.title,
	affected: input.affected,
	sideEffects: input.sideEffects,
	summary: input.summary,
	supplementary: input.supplementary
});

/** 下書きを作り、法案の番号を返す。rev = 0 で足し、中身を版 1 で入れてから rev = 1 にする */
export async function createDraft(db: Db, userId: string, input: DraftInput, now: number): Promise<number> {
	const id = await createUnconfirmedDraft(db, userId, input, now);
	await db.update(bills).set({ rev: 1 }).where(and(eq(bills.id, id), eq(bills.rev, 0)));
	return id;
}

/** rev = 0 の行と版1の子の行を作る。rev を 1 にするまで、読むところからは見えない */
export async function createUnconfirmedDraft(db: Db, userId: string, input: DraftInput, now: number): Promise<number> {
	const [row] = await db
		.insert(bills)
		.values({ userId, committeeId: input.committeeId, kind: input.kind, rev: 0, nextRev: 2, ...fields(input), createdAt: now, updatedAt: now })
		.returning({ id: bills.id });
	await insertContent(db, row.id, 1, input);
	return row.id;
}

/**
 * 下書きを保存する。開いたときの rev（expectedRev）と同じで、提出者で、下書きのときだけ。保存したかを返す。
 * 版の番号は保存のたびに必ず違う値を取るので、同時に保存しても子の行は混ざらない。負けた保存の子の行は、どの rev からも指されず読まれない
 */
export async function saveDraft(db: Db, billId: number, userId: string, expectedRev: number, input: DraftInput, now: number): Promise<boolean> {
	if (!Number.isInteger(expectedRev) || expectedRev < 1) return false;
	// kind は作ったあとは変えないので、違う kind の中身は保存しない
	// 提出者か共同提出者（docs/spec/76.md。申し出ているだけでは編集できない）
	const editor = or(eq(bills.userId, userId), sql`EXISTS (SELECT 1 FROM bill_cosponsors c WHERE c.bill_id = ${billId} AND c.user_id = ${userId} AND c.status = 'accepted')`);
	const editable = and(eq(bills.id, billId), editor, eq(bills.status, 'draft'), eq(bills.kind, input.kind), savedBill);
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
	if (done.length !== 1) return false;
	// その版に賛同した人と、統合案に同意した人に、直されたことを知らせる（賛同も同意も集め直しになる）
	await notify(
		db,
		sql`SELECT user_id FROM bill_supports WHERE bill_id = ${billId} AND rev = ${expectedRev} AND user_id IS NOT ${userId} UNION SELECT user_id FROM bill_merge_consents WHERE merged_bill_id = ${billId} AND rev = ${expectedRev} AND user_id IS NOT ${userId}`,
		'bill_edited',
		billId,
		rev,
		now
	);
	return true;
}

export type Bill = Awaited<ReturnType<typeof billById>>;

/** 読んだ法案を、版を書くときの形にする（修正案を当てるときに使う） */
export const draftInputOf = (bill: NonNullable<Bill>): DraftInput => ({
	kind: bill.kind,
	committeeId: bill.committeeId,
	title: bill.title,
	affected: bill.affected,
	sideEffects: bill.sideEffects,
	summary: bill.summary,
	supplementary: bill.supplementary,
	laws: bill.laws.map((l) => ({ action: l.action, lawId: l.lawId, baseRevisionId: l.baseRevisionId, baseIfSeq: l.baseIfSeq, newTitle: l.newTitle, changes: l.changes })),
	solutionIds: bill.solutionIds
});

/** 賛同者を数える版：発議した版。下書きはいまの版（docs/spec/68.md 決めたこと8） */
export const supportRev = (bill: { rev: number; proposedRev: number | null }) => bill.proposedRev ?? bill.rev;

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
			baseIfSeq: l.baseIfSeq,
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
	const rows = await db
		.select({ id: laws.id, title: laws.title })
		.from(committeeLaws)
		.innerJoin(laws, eq(laws.id, committeeLaws.lawId))
		.where(eq(committeeLaws.committeeId, committeeId))
		.orderBy(asc(laws.id));
	// IF世界で廃止された法令は、以後の法案の対象にしない（docs/spec/72.md の E）
	const repealed = await repealedLawIds(db);
	return rows.filter((r) => !repealed.has(r.id));
}

/** 書く画面に出す法令の条：IF世界の最新の条と、基にする版の印。委員会の対象でなければ、IF世界で廃止されていれば undefined */
export async function draftArticles(db: Db, committeeId: number, lawId: string) {
	const [allowed] = await db
		.select({ id: committeeLaws.lawId })
		.from(committeeLaws)
		.where(and(eq(committeeLaws.committeeId, committeeId), eq(committeeLaws.lawId, lawId)));
	const head = allowed && (await ifHeadOf(db, lawId));
	if (!head || !head.branchRevisionId || head.repealed) return undefined;
	const articles = await ifArticles(db, lawId, head.branchRevisionId, head.seq);
	return {
		revisionId: baseToken(head.branchRevisionId, head.seq),
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

/** 引用の候補：その課題の表示中の解決策（古い順）。課題ごとに分けて出すので課題名を付ける */
export async function candidateSolutions(db: Db, issueId: number) {
	return db
		.select({ id: solutions.id, body: solutions.body, issueId: solutions.issueId, issueTitle: issues.title })
		.from(solutions)
		.innerJoin(issues, eq(issues.id, solutions.issueId))
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
	const refusal = await draftRefusal(db, actor, now);
	if (refusal) return refuse(db, actor, refusal, now);
	const id = await createDraft(db, actor.userId, input, now);
	await db.insert(actions).values({ kind: 'bill_draft', userId: actor.userId, ipHash: actor.ipHash, targetId: id, createdAt: now });
	return { ok: true as const, id };
}

/** 下書きを作る上限。超えていれば断る理由を返す */
export async function draftRefusal(db: Db, actor: Actor, now: number) {
	return checkBillDraft({
		accountDrafts: await countSince(db, 'bill_draft', eq(actions.userId, actor.userId), now),
		ipDrafts: await countSince(db, 'bill_draft', eq(actions.ipHash, actor.ipHash), now)
	});
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
export const textOf = (caption: string | null, paragraphs: Paragraph[]) => [caption ?? '', articleBodyText(paragraphs)].filter(Boolean).join('\n');

export type ChangeView = { location: string; op: 'amend' | 'add' | 'delete' | 'supplementary'; before: DiffPart[] | null; after: DiffPart[] | null };

const changesOf = (bill: NonNullable<Bill>) => bill.laws.reduce((n, l) => n + l.changes.length, 0);

/** 法案の対象の法令（現実の法令）の名前 */
export async function lawTitlesOf(db: Db, bill: { laws: { lawId: string | null }[] }) {
	const lawIds = bill.laws.map((l) => l.lawId).filter((id): id is string => id !== null);
	return new Map((lawIds.length ? await db.select({ id: laws.id, title: laws.title }).from(laws).where(inArray(laws.id, lawIds)) : []).map((r) => [r.id, r.title]));
}

/** 法案のページの上の部分と概要のタブに出すもの。文字の比べは変更点のタブだけで行う（billChangeViews） */
export async function billView(db: Db, bill: NonNullable<Bill>) {
	const [author] = await db.select({ name: user.name }).from(user).where(eq(user.id, bill.userId));
	const titles = await lawTitlesOf(db, bill);
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
	// 法令が2本以上なら法令名を付ける（docs/spec/53.md 決めたこと11）
	const titles = bill.laws.length > 1 ? await lawTitlesOf(db, bill) : null;
	for (const l of bill.laws) {
		const lawTitle = titles && (l.lawId ? (titles.get(l.lawId) ?? '') : (l.newTitle ?? ''));
		const base = l.baseRevisionId && l.changes.length ? new Map((await baseArticlesOf(db, l)).map((a) => [a.id, a])) : new Map();
		for (const c of l.changes) {
			const location = articlePlace(lawTitle, articleLabel(c.num));
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

// ---- 条文全体のなかで見る（Issue #54） ----

export type FullArticle = {
	num: string;
	label: string;
	caption: string;
	/** 変わらない条は null */
	op: 'amend' | 'add' | 'delete' | null;
	/** 変わらない条の項と号 */
	paragraphs: Paragraph[] | null;
	/** 変わる条の違い（見出しを含む） */
	parts: DiffPart[] | null;
	/** 書きかえで見出しが変わったときの、元の見出し */
	captionBefore: string | null;
	/** 章の帯（変わったときだけ） */
	band: string[] | null;
};

/**
 * 法令の全文に変更点を重ねる。全文は法案が基にした条文（変更点のタブの「いま」と同じ）。足す条は番号の位置に入れる。
 * 制定の新法はすべての条を足す形で、廃止の法令は全文を返さない
 */
export async function billFullText(db: Db, bill: NonNullable<Bill>, seq: number) {
	const titles = await lawTitlesOf(db, bill);
	const titleOf = (l: (typeof bill.laws)[number]) => (l.lawId ? (titles.get(l.lawId) ?? '') : (l.newTitle ?? ''));
	const laws = bill.laws.map((l) => ({ seq: l.seq, title: titleOf(l), action: l.action }));
	const law = bill.laws[seq];
	const shown = { seq, title: titleOf(law), action: law.action, lawId: law.lawId };
	if (law.action === 'repeal') return { laws, law: shown, articles: [] as FullArticle[] };
	const added = (c: BillChange): FullArticle => ({
		num: c.num,
		label: articleLabel(c.num),
		caption: c.caption ?? '',
		op: 'add',
		paragraphs: null,
		parts: [{ value: articleBodyText(c.paragraphs ?? []), added: true }],
		captionBefore: null,
		band: null
	});
	if (law.action === 'enact') return { laws, law: shown, articles: law.changes.map(added) };

	const base = await baseArticlesOf(db, law);
	const byId = new Map(law.changes.filter((c) => c.provisionId !== null).map((c) => [c.provisionId as number, c]));
	let budget = DIFF_PAGE_BUDGET;
	const articles: FullArticle[] = base.map((a) => {
		const c = byId.get(a.id);
		const same = { num: a.num, label: a.label, captionBefore: null, band: null };
		if (!c) return { ...same, caption: a.caption, op: null, paragraphs: a.paragraphs, parts: null };
		const before = articleBodyText(a.paragraphs);
		if (c.op === 'delete') return { ...same, caption: a.caption, op: 'delete', paragraphs: null, parts: [{ value: before, removed: true }] };
		const { parts, cost } = changeDiff(before, articleBodyText(c.paragraphs ?? []), Math.min(DIFF_MAX_EDIT, budget));
		budget -= cost;
		const caption = c.caption ?? '';
		return { ...same, caption, captionBefore: caption === a.caption ? null : a.caption, op: 'amend', paragraphs: null, parts };
	});
	articles.push(...law.changes.filter((c) => c.op === 'add').map(added));
	articles.sort((a, b) => compareNum(a.num, b.num));
	// 章の帯は基にした現実の版の見出しから。足した条は前の条と同じ章にする
	const [revision] = law.baseRevisionId ? await db.select({ headings: lawRevisions.headings }).from(lawRevisions).where(eq(lawRevisions.id, law.baseRevisionId)) : [];
	const paths = headingPaths(revision?.headings ?? []);
	let previous = '';
	for (const a of articles) {
		const path = paths.get(a.num);
		if (!path) continue;
		const key = path.join('\n');
		if (key !== previous) a.band = path;
		previous = key;
	}
	return { laws, law: shown, articles };
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

// ---- 法案の一覧（Issue #48） ----

/** 賛同の数：発議した版の行を数える。下書きはいまの版（設計書 docs/spec/49.md 決めたこと1、docs/spec/68.md 決めたこと8） */
// 列の値（${bills.rev}）を埋めると、drizzle が表名なしの "rev" にして副問い合わせの中の rev を指すので、表の名前を書く
const supportCount = sql<number>`(SELECT count(*) FROM ${billSupports} s WHERE s.bill_id = ${bills}.id AND s.rev = COALESCE(${bills}.proposed_rev, ${bills}.rev))`;

/**
 * タブの法案。下書きは保存が新しい順、審議中は作ったのが新しい順、終わったは発議が新しい順。
 * before は lapsedBefore の値で、これより前に発議した法案と、撤回された法案が終わった（docs/spec/50.md 決めたこと4・5、docs/spec/76.md）
 */
export async function listBills(db: Db, tab: BillTab, page: number, before: number) {
	const draft = tab === 'shitagaki';
	const inTab = draft
		? eq(bills.status, 'draft')
		: tab === 'owari'
			? or(eq(bills.status, 'withdrawn'), and(eq(bills.status, 'proposed'), lt(bills.proposedAt, before)))
			: and(eq(bills.status, 'proposed'), gte(bills.proposedAt, before));
	const newest = draft ? bills.updatedAt : tab === 'owari' ? sql`COALESCE(${bills.withdrawnAt}, ${bills.proposedAt})` : bills.createdAt;
	const rows = await db
		.select({ id: bills.id, kind: bills.kind, status: bills.status, proposedAt: bills.proposedAt, title: bills.title, supports: supportCount })
		.from(bills)
		.where(and(savedBill, inTab))
		.orderBy(desc(newest), desc(bills.id))
		.limit(PAGE_SIZE + 1)
		.offset((page - 1) * PAGE_SIZE);
	return { rows: rows.slice(0, PAGE_SIZE), hasNext: rows.length > PAGE_SIZE };
}

/** タブの件数。「終わった」には数を出さない（SpBills・PcBills） */
export async function billTabCounts(db: Db, before: number) {
	const [row] = await db
		.select({
			shingi: sql<number>`count(CASE WHEN ${bills.status} = 'proposed' AND ${bills.proposedAt} >= ${before} THEN 1 END)`,
			shitagaki: sql<number>`count(CASE WHEN ${bills.status} = 'draft' THEN 1 END)`
		})
		.from(bills)
		.where(savedBill);
	return row;
}

// ---- 賛同と発議（Issue #49。設計書 docs/spec/49.md） ----

/** 今月の参加者。その会期の行がなければ、一つ前の会期の行動から数えて固定する。同時に読まれても先に入った行でそろう */
export async function sessionParticipants(db: Db, committeeId: number, session: Session, previous: Session, now: number): Promise<number> {
	const fixed = and(eq(sessionParticipantCounts.committeeId, committeeId), eq(sessionParticipantCounts.sessionKey, session.key));
	const read = async () => (await db.select({ n: sessionParticipantCounts.activeCount }).from(sessionParticipantCounts).where(fixed))[0]?.n;
	const known = await read();
	if (known !== undefined) return known;
	const [row] = await db
		.select({ n: countDistinct(actions.userId) })
		.from(actions)
		.where(and(inArray(actions.kind, PARTICIPANT_KINDS), gte(actions.createdAt, previous.startsAt), lt(actions.createdAt, previous.endsAt)));
	await db.insert(sessionParticipantCounts).values({ committeeId, sessionKey: session.key, activeCount: row.n, fixedAt: now }).onConflictDoNothing();
	return (await read()) as number;
}

/** 法案の賛同の数と、見ている人が賛同しているか */
export async function billSupportState(db: Db, billId: number, rev: number, userId: string | null) {
	const here = and(eq(billSupports.billId, billId), eq(billSupports.rev, rev));
	const [row] = await db.select({ n: count() }).from(billSupports).where(here);
	if (userId === null || row.n === 0) return { supports: row.n, mine: false };
	const [own] = await db
		.select({ n: count() })
		.from(billSupports)
		.where(and(here, eq(billSupports.userId, userId)));
	return { supports: row.n, mine: own.n > 0 };
}

export type SupportClosed = 'author' | 'closed' | 'stale' | 'cosponsor' | 'formerCosponsor';

/** 賛同の行を入れる文。共同提出者と抜けた人を入れない（確かめのあとに承認が走っても、どちらの順でも賛同の行が残らない） */
export const addSupportRow = (db: Db, billId: number, expectedRev: number, userId: string, now: number) =>
	db.all<{ id: number }>(sql`
		INSERT INTO ${billSupports} (bill_id, rev, user_id, created_at)
		SELECT id, rev, ${userId}, ${now} FROM ${bills}
		WHERE id = ${billId} AND status = 'draft' AND rev = ${expectedRev} AND rev > 0 AND user_id <> ${userId}
		AND NOT EXISTS (SELECT 1 FROM bill_cosponsors c WHERE c.bill_id = ${billId} AND c.user_id = ${userId} AND c.status IN ('accepted', 'left'))
		ON CONFLICT DO NOTHING RETURNING bill_id AS id`);

/** 賛同する・取り消す。いまと同じ状態への操作は何もせず、数えない。記録は行が変わったときだけ足す */
export async function setBillSupport(db: Db, actor: Actor, billId: number, expectedRev: number, op: 'add' | 'remove', now: number) {
	const closed = (reason: SupportClosed) => ({ ok: false as const, reason });
	const shape = async () => {
		const [b] = await db
			.select({ userId: bills.userId, status: bills.status, rev: bills.rev })
			.from(bills)
			.where(and(eq(bills.id, billId), savedBill));
		if (!b || b.status !== 'draft') return { closed: closed('closed') };
		if (b.userId === actor.userId) return { closed: closed('author') };
		const [row] = await db.select({ status: billCosponsors.status }).from(billCosponsors).where(and(eq(billCosponsors.billId, billId), eq(billCosponsors.userId, actor.userId)));
		if (row?.status === 'accepted') return { closed: closed('cosponsor') };
		if (row?.status === 'left') return { closed: closed('formerCosponsor') };
		if (b.rev !== expectedRev) return { closed: closed('stale') };
		return { rev: b.rev };
	};
	const checked = await shape();
	if (checked.closed) return checked.closed;
	const { mine } = await billSupportState(db, billId, checked.rev, actor.userId);
	if ((op === 'add') === mine) return { ok: true as const, changed: false };

	const who = eq(actions.userId, actor.userId);
	const kinds = inArray(actions.kind, ['bill_support_add', 'bill_support_remove']);
	const [day] = await db.select({ n: count() }).from(actions).where(and(who, kinds, gt(actions.createdAt, now - DAY)));
	const [burst] = await db.select({ n: count() }).from(actions).where(and(who, kinds, gt(actions.createdAt, now - LIMITS.burstWindow)));
	const addedHere = and(eq(actions.kind, 'bill_support_add'), eq(actions.targetId, billId), gt(actions.createdAt, now - DAY));
	const [others] = await db
		.select({ n: countDistinct(actions.userId) })
		.from(actions)
		.where(and(addedHere, eq(actions.ipHash, actor.ipHash), ne(actions.userId, actor.userId)));
	const [self] = await db.select({ n: count() }).from(actions).where(and(addedHere, who));
	const refusal = checkBillSupport({ op, accountDay: day.n, accountBurst: burst.n, otherAccountsOnIp: others.n, selfAddedRecently: self.n > 0 });
	if (refusal) return refuse(db, actor, refusal, now);

	// どちらも1文で確かめて書く。発議や保存と同時でも、発議したあとの法案や古い版の賛同は変わらない
	const changed =
		op === 'add'
			? await addSupportRow(db, billId, expectedRev, actor.userId, now)
			: await db.all<{ id: number }>(sql`
				DELETE FROM ${billSupports} WHERE bill_id = ${billId} AND user_id = ${actor.userId}
				AND rev = (SELECT rev FROM ${bills} WHERE id = ${billId} AND status = 'draft' AND rev = ${expectedRev}) RETURNING bill_id AS id`);
	if (changed.length === 0) {
		// 確かめてから書くまでに、発議か保存か、同じ人の別の画面からの操作があった
		const again = await shape();
		return again.closed ?? { ok: true as const, changed: false };
	}
	await db.insert(actions).values({ kind: op === 'add' ? 'bill_support_add' : 'bill_support_remove', userId: actor.userId, ipHash: actor.ipHash, targetId: billId, createdAt: now });
	return { ok: true as const, changed: true };
}

export type ProposeRefused = 'notAuthor' | 'closed' | 'short' | 'stale' | 'merge' | 'mergeClosed';

/**
 * 発議する。賛同の数の確かめも同じ文の中で行う。required は押したときの会期の発議要件。
 * rev は読んだ版で、編集する人が複数なので、提出者が読んでいない版を発議しない。統合案は元の法案を一緒に撤回する（docs/spec/76.md 決めたこと13）
 */
export async function proposeBill(db: Db, actor: Actor, billId: number, rev: number, required: number, now: number, minutes: number | null = null): Promise<{ ok: true } | { ok: false; reason: ProposeRefused }> {
	const [b] = await db
		.select({ userId: bills.userId, status: bills.status, rev: bills.rev })
		.from(bills)
		.where(and(eq(bills.id, billId), savedBill));
	if (!b || b.status !== 'draft') return { ok: false, reason: 'closed' };
	if (b.userId !== actor.userId) return { ok: false, reason: 'notAuthor' };
	if (b.rev !== rev) return { ok: false, reason: 'stale' };
	const [relation] = await db.select({ id: billRelations.originBillId }).from(billRelations).where(eq(billRelations.mergedBillId, billId)).limit(1);
	if (relation) {
		const block = await mergeBlock(db, { id: billId, userId: b.userId, rev }, now, minutes);
		if (block) return { ok: false, reason: block };
		const proposed = await proposeMerged(db as BatchDb, actor, { id: billId, rev }, rev, required, now, minutes);
		if (!proposed) {
			const [again] = await db.select({ status: bills.status, rev: bills.rev }).from(bills).where(eq(bills.id, billId));
			if (again?.status !== 'draft') return { ok: false, reason: 'closed' };
			if (again.rev !== rev) return { ok: false, reason: 'stale' };
			return { ok: false, reason: (await mergeBlock(db, { id: billId, userId: b.userId, rev }, now, minutes)) ?? 'short' };
		}
		await db.insert(actions).values({ kind: 'bill_propose', userId: actor.userId, ipHash: actor.ipHash, targetId: billId, createdAt: now });
		await notifyProposed(db, billId, rev, actor.userId, now);
		return { ok: true };
	}
	const done = await db.all<{ id: number }>(sql`
		UPDATE ${bills} SET status = 'proposed', proposed_at = ${now}, proposed_rev = rev, updated_at = ${now}
		WHERE id = ${billId} AND user_id = ${actor.userId} AND status = 'draft' AND rev = ${rev} AND rev > 0
		AND (SELECT count(*) FROM ${billSupports} s WHERE s.bill_id = ${billId} AND s.rev = ${bills}.rev AND s.user_id <> ${bills}.user_id) >= ${required}
		RETURNING id`);
	if (done.length === 0) {
		const [again] = await db.select({ status: bills.status, rev: bills.rev }).from(bills).where(eq(bills.id, billId));
		if (again?.status !== 'draft') return { ok: false, reason: 'closed' };
		return { ok: false, reason: again.rev === rev ? 'short' : 'stale' };
	}
	await db.insert(actions).values({ kind: 'bill_propose', userId: actor.userId, ipHash: actor.ipHash, targetId: billId, createdAt: now });
	await notifyProposed(db, billId, rev, actor.userId, now);
	return { ok: true };
}

/**
 * 関連法案（Issue #69）：付託先の会期が同じで、発議した版で同じ法令の同じ条に触れる法案。廃止はその法令のすべての条に触れるものとする。
 * 保存せずに毎回求める（発議した版と発議の時刻は、要調整を直したときに変わる）。直接触れる法案だけで、つながりをたどらない
 */
export async function relatedBills(db: Db, bill: { id: number; rev: number; proposedRev: number | null; proposedAt: number | null }, minutes: number | null) {
	if (bill.proposedAt === null) return [];
	const session = referralSession(bill.proposedAt, minutes);
	const previous = sessionAt(session.startsAt - 1, minutes);
	const rev = supportRev(bill);
	// 副問い合わせの中の列と混ざらないよう、外側の列は表の名前を付けて書く
	const touches = sql`EXISTS (
		SELECT 1 FROM ${billLaws} ol JOIN ${billLaws} ml ON ml.law_id = ol.law_id
		WHERE ol.bill_id = ${bills}.id AND ol.rev = COALESCE(${bills}.proposed_rev, ${bills}.rev) AND ml.bill_id = ${bill.id} AND ml.rev = ${rev}
		AND (ol.action = 'repeal' OR ml.action = 'repeal' OR EXISTS (
			SELECT 1 FROM ${billChanges} oc JOIN ${billChanges} mc ON mc.num = oc.num
			WHERE oc.bill_id = ol.bill_id AND oc.rev = ol.rev AND oc.law_seq = ol.seq AND mc.bill_id = ml.bill_id AND mc.rev = ml.rev AND mc.law_seq = ml.seq
		))
	)`;
	return db
		.select({ id: bills.id, title: bills.title })
		.from(bills)
		.where(and(ne(bills.id, bill.id), eq(bills.status, 'proposed'), gte(bills.proposedAt, previous.deliberationAt), lt(bills.proposedAt, session.deliberationAt), touches))
		.orderBy(asc(bills.id));
}
