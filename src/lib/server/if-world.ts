// IF世界の版を読む・作る（Issue #72。設計書 docs/spec/72.md）。IF世界の版は可決した法案の版の変更点を指し、読むときに分岐した版へ重ねる。
// Cron の入口からも読むので、cloudflare:workers、import.meta.env、#lib に頼らない
import { and, asc, count, desc, eq, gt, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { actions, billAdjustments, billChanges, billLaws, billResults, bills, billSupports, ifAddedArticles, ifBranches, ifImportArticles, ifImportRuns, ifImports, ifLaws, ifRevisions, laws, lawRevisions, provisions, voteReviews } from '../db/schema';
import { referralSession, type BillChange, type BillKind } from '../domain/bills';
import { PAGE_SIZE } from '../domain/issues';
import { articleBodyText, articleLabel, changedArticles, compareNum, articleConflict, headingPaths, tableOfContents, type IfArticle, type Paragraph } from '../domain/law';
import { checkBillSave, DAY, type Refusal } from '../domain/limits';
import { sessionAt, type Session } from '../domain/session';
import type { AdjustmentReason } from '../domain/votes';
import { fields, insertContent, savedBill, type DraftInput } from './bills';
import { refuse, type Actor } from './issues';
import { articlesOfRevision, currentRevision, type BatchDb, type Db } from './law';
import { billMembers, notify, notifyProposed } from './notifications';

const JST = 9 * 60 * 60 * 1000;
const DELETED: Paragraph[] = [{ num: '1', text: '削除', items: [] }];
const SUPPORT_ROWS_PER_STATEMENT = 20;
// D1 の1文の値の上限は100個。if_import_articles は14列
const IMPORT_ROWS_PER_STATEMENT = 7;

/** その法令の次の IF世界の版の番号。反映と取り込みで1つの列にする（docs/spec/95.md）。1つの文の中で使う */
export const nextIfSeq = (lawId: string) => sql`(SELECT COALESCE(MAX(s), 0) + 1 FROM (SELECT seq AS s FROM if_revisions WHERE law_id = ${lawId} UNION ALL SELECT seq AS s FROM if_imports WHERE law_id = ${lawId}))`;

/** 分岐した版。なければいま施行されている版で固定する（sessionParticipants と同じ形）。法令がなければ undefined */
export async function ifBranchOf(db: Db, lawId: string): Promise<string | undefined> {
	const read = async () => (await db.select({ id: ifBranches.revisionId }).from(ifBranches).where(eq(ifBranches.lawId, lawId)))[0]?.id;
	const known = await read();
	if (known) return known;
	const current = await currentRevision(db, lawId);
	if (!current) return undefined;
	await db.insert(ifBranches).values({ lawId, revisionId: current.id, createdAt: Date.now() }).onConflictDoNothing();
	return read();
}

/** IF世界の版に重ねる行（古い順）。seq を省くと最新まで */
async function overlayRows(db: Db, lawId: string, seq?: number) {
	return db
		.select({
			seq: ifRevisions.seq,
			billId: ifRevisions.billId,
			title: bills.title,
			action: billLaws.action,
			num: billChanges.num,
			op: billChanges.op,
			provisionId: billChanges.provisionId,
			addedId: ifAddedArticles.provisionId,
			caption: billChanges.caption,
			body: billChanges.body
		})
		.from(ifRevisions)
		.innerJoin(billLaws, and(eq(billLaws.billId, ifRevisions.billId), eq(billLaws.rev, ifRevisions.billRev), eq(billLaws.seq, ifRevisions.lawSeq)))
		.innerJoin(bills, eq(bills.id, ifRevisions.billId))
		.leftJoin(billChanges, and(eq(billChanges.billId, ifRevisions.billId), eq(billChanges.rev, ifRevisions.billRev), eq(billChanges.lawSeq, ifRevisions.lawSeq)))
		.leftJoin(ifAddedArticles, and(eq(ifAddedArticles.lawId, ifRevisions.lawId), eq(ifAddedArticles.num, billChanges.num), eq(billChanges.op, 'add')))
		.where(and(eq(ifRevisions.lawId, lawId), seq === undefined ? undefined : lte(ifRevisions.seq, seq)))
		.orderBy(asc(ifRevisions.seq));
}

/** IF世界のいま：分岐した版、いま基にしている現実の版、最新の版の番号、廃止されたか */
export async function ifHeadOf(db: Db, lawId: string) {
	const branchRevisionId = await ifBranchOf(db, lawId);
	const revs = await db
		.select({ seq: ifRevisions.seq, action: billLaws.action, billId: ifRevisions.billId })
		.from(ifRevisions)
		.innerJoin(billLaws, and(eq(billLaws.billId, ifRevisions.billId), eq(billLaws.rev, ifRevisions.billRev), eq(billLaws.seq, ifRevisions.lawSeq)))
		.where(eq(ifRevisions.lawId, lawId));
	const repeal = revs.find((r) => r.action === 'repeal');
	const [imported] = await db.select({ seq: ifImports.seq, revisionId: ifImports.revisionId }).from(ifImports).where(eq(ifImports.lawId, lawId)).orderBy(desc(ifImports.seq)).limit(1);
	return {
		branchRevisionId,
		baseRevisionId: imported?.revisionId ?? branchRevisionId,
		seq: revs.reduce((max, r) => Math.max(max, r.seq), imported?.seq ?? 0),
		repealed: repeal !== undefined,
		repealedBy: repeal?.billId ?? null
	};
}

/** 同期の固定の版：IF世界が最後に指した現実の版（docs/spec/95.md 決めたこと6）。これより後は同期で作り直してよい */
export async function pinnedRevision(db: Db, lawId: string) {
	return (await ifHeadOf(db, lawId)).baseRevisionId;
}

/** IF世界で廃止された法令 */
export async function repealedLawIds(db: Db) {
	const rows = await db
		.select({ id: ifRevisions.lawId })
		.from(ifRevisions)
		.innerJoin(billLaws, and(eq(billLaws.billId, ifRevisions.billId), eq(billLaws.rev, ifRevisions.billRev), eq(billLaws.seq, ifRevisions.lawSeq)))
		.where(eq(billLaws.action, 'repeal'));
	return new Set(rows.map((r) => r.id));
}

const articleId = (r: { provisionId: number | null; addedId: number | null }) => r.provisionId ?? r.addedId;

/**
 * IF世界の条。seq 以下の最後の取り込みの版（なければ分岐した版）の条に、seq までの版を順に重ねる。形は articlesOfRevision と同じで、最後に変えた法案（changedBy）を足す。
 * 法案が変えた条は基の版になくても法案の番号で残す。同じ番号の条が2つになったら IF世界で変えた条を残す（docs/spec/95.md 決めたこと2）
 */
export async function ifArticles(db: Db, lawId: string, branchRevisionId: string, seq: number) {
	const [imported] = seq > 0 ? await db.select({ revisionId: ifImports.revisionId }).from(ifImports).where(and(eq(ifImports.lawId, lawId), lte(ifImports.seq, seq))).orderBy(desc(ifImports.seq)).limit(1) : [];
	const base = await articlesOfRevision(db, imported?.revisionId ?? branchRevisionId);
	const byId = new Map<number, (typeof base)[number] & { changedBy: { id: number; title: string } | null }>(base.map((a) => [a.id, { ...a, changedBy: null }]));
	if (seq > 0) {
		for (const r of await overlayRows(db, lawId, seq)) {
			const id = articleId(r);
			if (r.num === null || r.op === null || id === null) continue;
			const changedBy = { id: r.billId, title: r.title };
			if (r.op === 'delete') {
				byId.set(id, { id, num: r.num, label: articleLabel(r.num), caption: '', paragraphs: DELETED, changedBy });
				continue;
			}
			byId.set(id, { id, num: r.num, label: articleLabel(r.num), caption: r.caption ?? '', paragraphs: JSON.parse(r.body as string) as Paragraph[], changedBy });
		}
	}
	// IF世界で変えた条が現実で内部IDを変えたら、現実の新しい条は同じ条なので出さない（番号が変わったときも）
	if (imported) {
		const replaced = new Set([...byId.values()].filter((a) => a.changedBy).map((a) => a.id));
		for (const r of (await importedRows(db, lawId)).filter((r) => r.seq <= seq && r.closedProvisionId !== null)) {
			if (!replaced.has(r.closedProvisionId as number) || byId.get(r.provisionId)?.changedBy) continue;
			byId.delete(r.provisionId);
			replaced.add(r.provisionId);
		}
	}
	const byNum = new Map<string, (typeof base)[number] & { changedBy: { id: number; title: string } | null }>();
	for (const a of byId.values()) {
		const other = byNum.get(a.num);
		if (!other || a.changedBy) byNum.set(a.num, a);
	}
	return [...byNum.values()].sort((a, b) => compareNum(a.num, b.num));
}

/** 法案の基にした条（docs/spec/72.md 決めたこと3）。IF世界の版が 0 なら分岐した版そのもの */
export async function baseArticlesOf(db: Db, law: { lawId: string | null; baseRevisionId: string | null; baseIfSeq: number }) {
	if (!law.baseRevisionId) return [];
	if (law.baseIfSeq === 0 || !law.lawId) return articlesOfRevision(db, law.baseRevisionId);
	return ifArticles(db, law.lawId, law.baseRevisionId, law.baseIfSeq);
}

type LawContent = { action: BillKind; lawId: string | null; baseRevisionId: string | null; baseIfSeq: number; newTitle: string | null; changes: Pick<BillChange, 'num' | 'op' | 'provisionId'>[] };

/** 取り込みで変わった条（古い順） */
async function importedRows(db: Db, lawId: string) {
	return db
		.select({ seq: ifImports.seq, provisionId: ifImportArticles.provisionId, closedProvisionId: ifImportArticles.closedProvisionId, num: ifImportArticles.num, change: ifImportArticles.change })
		.from(ifImportArticles)
		.innerJoin(ifImports, and(eq(ifImports.lawId, ifImportArticles.lawId), eq(ifImports.revisionId, ifImportArticles.revisionId)))
		.where(eq(ifImportArticles.lawId, lawId))
		.orderBy(asc(ifImports.seq));
}

type TouchedArticle = { id: number | null; num: string; removed: boolean };

/**
 * 基にした版より後に変わった条に触れるか。廃止は変わった条すべて。self は調べない法案（同時に走った別の実行の行を自分と衝突させない）。
 * 取り込みの行は、内部IDで比べる（番号は現実の番号なので）。足す条だけ番号で比べる（docs/spec/95.md 決めたこと3）
 */
function touching(rows: Awaited<ReturnType<typeof overlayRows>>, imported: Awaited<ReturnType<typeof importedRows>>, law: LawContent, self: number | null): TouchedArticle[] {
	const later = rows.filter((r) => r.seq > law.baseIfSeq && r.billId !== self && r.num !== null);
	const laterImports = imported.filter((r) => r.seq > law.baseIfSeq);
	const fromImport = (r: (typeof imported)[number]): TouchedArticle => ({ id: r.provisionId, num: r.num, removed: r.change === 'removed' });
	const fromBill = (r: (typeof rows)[number]): TouchedArticle => ({ id: articleId(r), num: r.num as string, removed: false });
	if (law.action === 'repeal') return [...later.map(fromBill), ...laterImports.map(fromImport)];
	const ids = new Set(law.changes.map((c) => c.provisionId).filter((id) => id !== null));
	const nums = new Set(law.changes.map((c) => c.num));
	const addedNums = new Set(law.changes.filter((c) => c.op === 'add').map((c) => c.num));
	return [
		...later
			.filter((r) => {
				const id = articleId(r);
				return (id !== null && ids.has(id)) || nums.has(r.num as string);
			})
			.map(fromBill),
		...laterImports.filter((r) => ids.has(r.provisionId) || (r.closedProvisionId !== null && ids.has(r.closedProvisionId)) || addedNums.has(r.num)).map(fromImport)
	];
}

/** 内部IDからいまの IF世界の条を引く。IF世界に残っている条は内部IDのまま引き、なければ内部IDが変わった先をたどる */
function articleByProvision<T extends { id: number }>(articles: T[], imported: Awaited<ReturnType<typeof importedRows>>) {
	const next = new Map(imported.filter((r) => r.closedProvisionId !== null).map((r) => [r.closedProvisionId as number, r.provisionId]));
	const byId = new Map(articles.map((a) => [a.id, a]));
	return (id: number) => {
		let at: number | undefined = id;
		while (at !== undefined) {
			const found = byId.get(at);
			if (found) return found;
			at = next.get(at);
		}
		return undefined;
	};
}

/** 基にしたあとで変わった条に触れる行の、いまの条文（docs/spec/72.md の B2）。なくなった条は中身なしで返す（返さないと発議を断れない） */
export async function staleArticles(db: Db, law: LawContent) {
	if (!law.lawId) return [];
	const [rows, imported] = await Promise.all([overlayRows(db, law.lawId), importedRows(db, law.lawId)]);
	const touched = touching(rows, imported, law, null);
	if (!touched.length) return [];
	const head = await ifHeadOf(db, law.lawId);
	if (!head.branchRevisionId) return [];
	const articles = await ifArticles(db, law.lawId, head.branchRevisionId, head.seq);
	const find = articleByProvision(articles, imported);
	const result = new Map<string, { num: string; label: string; caption: string; body: string }>();
	for (const t of touched) {
		// 内部IDでいまの条を選ぶ。なければ番号で（隠れた現実の条の番号には IF世界の条がある）。なくなった条は番号で選ばない
		const a = (t.id !== null ? find(t.id) : undefined) ?? (t.removed ? undefined : articles.find((x) => x.num === t.num));
		if (a) result.set(a.num, { num: a.num, label: a.label, caption: a.caption, body: articleBodyText(a.paragraphs) });
		// 同じ番号にいまの条があれば、そちらを出す
		else if (!result.has(t.num)) result.set(t.num, { num: t.num, label: articleLabel(t.num), caption: '', body: '' });
	}
	return [...result.values()].sort((a, b) => compareNum(a.num, b.num));
}

/** 書く画面に出す番号（docs/spec/95.md 決めたこと4）：内部IDのいまの IF世界の番号。内部IDが変わった条はいまの条の番号。なくなった条は null */
export async function currentNumsOf(db: Db, lawId: string, provisionIds: number[]) {
	const head = await ifHeadOf(db, lawId);
	const articles = head.branchRevisionId ? await ifArticles(db, lawId, head.branchRevisionId, head.seq) : [];
	const find = articleByProvision(articles, await importedRows(db, lawId));
	return new Map(provisionIds.map((id) => [id, find(id)?.num ?? null]));
}

/** 発議を断る理由。可決しても必ず要調整か廃案になる下書き（docs/spec/72.md の E と B4） */
export async function proposeBlock(db: Db, bill: { laws: LawContent[] }): Promise<'repealed' | 'title' | 'stale' | null> {
	for (const law of bill.laws) {
		if (law.action === 'enact') {
			const [taken] = await db.select({ id: ifLaws.id }).from(ifLaws).where(eq(ifLaws.title, law.newTitle ?? ''));
			if (taken) return 'title';
			continue;
		}
		if (!law.lawId) continue;
		if ((await ifHeadOf(db, law.lawId)).repealed) return 'repealed';
		if ((await staleArticles(db, law)).length) return 'stale';
	}
	return null;
}

/** 衝突の理由。優先は repealed → title → article */
async function conflictOf(db: Db, billId: number, law: LawContent): Promise<AdjustmentReason | null> {
	if (law.action === 'enact') {
		const [taken] = await db.select({ billId: ifLaws.billId }).from(ifLaws).where(eq(ifLaws.title, law.newTitle ?? ''));
		return taken && taken.billId !== billId ? 'title' : null;
	}
	if (!law.lawId) return null;
	const [rows, imported] = await Promise.all([overlayRows(db, law.lawId), importedRows(db, law.lawId)]);
	if (rows.some((r) => r.action === 'repeal' && r.billId !== billId)) return 'repealed';
	return touching(rows, imported, law, billId).length ? 'article' : null;
}

/** 版の法令ごとの中身（衝突の判定と反映で使う） */
async function lawContentsOf(db: Db, billId: number, rev: number) {
	const lawRows = await db
		.select()
		.from(billLaws)
		.where(and(eq(billLaws.billId, billId), eq(billLaws.rev, rev)))
		.orderBy(asc(billLaws.seq));
	const changeRows = await db
		.select()
		.from(billChanges)
		.where(and(eq(billChanges.billId, billId), eq(billChanges.rev, rev)));
	return lawRows.map((l) => ({
		seq: l.seq,
		action: l.action,
		lawId: l.lawId,
		baseRevisionId: l.baseRevisionId,
		baseIfSeq: l.baseIfSeq,
		newTitle: l.newTitle,
		changes: changeRows.filter((c) => c.lawSeq === l.seq).map((c) => ({ num: c.num, op: c.op, provisionId: c.provisionId }))
	}));
}

/**
 * 発議のあとの条文のぶつかりを知らせる（docs/spec/78.md 決めたこと6）。Cron の処理の最後に毎日。
 * 直前の会期の質疑の始まりより後に発議した法案は、まだ結果が出ていない（status が proposed のままの過去の法案を読まない）。
 * 反映のときと同じ判定で、失敗してもログに出して残りを続ける。次の日にまた通る
 */
export async function notifyConflicts(db: Db, now: number): Promise<void> {
	const last = sessionAt(sessionAt(now, null).startsAt - 1, null);
	try {
		const open = await db
			.select({ id: bills.id, rev: bills.proposedRev })
			.from(bills)
			.where(and(eq(bills.status, 'proposed'), gte(bills.proposedAt, last.deliberationAt)))
			.orderBy(asc(bills.id));
		for (const bill of open) {
			if (bill.rev === null) continue;
			try {
				const contents = await lawContentsOf(db, bill.id, bill.rev);
				const reasons = await Promise.all(contents.map((l) => conflictOf(db, bill.id, l)));
				if (reasons.some((r) => r !== null)) await notify(db, billMembers(bill.id), 'bill_conflict', bill.id, bill.rev, now);
			} catch (e) {
				console.error(e);
			}
		}
	} catch (e) {
		console.error(e);
	}
}

/** 1本の法案を反映する。衝突なら要調整。最後の1文（if_revisions か if_laws）が入ったときが反映で、途中で失敗してもやり直せる */
async function applyBill(db: BatchDb, session: Session, bill: { id: number; rev: number; proposedAt: number | null }, minutes: number | null, now: number) {
	const contents = await lawContentsOf(db, bill.id, bill.rev);

	const reasons = await Promise.all(contents.map((l) => conflictOf(db, bill.id, l)));
	const reason: AdjustmentReason | null = reasons.includes('repealed') ? 'repealed' : reasons.includes('title') ? 'title' : reasons.includes('article') ? 'article' : null;
	if (reason) {
		// 同じ文で「この版が反映されていない」ことを確かめる（同時に走った別の実行が反映したあとで、自分自身と衝突したことにしない）
		await db.run(sql`
			INSERT INTO ${billAdjustments} (bill_id, session_key, reason, due_at, proposed_at, created_at)
			SELECT ${bill.id}, ${session.key}, ${reason}, ${referralSession(now, minutes).deliberationAt}, ${bill.proposedAt}, ${now}
			WHERE NOT EXISTS (SELECT 1 FROM ${ifRevisions} r WHERE r.bill_id = ${bill.id} AND r.bill_rev = ${bill.rev})
			AND NOT EXISTS (SELECT 1 FROM ${ifLaws} l WHERE l.bill_id = ${bill.id})
			ON CONFLICT DO NOTHING`);
		return;
	}
	for (const law of contents) {
		if (law.action === 'enact') {
			await db.insert(ifLaws).values({ id: `if-${bill.id}`, billId: bill.id, billRev: bill.rev, title: law.newTitle as string, sessionKey: session.key, createdAt: now }).onConflictDoNothing();
			continue;
		}
		const lawId = law.lawId as string;
		await ifBranchOf(db, lawId);
		// 足す条の内部IDを先に作る。残っても版から指されなければ読まれない。内部IDは DB が採番する
		for (const change of law.changes.filter((c) => c.op === 'add')) {
			const [known] = await db
				.select({ id: ifAddedArticles.provisionId })
				.from(ifAddedArticles)
				.where(and(eq(ifAddedArticles.lawId, lawId), eq(ifAddedArticles.num, change.num)));
			if (known) continue;
			const [created] = await db.insert(provisions).values({ lawId, kind: 'article' }).returning({ id: provisions.id });
			await db.insert(ifAddedArticles).values({ lawId, num: change.num, provisionId: created.id, createdAt: now }).onConflictDoNothing();
		}
		await db.run(sql`
			INSERT INTO ${ifRevisions} (law_id, seq, bill_id, bill_rev, law_seq, session_key, created_at)
			SELECT ${lawId}, ${nextIfSeq(lawId)}, ${bill.id}, ${bill.rev}, ${law.seq}, ${session.key}, ${now}
			ON CONFLICT DO NOTHING`);
	}
}

/**
 * 可決した法案を発議の早い順に反映する（docs/spec/72.md 決めたこと5）。呼ぶ側がすべての結果が入ったことを確かめる。
 * 1本が失敗したら止めて投げ直す（後の法案を先に反映すると順が逆になり、取り消せない）
 */
export async function applySession(db: BatchDb, session: Session, minutes: number | null, now: number) {
	const pending = await db
		.select({ id: bills.id, rev: billResults.rev, proposedAt: bills.proposedAt })
		.from(billResults)
		.innerJoin(bills, eq(bills.id, billResults.billId))
		.where(
			and(
				eq(billResults.sessionKey, session.key),
				eq(billResults.outcome, 'passed'),
				sql`NOT EXISTS (SELECT 1 FROM ${ifRevisions} r WHERE r.bill_id = ${billResults}.bill_id AND r.bill_rev = ${billResults}.rev)`,
				sql`NOT EXISTS (SELECT 1 FROM ${ifLaws} l WHERE l.bill_id = ${billResults}.bill_id)`,
				sql`NOT EXISTS (SELECT 1 FROM ${billAdjustments} a WHERE a.bill_id = ${billResults}.bill_id AND a.session_key = ${session.key})`,
				// 確認中と無効は反映しない（docs/spec/73.md 決めたこと4）。確定すると次の処理で反映される
				sql`NOT EXISTS (SELECT 1 FROM ${voteReviews} v WHERE v.bill_id = ${billResults}.bill_id AND v.session_key = ${session.key} AND v.status IN ('open', 'voided'))`
			)
		)
		.orderBy(asc(bills.proposedAt), asc(bills.id));
	for (const bill of pending) await applyBill(db, session, bill, minutes, now);
}

/** 1つの法令を、その会期の最終日までに施行された版まで取り込む。途中に条件を満たさない版があれば、その後ろは取り込まない */
async function importLaw(db: BatchDb, session: Session, lawId: string, lastDay: string, now: number) {
	const { repealed, branchRevisionId, baseRevisionId } = await ifHeadOf(db, lawId);
	if (repealed || !branchRevisionId || !baseRevisionId) return;
	const [pin] = await db.select({ seq: lawRevisions.seq }).from(lawRevisions).where(eq(lawRevisions.id, baseRevisionId));
	const later = await db
		.select({ id: lawRevisions.id, status: lawRevisions.status, date: lawRevisions.enforcementDate })
		.from(lawRevisions)
		.where(and(eq(lawRevisions.lawId, lawId), eq(lawRevisions.branch, 'real'), gt(lawRevisions.seq, pin.seq)))
		.orderBy(asc(lawRevisions.seq));
	let base = baseRevisionId;
	for (const revision of later) {
		if (revision.status !== 'enforced' || revision.date > lastDay) break;
		const [before, after, head] = await Promise.all([articlesOfRevision(db, base), articlesOfRevision(db, revision.id), ifHeadOf(db, lawId)]);
		const changedInIf = (await ifArticles(db, lawId, branchRevisionId, head.seq)).filter((a): a is typeof a & IfArticle => a.changedBy !== null);
		const closedOf = new Map((await importedRows(db, lawId)).map((r) => [r.provisionId, r.closedProvisionId]));
		const earlierIds = (id: number | null) => {
			const ids: number[] = [];
			for (let at = id === null ? null : (closedOf.get(id) ?? null); at !== null; at = closedOf.get(at) ?? null) ids.push(at);
			return ids;
		};
		const rows = changedArticles(before, after).map((c) => {
			const conflict = articleConflict(c, changedInIf, [...earlierIds(c.provisionId), ...earlierIds(c.closedProvisionId)]);
			return {
				lawId,
				revisionId: revision.id,
				provisionId: c.provisionId,
				num: c.num,
				prevNum: c.prevNum,
				change: c.change,
				conflict: conflict ? 1 : 0,
				realCaption: conflict?.realCaption ?? null,
				realBody: conflict?.realBody ?? null,
				ifNum: conflict?.ifNum ?? null,
				ifCaption: conflict?.ifCaption ?? null,
				ifBody: conflict?.ifBody ?? null,
				billId: conflict?.billId ?? null,
				closedProvisionId: c.closedProvisionId
			};
		});
		const statements: BatchItem<'sqlite'>[] = [db.insert(ifImports).values({ lawId, seq: nextIfSeq(lawId), revisionId: revision.id, sessionKey: session.key, createdAt: now }).onConflictDoNothing()];
		for (let i = 0; i < rows.length; i += IMPORT_ROWS_PER_STATEMENT) statements.push(db.insert(ifImportArticles).values(rows.slice(i, i + IMPORT_ROWS_PER_STATEMENT)).onConflictDoNothing());
		await db.batch(statements as never);
		base = revision.id;
	}
}

/**
 * 現実の改正の取り込み（docs/spec/95.md 決めたこと1）。Cron の会期の処理の最後にだけ呼ぶ。法令ごとに1つの会期に1回で、
 * 1つの法令の失敗で残りを止めず、失敗した法令だけ次の日にやり直す。lawId を渡すとその法令だけで、終わった記録を見ず入れない（画面のテストのデータ用）
 */
export async function importReal(db: BatchDb, session: Session, now: number, lawId?: string) {
	const lastDay = new Date(session.endsAt - 1 + JST).toISOString().slice(0, 10);
	if (lawId) return importLaw(db, session, lawId, lastDay, now);
	const targets = await db
		.select({ id: laws.id })
		.from(laws)
		.where(sql`NOT EXISTS (SELECT 1 FROM if_import_runs r WHERE r.law_id = ${laws}.id AND r.session_key = ${session.key})`)
		.orderBy(asc(laws.id));
	const causes: unknown[] = [];
	for (const { id } of targets) {
		try {
			await importLaw(db, session, id, lastDay, now);
			await db.insert(ifImportRuns).values({ sessionKey: session.key, lawId: id, createdAt: now }).onConflictDoNothing();
		} catch (e) {
			console.error(e);
			causes.push(e);
		}
	}
	if (causes.length) throw new AggregateError(causes, `${causes.length} つの法令の現実の改正を取り込めませんでした`);
}

/** 取り込みの一覧の1ページ（新しい順）。内部IDは渡さない。現実の法令でなければ undefined */
export async function importPage(db: Db, lawId: string, page: number) {
	const [law] = await db.select({ id: laws.id, title: laws.title }).from(laws).where(eq(laws.id, lawId));
	if (!law) return undefined;
	const rows = await db
		.select({ seq: ifImports.seq, revisionId: ifImports.revisionId, date: lawRevisions.enforcementDate, amendmentTitle: lawRevisions.amendmentLawTitle, amendmentNum: lawRevisions.amendmentLawNum })
		.from(ifImports)
		.innerJoin(lawRevisions, eq(lawRevisions.id, ifImports.revisionId))
		.where(eq(ifImports.lawId, lawId))
		.orderBy(desc(ifImports.seq))
		.limit(PAGE_SIZE + 1)
		.offset((page - 1) * PAGE_SIZE);
	const shown = rows.slice(0, PAGE_SIZE);
	const articles = shown.length
		? await db
				.select({
					revisionId: ifImportArticles.revisionId,
					num: ifImportArticles.num,
					prevNum: ifImportArticles.prevNum,
					change: ifImportArticles.change,
					conflict: ifImportArticles.conflict,
					realCaption: ifImportArticles.realCaption,
					realBody: ifImportArticles.realBody,
					ifNum: ifImportArticles.ifNum,
					ifCaption: ifImportArticles.ifCaption,
					ifBody: ifImportArticles.ifBody,
					billId: ifImportArticles.billId,
					billTitle: bills.title
				})
				.from(ifImportArticles)
				.leftJoin(bills, eq(bills.id, ifImportArticles.billId))
				.where(and(eq(ifImportArticles.lawId, lawId), inArray(ifImportArticles.revisionId, shown.map((r) => r.revisionId))))
		: [];
	const label = (num: string | null) => (num === null ? '' : articleLabel(num));
	const byNum = (a: { num: string }, b: { num: string }) => compareNum(a.num, b.num);
	return {
		law,
		hasNext: rows.length > PAGE_SIZE,
		imports: shown.map(({ revisionId, ...r }) => {
			const own = articles.filter((a) => a.revisionId === revisionId).sort(byNum);
			return {
				...r,
				changed: own.filter((a) => a.conflict === 0).map((a) => ({ num: a.num, label: label(a.num), prevLabel: label(a.prevNum), change: a.change })),
				conflicts: own
					.filter((a) => a.conflict === 1)
					.map((a) => ({
						num: a.num,
						label: label(a.num),
						prevLabel: label(a.prevNum),
						change: a.change,
						realCaption: a.realCaption ?? '',
						realBody: a.realBody,
						ifLabel: label(a.ifNum),
						ifCaption: a.ifCaption ?? '',
						ifBody: a.ifBody,
						bill: a.billId === null ? null : { id: a.billId, title: a.billTitle as string }
					}))
			};
		})
	};
}

/** IF世界の法令ページの印：ぶつかった条のうち、その取り込みより後に IF世界の法案が変えていない条の番号（docs/spec/95.md 決めたこと5） */
async function conflictNums(db: Db, lawId: string) {
	const rows = await db
		.select({ seq: ifImports.seq, provisionId: ifImportArticles.provisionId, closedProvisionId: ifImportArticles.closedProvisionId, ifNum: ifImportArticles.ifNum })
		.from(ifImportArticles)
		.innerJoin(ifImports, and(eq(ifImports.lawId, ifImportArticles.lawId), eq(ifImports.revisionId, ifImportArticles.revisionId)))
		.where(and(eq(ifImportArticles.lawId, lawId), eq(ifImportArticles.conflict, 1)));
	if (!rows.length) return new Set<string>();
	const overlay = await overlayRows(db, lawId);
	const later = (r: (typeof rows)[number]) =>
		overlay.some((o) => {
			const id = articleId(o);
			return o.seq > r.seq && (o.num === r.ifNum || (id !== null && (id === r.provisionId || id === r.closedProvisionId)));
		});
	return new Set(rows.filter((r) => !later(r)).map((r) => r.ifNum as string));
}

export type IfPlace = { lawId: string } | null;

/** 法案の版が反映された先。結果のページの「IF世界の条文を見る」に使う。なければ null */
export async function ifPlaceOf(db: Db, billId: number, rev: number): Promise<IfPlace> {
	const [revision] = await db
		.select({ lawId: ifRevisions.lawId })
		.from(ifRevisions)
		.where(and(eq(ifRevisions.billId, billId), eq(ifRevisions.billRev, rev)))
		.orderBy(asc(ifRevisions.lawSeq))
		.limit(1);
	if (revision) return { lawId: revision.lawId };
	const [law] = await db
		.select({ id: ifLaws.id })
		.from(ifLaws)
		.where(and(eq(ifLaws.billId, billId), eq(ifLaws.billRev, rev)));
	return law ? { lawId: law.id } : null;
}

/** その会期の要調整の行（解決済みも含む） */
export async function adjustmentRowOf(db: Db, sessionKey: string, billId: number) {
	const [row] = await db
		.select({ reason: billAdjustments.reason })
		.from(billAdjustments)
		.where(and(eq(billAdjustments.sessionKey, sessionKey), eq(billAdjustments.billId, billId)));
	return row;
}

/** いまの付託先の会期の、未解決の要調整 */
export async function adjustmentOf(db: Db, sessionKey: string, billId: number) {
	const [row] = await db
		.select({ reason: billAdjustments.reason, dueAt: billAdjustments.dueAt, resolvedAt: billAdjustments.resolvedAt })
		.from(billAdjustments)
		.where(and(eq(billAdjustments.sessionKey, sessionKey), eq(billAdjustments.billId, billId)));
	return row && row.resolvedAt === null ? { reason: row.reason, dueAt: row.dueAt } : null;
}

/** 一覧の1ページの法案の要調整。番号は1ページの件数まで */
export async function adjustmentsFor(db: Db, billIds: number[]) {
	if (!billIds.length) return [];
	return db.select({ billId: billAdjustments.billId, sessionKey: billAdjustments.sessionKey, reason: billAdjustments.reason, dueAt: billAdjustments.dueAt, resolvedAt: billAdjustments.resolvedAt }).from(billAdjustments).where(inArray(billAdjustments.billId, billIds));
}

/** 直してよいか（提出者、未解決、期限の前、法令の廃止でない） */
const adjustable = (a: { reason: AdjustmentReason; dueAt: number } | null, now: number) => a !== null && a.reason !== 'repealed' && now < a.dueAt;

/**
 * 要調整の法案を直す（docs/spec/72.md 決めたこと7）。題名・種類・対象の法令は変えられない（法令名の重なりは法令名だけ直せる）。
 * 賛同は発議した版の行を新しい版に写して保つ。付託先は発議の時刻から求まるので次の会期になる
 */
export async function saveAdjustedBill(
	db: BatchDb,
	actor: Actor,
	bill: { id: number; rev: number; proposedRev: number | null; proposedAt: number | null; userId: string; kind: BillKind; title: string; laws: { lawId: string | null; newTitle: string | null }[] },
	expectedRev: number,
	input: DraftInput,
	now: number
): Promise<{ ok: true; saved: boolean } | { ok: false; reason: 'locked' } | { ok: false; refusal: Refusal }> {
	// 未解決の行は1つだけ（直すと解決し、次の会期で衝突すれば別の行になる）
	const [adjustment] = await db
		.select({ sessionKey: billAdjustments.sessionKey, reason: billAdjustments.reason, dueAt: billAdjustments.dueAt })
		.from(billAdjustments)
		.where(and(eq(billAdjustments.billId, bill.id), isNull(billAdjustments.resolvedAt)));
	if (bill.userId !== actor.userId || !adjustment || !adjustable(adjustment, now)) return { ok: true, saved: false };
	const sameLaws = input.laws.length === bill.laws.length && input.laws.every((l, i) => l.lawId === bill.laws[i].lawId && (adjustment.reason === 'title' || l.newTitle === bill.laws[i].newTitle));
	if (input.kind !== bill.kind || input.title !== bill.title || !sameLaws) return { ok: false, reason: 'locked' };
	const [day] = await db
		.select({ n: count() })
		.from(actions)
		.where(and(eq(actions.kind, 'bill_save'), eq(actions.userId, actor.userId), gt(actions.createdAt, now - DAY)));
	const refusal = checkBillSave({ accountSaves: day.n });
	if (refusal) return refuse(db, actor, refusal, now);

	const isOpen = and(eq(bills.id, bill.id), eq(bills.rev, expectedRev), eq(bills.userId, actor.userId), eq(bills.status, 'proposed'), savedBill);
	const [taken] = await db
		.update(bills)
		.set({ nextRev: sql`${bills.nextRev} + 1` })
		.where(isOpen)
		.returning({ next: bills.nextRev });
	if (!taken) return { ok: true, saved: false };
	const rev = taken.next - 1;
	await insertContent(db, bill.id, rev, input);
	const supporters = await db
		.select({ userId: billSupports.userId, createdAt: billSupports.createdAt })
		.from(billSupports)
		.where(and(eq(billSupports.billId, bill.id), eq(billSupports.rev, bill.proposedRev ?? bill.rev)));
	const copies = Array.from({ length: Math.ceil(supporters.length / SUPPORT_ROWS_PER_STATEMENT) }, (_, i) =>
		db
			.insert(billSupports)
			.values(supporters.slice(i * SUPPORT_ROWS_PER_STATEMENT, (i + 1) * SUPPORT_ROWS_PER_STATEMENT).map((s) => ({ billId: bill.id, rev, userId: s.userId, createdAt: s.createdAt })))
			.onConflictDoNothing()
	);
	await db.batch([
		...copies,
		db
			.update(bills)
			.set({ rev, proposedRev: rev, proposedAt: now, ...fields(input), updatedAt: now })
			.where(and(isOpen, sql`EXISTS (SELECT 1 FROM ${billAdjustments} a WHERE a.bill_id = ${bill.id} AND a.session_key = ${adjustment.sessionKey} AND a.resolved_at IS NULL AND a.due_at > ${now})`)),
		// 上の文で版が進んでいるので、新しい版と比べる（開いたときの版と比べると0行になる）
		db
			.update(billAdjustments)
			.set({ resolvedAt: now })
			.where(and(eq(billAdjustments.billId, bill.id), eq(billAdjustments.sessionKey, adjustment.sessionKey), isNull(billAdjustments.resolvedAt), sql`(SELECT b.rev FROM ${bills} b WHERE b.id = ${bill.id}) = ${rev}`))
	] as never);
	const [row] = await db.select({ rev: bills.rev }).from(bills).where(eq(bills.id, bill.id));
	const saved = row.rev === rev;
	if (saved) {
		await db.insert(actions).values({ kind: 'bill_save', userId: actor.userId, ipHash: actor.ipHash, targetId: bill.id, createdAt: now });
		await notifyProposed(db, bill.id, rev, actor.userId, now);
	}
	return { ok: true, saved };
}

/** IF世界の法令ページに出すもの（現実の法令か制定の新法）。なければ undefined */
export async function ifLawPage(db: Db, lawId: string) {
	const [enacted] = await db.select().from(ifLaws).where(eq(ifLaws.id, lawId));
	if (enacted) {
		const [row, bill] = await Promise.all([
			db
				.select()
				.from(billChanges)
				.where(and(eq(billChanges.billId, enacted.billId), eq(billChanges.rev, enacted.billRev))),
			db.select({ id: bills.id, title: bills.title }).from(bills).where(eq(bills.id, enacted.billId))
		]);
		const articles = row
			.filter((c) => c.body !== null)
			.sort((a, b) => compareNum(a.num, b.num))
			.map((c) => ({ num: c.num, label: articleLabel(c.num), caption: c.caption ?? '', paragraphs: JSON.parse(c.body as string) as Paragraph[], changedBy: null as { id: number; title: string } | null, band: null as string[] | null, conflict: false }));
		return { law: { id: enacted.id, title: enacted.title, lawNum: null as string | null }, real: false, repealed: false, repealedBy: null, enactedBy: bill[0], articles, toc: [] as ReturnType<typeof tableOfContents> };
	}
	const [law] = await db.select().from(laws).where(eq(laws.id, lawId));
	if (!law) return undefined;
	const head = await ifHeadOf(db, lawId);
	if (!head.branchRevisionId) return undefined;
	// 目次と見出しの帯は、いま基にしている現実の版のもの
	const [revision] = await db.select({ headings: lawRevisions.headings }).from(lawRevisions).where(eq(lawRevisions.id, head.baseRevisionId as string));
	const conflicts = await conflictNums(db, lawId);
	const paths = headingPaths(revision?.headings ?? []);
	let previous = '';
	const articles = (await ifArticles(db, lawId, head.branchRevisionId, head.seq)).map(({ id: _, ...a }) => {
		const path = paths.get(a.num) ?? [];
		const key = path.join('\n');
		const band = key && key !== previous ? path : null;
		if (key) previous = key;
		return { ...a, band, conflict: conflicts.has(a.num) };
	});
	const [repealedBill] = head.repealedBy === null ? [] : await db.select({ id: bills.id, title: bills.title }).from(bills).where(eq(bills.id, head.repealedBy));
	return { law: { id: law.id, title: law.title, lawNum: law.lawNum as string | null }, real: true, repealed: head.repealed, repealedBy: repealedBill ?? null, enactedBy: null, articles, toc: tableOfContents(revision?.headings ?? []) };
}
