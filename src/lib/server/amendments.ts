// 修正案を読む・書く（Issue #68。設計書 docs/spec/68.md）。受け取る値は呼ぶ側（amendment-actions.ts）が確かめる
import { and, asc, count, countDistinct, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import { actions, amendments, amendmentSupports, amendmentVotes, billChanges, billLaws, bills, user } from '../db/schema';
import { adoptedAmendments, AMENDMENT_PAGE_SIZE, applyAmendments, articleKey, inPriorVote, priorVoteRequirement, type AmendmentStatus } from '../domain/amendments';
import { articleBodyText, articleLabel, compareNum, type DiffPart, type Paragraph } from '../domain/law';
import { changeDiff, DIFF_MAX_EDIT, DIFF_PAGE_BUDGET } from '../domain/bills';
import { checkAmendment, checkAmendmentSupport, DAY, LIMITS } from '../domain/limits';
import type { Session } from '../domain/session';
import { billOutcome, quorumRequirement, type VoteChoice, type VoteCounts } from '../domain/votes';
import { billById, draftInputOf, insertContent, lawTitlesOf, textOf, type Bill } from './bills';
import { refuse, type Actor } from './issues';
import { baseArticlesOf } from './if-world';
import type { BatchDb, Db } from './law';
import { assignedBills, countedVote, emptyCounts } from './votes';

type LoadedBill = NonNullable<Bill>;

/** D1 は1文に100個までしか値を結び付けられないので、番号の一覧を分ける */
const ID_CHUNK = 50;
const chunks = (ids: number[]) => Array.from({ length: Math.ceil(ids.length / ID_CHUNK) }, (_, i) => ids.slice(i * ID_CHUNK, (i + 1) * ID_CHUNK));

/** 選べる条（docs/spec/68.md 決めたこと2）。current はいまの本案の本文、base は基にした版の本文（足した条と制定の条は null） */
export async function amendableArticles(db: Db, bill: LoadedBill) {
	const titles = await lawTitlesOf(db, bill);
	const out: { key: string; lawSeq: number; lawTitle: string; num: string; label: string; caption: string | null; provisionId: number | null; current: Paragraph[]; base: Paragraph[] | null }[] = [];
	for (const law of bill.laws) {
		if (law.action === 'repeal') continue;
		const lawTitle = law.lawId ? (titles.get(law.lawId) ?? '') : (law.newTitle ?? '');
		const push = (num: string, caption: string | null, provisionId: number | null, current: Paragraph[], base: Paragraph[] | null) =>
			out.push({ key: articleKey(law.seq, num), lawSeq: law.seq, lawTitle, num, label: articleLabel(num), caption, provisionId, current, base });
		const changes = new Map(law.changes.map((c) => [c.num, c]));
		const base = law.baseRevisionId ? await baseArticlesOf(db, law) : [];
		for (const a of base) {
			const change = changes.get(a.num);
			// 法案が削除した条は選べない
			if (change?.op === 'delete') continue;
			push(a.num, change ? change.caption : a.caption, a.id, change?.paragraphs ?? a.paragraphs, a.paragraphs);
		}
		for (const c of law.changes) if (c.op === 'add' && c.paragraphs) push(c.num, c.caption, null, c.paragraphs, null);
	}
	return out.sort((a, b) => a.lawSeq - b.lawSeq || compareNum(a.num, b.num));
}

export type AmendmentRow = NonNullable<Awaited<ReturnType<typeof amendmentOf>>>;

const toRow = (r: typeof amendments.$inferSelect) => ({ ...r, status: r.status as AmendmentStatus, paragraphs: JSON.parse(r.body) as Paragraph[] });

/** その法案の修正案。なければ undefined */
export async function amendmentOf(db: Db, id: number, billId: number) {
	const [row] = await db
		.select()
		.from(amendments)
		.where(and(eq(amendments.id, id), eq(amendments.billId, billId)));
	return row && toRow(row);
}

export async function amendmentCount(db: Db, billId: number) {
	const [row] = await db.select({ n: count() }).from(amendments).where(eq(amendments.billId, billId));
	return row.n;
}

/** 修正案と更新は合わせて数える */
async function postRefusal(db: Db, actor: Actor, now: number) {
	const since = gt(actions.createdAt, now - DAY);
	const kind = eq(actions.kind, 'amendment_post');
	const [accountDay] = await db.select({ n: count() }).from(actions).where(and(kind, eq(actions.userId, actor.userId), since));
	const [ipDay] = await db.select({ n: count() }).from(actions).where(and(kind, eq(actions.ipHash, actor.ipHash), since));
	return checkAmendment({ accountDay: accountDay.n, ipDay: ipDay.n });
}

/** 修正案を出す。上限を確かめて書く */
export async function createAmendment(
	db: Db,
	actor: Actor,
	input: { billId: number; sessionKey: string; baseRev: number; lawSeq: number; num: string; provisionId: number | null; caption?: string | null; paragraphs: Paragraph[]; reason: string | null },
	now: number
) {
	const refusal = await postRefusal(db, actor, now);
	if (refusal) return refuse(db, actor, refusal, now);
	const { paragraphs, ...rest } = input;
	const [row] = await db
		.insert(amendments)
		.values({ ...rest, caption: input.caption ?? null, userId: actor.userId, body: JSON.stringify(paragraphs), createdAt: now, updatedAt: now })
		.returning({ id: amendments.id });
	await db.insert(actions).values({ kind: 'amendment_post', userId: actor.userId, ipHash: actor.ipHash, targetId: input.billId, createdAt: now });
	return { ok: true as const, id: row.id };
}

/** 版 rev の、その条の法案の本文（JSON）。変更がなければ null */
async function changeBodyAt(db: Db, billId: number, rev: number, lawSeq: number, num: string) {
	const [row] = await db
		.select({ body: billChanges.body })
		.from(billChanges)
		.where(and(eq(billChanges.billId, billId), eq(billChanges.rev, rev), eq(billChanges.lawSeq, lawSeq), eq(billChanges.num, num)));
	return row?.body ?? null;
}

/**
 * 更新する。本文を変えたか、書いたときの版といまの版でその条の本文が違えば、先議の賛同は数え直し（revision を上げる）。
 * どちらでもなければ賛同を保つ（別の条の取り込みで賛同を失わないように）
 */
export async function updateAmendment(db: Db, actor: Actor, bill: { id: number; rev: number }, amendment: AmendmentRow, paragraphs: Paragraph[], reason: string | null, now: number) {
	const closed = { ok: false as const, reason: 'closed' as const };
	if (amendment.baseRev === bill.rev) return closed;
	const refusal = await postRefusal(db, actor, now);
	if (refusal) return refuse(db, actor, refusal, now);
	const bodyChanged = articleBodyText(paragraphs) !== articleBodyText(amendment.paragraphs);
	const articleChanged = (await changeBodyAt(db, bill.id, amendment.baseRev, amendment.lawSeq, amendment.num)) !== (await changeBodyAt(db, bill.id, bill.rev, amendment.lawSeq, amendment.num));
	const done = await db
		.update(amendments)
		.set({
			baseRev: bill.rev,
			body: JSON.stringify(paragraphs),
			reason,
			updatedAt: now,
			revision: bodyChanged || articleChanged ? sql`${amendments.revision} + 1` : amendments.revision
		})
		.where(and(eq(amendments.id, amendment.id), eq(amendments.userId, actor.userId), eq(amendments.status, 'open'), ne(amendments.baseRev, bill.rev)))
		.returning({ id: amendments.id });
	if (done.length === 0) return closed;
	await db.insert(actions).values({ kind: 'amendment_post', userId: actor.userId, ipHash: actor.ipHash, targetId: bill.id, createdAt: now });
	return { ok: true as const };
}

/**
 * 修正案を当てた新しい版を作り、本案の版を進める。版を進める文と修正案に書く文を1つのトランザクションにするので、
 * 本文だけが入って提案者の記録が失われることはない。expected は当てる先の版で、いまの版と違えば何もしない。進めたら新しい版を返す。
 * status を渡すと、open の修正案だけをその状態にする（取り込み）。渡さなければ applied_rev だけを書く（状態は先に書いてある）
 */
async function advanceBill(db: BatchDb, billId: number, expected: number, targets: AmendmentRow[], status: AmendmentStatus | null, now: number) {
	const bill = await billById(db, billId);
	if (!bill || bill.rev !== expected) return null;
	const [taken] = await db
		.update(bills)
		.set({ nextRev: sql`${bills.nextRev} + 1` })
		.where(and(eq(bills.id, billId), eq(bills.rev, expected)))
		.returning({ next: bills.nextRev });
	if (!taken) return null;
	const rev = taken.next - 1;
	const input = draftInputOf(bill);
	await insertContent(db, billId, rev, { ...input, laws: applyAmendments(input.laws, targets) });
	await db.batch([
		db
			.update(bills)
			.set({ rev, updatedAt: now })
			.where(and(eq(bills.id, billId), eq(bills.rev, expected))),
		...chunks(targets.map((t) => t.id)).map((ids) =>
			db
				.update(amendments)
				.set({ ...(status ? { status } : {}), appliedRev: rev, updatedAt: now })
				.where(and(inArray(amendments.id, ids), status ? eq(amendments.status, 'open') : undefined, sql`(SELECT b.rev FROM ${bills} b WHERE b.id = ${billId}) = ${rev}`))
		)
	]);
	const [row] = await db.select({ rev: bills.rev }).from(bills).where(eq(bills.id, billId));
	return row.rev === rev ? rev : null;
}

/** 取り込む。読んだ本文（revision）と本案の版が合っているときだけ。取り込めたかを返す */
export async function acceptAmendment(db: BatchDb, actor: Actor, billId: number, amendmentId: number, revision: number, now: number) {
	const [amendment, bill] = await Promise.all([amendmentOf(db, amendmentId, billId), billById(db, billId)]);
	if (!amendment || !bill || amendment.status !== 'open' || amendment.revision !== revision || amendment.baseRev !== bill.rev) return false;
	const rev = await advanceBill(db, billId, amendment.baseRev, [amendment], 'accepted', now);
	if (rev === null) return false;
	await db.insert(actions).values({ kind: 'amendment_accept', userId: actor.userId, ipHash: actor.ipHash, targetId: billId, createdAt: now });
	return true;
}

/** 先議の賛同。いまと同じ状態への操作は何もせず、数えない。記録は行が変わったときだけ足す */
export async function setAmendmentSupport(db: Db, actor: Actor, amendment: AmendmentRow, billRev: number, revision: number, op: 'add' | 'remove', now: number) {
	// 取り消しは状態を問わず受け付ける（更新が必要なあいだも）
	if (op === 'add' && (amendment.status !== 'open' || amendment.baseRev !== billRev || amendment.revision !== revision)) return { ok: false as const, reason: 'stale' as const };
	const [own] = await db
		.select({ id: amendmentSupports.amendmentId })
		.from(amendmentSupports)
		.where(and(eq(amendmentSupports.amendmentId, amendment.id), eq(amendmentSupports.revision, amendment.revision), eq(amendmentSupports.userId, actor.userId)));
	if ((op === 'add') === Boolean(own)) return { ok: true as const, changed: false };

	const who = eq(actions.userId, actor.userId);
	const kinds = inArray(actions.kind, ['amendment_support_add', 'amendment_support_remove']);
	const [day] = await db.select({ n: count() }).from(actions).where(and(who, kinds, gt(actions.createdAt, now - DAY)));
	const [burst] = await db.select({ n: count() }).from(actions).where(and(who, kinds, gt(actions.createdAt, now - LIMITS.burstWindow)));
	const addedHere = and(eq(actions.kind, 'amendment_support_add'), eq(actions.targetId, amendment.id), gt(actions.createdAt, now - DAY));
	const [others] = await db
		.select({ n: countDistinct(actions.userId) })
		.from(actions)
		.where(and(addedHere, eq(actions.ipHash, actor.ipHash), ne(actions.userId, actor.userId)));
	const [self] = await db.select({ n: count() }).from(actions).where(and(addedHere, who));
	const refusal = checkAmendmentSupport({ op, accountDay: day.n, accountBurst: burst.n, otherAccountsOnIp: others.n, selfAddedRecently: self.n > 0 });
	if (refusal) return refuse(db, actor, refusal, now);

	// 1文で状態を確かめて書く。取り込みや更新と同時でも、古い本文に賛同しない
	const changed =
		op === 'add'
			? await db.all(sql`
				INSERT INTO ${amendmentSupports} (amendment_id, revision, user_id, created_at)
				SELECT a.id, a.revision, ${actor.userId}, ${now} FROM ${amendments} a JOIN ${bills} b ON b.id = a.bill_id
				WHERE a.id = ${amendment.id} AND a.status = 'open' AND a.revision = ${revision} AND a.base_rev = b.rev
				ON CONFLICT DO NOTHING RETURNING amendment_id`)
			: await db
					.delete(amendmentSupports)
					.where(and(eq(amendmentSupports.amendmentId, amendment.id), eq(amendmentSupports.userId, actor.userId), eq(amendmentSupports.revision, sql`(SELECT a.revision FROM ${amendments} a WHERE a.id = ${amendment.id})`)))
					.returning({ id: amendmentSupports.amendmentId });
	if (changed.length === 0) return { ok: true as const, changed: false };
	await db.insert(actions).values({ kind: op === 'add' ? 'amendment_support_add' : 'amendment_support_remove', userId: actor.userId, ipHash: actor.ipHash, targetId: amendment.id, createdAt: now });
	return { ok: true as const, changed: true };
}

/** その法案の修正案ごとの、いまの本文（revision）の賛同の数。番号を並べず結合で求める（修正案が多くても D1 の値の数の上限に当たらないように） */
async function supportCounts(db: Db, billId: number) {
	const counted = await db
		.select({ id: amendmentSupports.amendmentId, n: count() })
		.from(amendmentSupports)
		.innerJoin(amendments, and(eq(amendments.id, amendmentSupports.amendmentId), eq(amendments.revision, amendmentSupports.revision)))
		.where(eq(amendments.billId, billId))
		.groupBy(amendmentSupports.amendmentId);
	return new Map(counted.map((c) => [c.id, c.n]));
}

/**
 * 先議の票を入れる。入れられたかを返す。先に割り当てを固定するので、修正案だけに投票して割り当てを飛ばせない。
 * 採決の対象かは同じ文で確かめる。required は先議の要件
 */
export async function castAmendmentVote(db: Db, actor: Actor, session: Session, previous: Session, amendmentId: number, required: number, choice: VoteChoice, now: number, random: () => number) {
	if (now < session.voteAt || now >= session.endsAt) return false;
	await assignedBills(db, actor.userId, session, previous, now, random);
	const changed = await db.all(sql`
		INSERT INTO ${amendmentVotes} (session_key, amendment_id, user_id, choice, created_at, updated_at)
		SELECT a.session_key, a.id, ${actor.userId}, ${choice}, ${now}, ${now} FROM ${amendments} a JOIN ${bills} b ON b.id = a.bill_id
		WHERE a.id = ${amendmentId} AND a.session_key = ${session.key} AND a.status = 'open' AND a.base_rev = b.rev
			AND (SELECT count(*) FROM ${amendmentSupports} s WHERE s.amendment_id = a.id AND s.revision = a.revision) >= ${required}
		ON CONFLICT (session_key, amendment_id, user_id) DO UPDATE SET choice = excluded.choice, updated_at = excluded.updated_at
		WHERE amendment_votes.choice <> excluded.choice
		RETURNING amendment_id`);
	if (changed.length > 0) {
		// target_id は入れない（本案の票の記録の番号と意味が混ざらないように）
		await db.insert(actions).values({ kind: 'vote_cast', userId: actor.userId, ipHash: actor.ipHash, createdAt: now });
		return true;
	}
	// 同じ票を入れ直したときは行が返らない
	return (await myAmendmentVote(db, session.key, amendmentId, actor.userId)) === choice;
}

/** いま入っている、修正案への自分の票 */
export async function myAmendmentVote(db: Db, sessionKey: string, amendmentId: number, userId: string): Promise<VoteChoice | null> {
	const [row] = await db
		.select({ choice: amendmentVotes.choice })
		.from(amendmentVotes)
		.where(and(eq(amendmentVotes.sessionKey, sessionKey), eq(amendmentVotes.amendmentId, amendmentId), eq(amendmentVotes.userId, userId)));
	return row?.choice ?? null;
}

/** 本案より先に採決する修正案の数。条件は castAmendmentVote と同じ（inPriorVote をこの会期の行に当てはめたもの） */
export async function priorVoteCount(db: Db, sessionKey: string, bill: { id: number; rev: number }, required: number) {
	const [row] = await db
		.select({ n: count() })
		.from(amendments)
		.where(
			and(
				eq(amendments.billId, bill.id),
				eq(amendments.sessionKey, sessionKey),
				eq(amendments.status, 'open'),
				eq(amendments.baseRev, bill.rev),
				sql`(SELECT count(*) FROM ${amendmentSupports} s WHERE s.amendment_id = ${amendments}.id AND s.revision = ${amendments}.revision) >= ${required}`
			)
		);
	return row.n;
}

/** 修正案の票の数。本案と同じ条件（投票資格があり、割り当てのすべてに本案の票を入れた人の票が有効票）。割り当てを済ませる条件に修正案の票は入らない */
export async function tallyAmendmentVotes(db: Db, session: Session, amendmentId: number): Promise<{ counted: VoteCounts; reference: VoteCounts }> {
	const counted = countedVote(session, amendmentVotes);
	const rows = await db
		.select({ choice: amendmentVotes.choice, counted, n: count() })
		.from(amendmentVotes)
		.innerJoin(user, eq(user.id, amendmentVotes.userId))
		.where(and(eq(amendmentVotes.sessionKey, session.key), eq(amendmentVotes.amendmentId, amendmentId)))
		.groupBy(amendmentVotes.choice, sql`counted`);
	const result = { counted: emptyCounts(), reference: emptyCounts() };
	for (const row of rows) result[row.counted ? 'counted' : 'reference'][row.choice] += row.n;
	return result;
}

/**
 * 締切のあとの処理（呼ぶのは #71）。何度呼んでも結果が変わらない。対象の判定は bills.rev と比べるので、状態を全部書いてから版を進める。
 * 状態を書いたあとで失敗しても、やり直すと版を進めるところから続く。可決した修正案を本案に当て終えたかを返す（別の実行と重なったら false で、やり直す）
 */
export async function settleAmendments(db: BatchDb, session: Session, billId: number, participants: number, now: number): Promise<boolean> {
	const [bill] = await db.select({ rev: bills.rev }).from(bills).where(eq(bills.id, billId));
	if (!bill) return false;
	// 要調整を直して次の会期に採決するので、この会期の修正案だけを見る（前の会期の修正案に負けないように。docs/spec/72.md 決めたこと5）
	const rows = (await db.select().from(amendments).where(and(eq(amendments.billId, billId), eq(amendments.sessionKey, session.key))).orderBy(asc(amendments.id))).map(toRow);
	const open = rows.filter((r) => r.status === 'open');
	const supports = await supportCounts(db, billId);
	const required = priorVoteRequirement(participants);
	const quorum = quorumRequirement(participants);

	const writeStatus = async (ids: number[], status: AmendmentStatus) => {
		for (const part of chunks(ids)) await db.update(amendments).set({ status, updatedAt: now }).where(and(inArray(amendments.id, part), eq(amendments.status, 'open')));
	};
	const results: Parameters<typeof adoptedAmendments>[0] = [];
	const unvoted: number[] = [];
	for (const a of open) {
		if (!inPriorVote(a, supports.get(a.id) ?? 0, bill.rev, required)) {
			unvoted.push(a.id);
			continue;
		}
		const { counted } = await tallyAmendmentVotes(db, session, a.id);
		results.push({ id: a.id, lawSeq: a.lawSeq, num: a.num, outcome: billOutcome(counted, quorum) });
	}
	const decided = adoptedAmendments(
		results,
		rows.filter((r) => r.status === 'passed')
	);
	for (const status of ['passed', 'failed', 'superseded', 'lapsed'] as const) {
		await writeStatus(
			[...decided].filter(([, s]) => s === status).map(([id]) => id),
			status
		);
	}
	await writeStatus(unvoted, 'unvoted');

	// 条件に使う版は読み直したいまの版（修正案の base_rev ではない。やり直しのときに合わなくなるので）。
	// 版を先に読むので、別の実行が重なっても、その実行が進めたあとでは条件に合わず、同じ修正案を2回当てない
	const [latest] = await db.select({ rev: bills.rev }).from(bills).where(eq(bills.id, billId));
	const pending = (await db.select().from(amendments).where(and(eq(amendments.billId, billId), eq(amendments.sessionKey, session.key), eq(amendments.status, 'passed'))).orderBy(asc(amendments.id)))
		.map(toRow)
		.filter((r) => r.appliedRev === null);
	if (pending.length === 0) return true;
	return (await advanceBill(db, billId, latest.rev, pending, null, now)) !== null;
}

/** 共同起草者（取り込まれたか可決した修正案の提案者）の名前。重複なし、先に採用された順 */
export async function coDrafters(db: Db, billId: number) {
	const rows = await db
		.select({ name: user.name })
		.from(amendments)
		.innerJoin(user, eq(user.id, amendments.userId))
		.where(and(eq(amendments.billId, billId), inArray(amendments.status, ['accepted', 'passed'])))
		.orderBy(asc(amendments.id));
	return [...new Set(rows.map((r) => r.name))];
}

export type AmendmentView = {
	id: number;
	location: string;
	lawTitle: string | null;
	before: DiffPart[];
	after: DiffPart[];
	reason: string | null;
	status: AmendmentStatus;
	revision: number;
	mine: boolean;
	stale: boolean;
	/** 本案より先に採決する修正案か（要件に届いていて、本案の版が同じ） */
	prior: boolean;
	supports: number;
	supported: boolean;
	myVote: VoteChoice | null;
};

/** 版 rev の条の本文（書いたときの本案）。変更がなければ基にした版の本文 */
async function beforeText(db: Db, bill: LoadedBill, row: AmendmentRow, baseArticles: Map<string, Awaited<ReturnType<typeof baseArticlesOf>>>) {
	const body = await changeBodyAt(db, bill.id, row.baseRev, row.lawSeq, row.num);
	if (body !== null) return textOf(row.caption, JSON.parse(body) as Paragraph[]);
	// 書いたときの本案の基にした版を読む（要調整を直すと、いまの版の基にした版は変わる。docs/spec/72.md 決めたこと3）
	const [law] = await db
		.select({ lawId: billLaws.lawId, baseRevisionId: billLaws.baseRevisionId, baseIfSeq: billLaws.baseIfSeq })
		.from(billLaws)
		.where(and(eq(billLaws.billId, bill.id), eq(billLaws.rev, row.baseRev), eq(billLaws.seq, row.lawSeq)));
	if (!law?.baseRevisionId) return '';
	const key = `${law.baseRevisionId}@${law.baseIfSeq}`;
	const articles = baseArticles.get(key) ?? (await baseArticlesOf(db, law));
	baseArticles.set(key, articles);
	const article = articles.find((a) => a.num === row.num);
	return article ? textOf(row.caption, article.paragraphs) : '';
}

/**
 * 修正案のタブのカード。古い順（先に出したものが先に採られる）。名前と user_id を返さない。
 * 変更点は書いたときの本案と比べる（取り込まれたあとも変更点が消えないように）
 */
export async function listAmendments(db: Db, bill: LoadedBill, userId: string | null, sessionKey: string | null, required: number | null, page: number) {
	const rows = (
		await db
			.select()
			.from(amendments)
			.where(eq(amendments.billId, bill.id))
			.orderBy(asc(amendments.id))
			.limit(AMENDMENT_PAGE_SIZE + 1)
			.offset((page - 1) * AMENDMENT_PAGE_SIZE)
	).map(toRow);
	const shown = rows.slice(0, AMENDMENT_PAGE_SIZE);
	const ids = shown.map((r) => r.id);
	const supports = await supportCounts(db, bill.id);
	const mineSupports =
		userId && ids.length
			? await db
					.select({ id: amendmentSupports.amendmentId, revision: amendmentSupports.revision })
					.from(amendmentSupports)
					.where(and(eq(amendmentSupports.userId, userId), inArray(amendmentSupports.amendmentId, ids)))
			: [];
	const myVotes =
		userId && sessionKey && ids.length
			? await db
					.select({ id: amendmentVotes.amendmentId, choice: amendmentVotes.choice })
					.from(amendmentVotes)
					.where(and(eq(amendmentVotes.userId, userId), eq(amendmentVotes.sessionKey, sessionKey), inArray(amendmentVotes.amendmentId, ids)))
			: [];
	const titles = await lawTitlesOf(db, bill);
	const baseArticles = new Map<string, Awaited<ReturnType<typeof baseArticlesOf>>>();

	let budget = DIFF_PAGE_BUDGET;
	const views: AmendmentView[] = [];
	for (const row of shown) {
		const before = await beforeText(db, bill, row, baseArticles);
		const { parts, cost } = changeDiff(before, textOf(row.caption, row.paragraphs), Math.min(DIFF_MAX_EDIT, budget));
		budget -= cost;
		const law = bill.laws[row.lawSeq];
		views.push({
			id: row.id,
			location: articleLabel(row.num),
			lawTitle: bill.laws.length > 1 && law ? (law.lawId ? (titles.get(law.lawId) ?? '') : (law.newTitle ?? '')) : null,
			before: parts,
			after: parts,
			reason: row.reason,
			status: row.status,
			revision: row.revision,
			mine: row.userId === userId,
			stale: row.status === 'open' && row.baseRev !== bill.rev,
			prior: required !== null && inPriorVote(row, supports.get(row.id) ?? 0, bill.rev, required),
			supports: supports.get(row.id) ?? 0,
			supported: mineSupports.some((s) => s.id === row.id && s.revision === row.revision),
			myVote: myVotes.find((v) => v.id === row.id)?.choice ?? null
		});
	}
	return { rows: views, hasNext: rows.length > AMENDMENT_PAGE_SIZE };
}
