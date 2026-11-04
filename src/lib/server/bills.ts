// 法案の下書きを作る・保存する・読む（設計書 docs/spec/45.md 決めたこと1・7・8）。
// 受け取る値は、呼ぶ側（#46）が validateBill・checkChanges・基にした版の比べを通したもの。ここでは確かめずに書く
import { and, asc, count, countDistinct, desc, eq, gt, gte, inArray, lt, ne, sql, type SQL } from 'drizzle-orm';
import { actions, billChanges, billLaws, bills, billSolutions, billSupports, committeeLaws, issues, laws, sessionParticipantCounts, solutions, user } from '../db/schema';
import { articleBodyText, articleLabel, compareNum, type DiffPart, type Paragraph } from '../domain/law';
import { changeDiff, DIFF_MAX_EDIT, DIFF_PAGE_BUDGET, formalName, PARTICIPANT_KINDS, type BillChange, type BillKind, type BillTab } from '../domain/bills';
import { PAGE_SIZE } from '../domain/issues';
import { checkBillDraft, checkBillSave, checkBillSupport, DAY, LIMITS } from '../domain/limits';
import type { Session } from '../domain/session';
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

// ---- 法案の一覧（Issue #48） ----

/** 賛同の数：いまの版（bills.rev）の行だけを数える（設計書 docs/spec/49.md 決めたこと1） */
// 列の値（${bills.rev}）を埋めると、drizzle が表名なしの "rev" にして副問い合わせの中の rev を指すので、表の名前を書く
const supportCount = sql<number>`(SELECT count(*) FROM ${billSupports} s WHERE s.bill_id = ${bills}.id AND s.rev = ${bills}.rev)`;

/**
 * タブの法案。下書きは保存が新しい順、審議中は作ったのが新しい順、終わったは発議が新しい順。
 * before は lapsedBefore の値で、これより前に発議した法案が終わった（docs/spec/50.md 決めたこと4・5）
 */
export async function listBills(db: Db, tab: BillTab, page: number, before: number) {
	const draft = tab === 'shitagaki';
	const inTab = draft
		? eq(bills.status, 'draft')
		: and(eq(bills.status, 'proposed'), tab === 'owari' ? lt(bills.proposedAt, before) : gte(bills.proposedAt, before));
	const newest = draft ? bills.updatedAt : tab === 'owari' ? bills.proposedAt : bills.createdAt;
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

export type SupportClosed = 'author' | 'closed' | 'stale';

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
			? await db.all<{ id: number }>(sql`
				INSERT INTO ${billSupports} (bill_id, rev, user_id, created_at)
				SELECT id, rev, ${actor.userId}, ${now} FROM ${bills}
				WHERE id = ${billId} AND status = 'draft' AND rev = ${expectedRev} AND rev > 0 AND user_id <> ${actor.userId}
				ON CONFLICT DO NOTHING RETURNING bill_id AS id`)
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

export type ProposeRefused = 'notAuthor' | 'closed' | 'short';

/** 発議する。賛同の数の確かめも同じ文の中で行う。required は押したときの会期の発議要件 */
export async function proposeBill(db: Db, actor: Actor, billId: number, required: number, now: number): Promise<{ ok: true } | { ok: false; reason: ProposeRefused }> {
	const [b] = await db
		.select({ userId: bills.userId, status: bills.status })
		.from(bills)
		.where(and(eq(bills.id, billId), savedBill));
	if (!b || b.status !== 'draft') return { ok: false, reason: 'closed' };
	if (b.userId !== actor.userId) return { ok: false, reason: 'notAuthor' };
	const done = await db.all<{ id: number }>(sql`
		UPDATE ${bills} SET status = 'proposed', proposed_at = ${now}, updated_at = ${now}
		WHERE id = ${billId} AND user_id = ${actor.userId} AND status = 'draft' AND rev > 0
		AND (SELECT count(*) FROM ${billSupports} s WHERE s.bill_id = ${billId} AND s.rev = ${bills}.rev AND s.user_id <> ${bills}.user_id) >= ${required}
		RETURNING id`);
	if (done.length === 0) {
		const [again] = await db.select({ status: bills.status }).from(bills).where(eq(bills.id, billId));
		return { ok: false, reason: again?.status === 'draft' ? 'short' : 'closed' };
	}
	await db.insert(actions).values({ kind: 'bill_propose', userId: actor.userId, ipHash: actor.ipHash, targetId: billId, createdAt: now });
	return { ok: true };
}
