// 法案の下書きの決まり（設計書 docs/spec/45.md 決めたこと3〜6）。DB にも画面にも触れない
import { diffChars } from 'diff';
import { checkText, CONTROL, type IssueError } from './issues';
import { articleBodyText, compareNum, type DiffPart, type Paragraph } from './law';

export { articleBodyText };

export const BILL_KINDS = ['amend', 'repeal', 'enact'] as const;
export const CHANGE_OPS = ['amend', 'add', 'delete'] as const;
export type BillKind = (typeof BILL_KINDS)[number];
export type ChangeOp = (typeof CHANGE_OPS)[number];

export const BILL_MAX = {
	title: 60,
	affected: 200,
	sideEffects: 400,
	summaryLine: 60,
	summaryLines: 3,
	supplementary: 1000,
	lawTitle: 60,
	caption: 100,
	body: 10000,
	laws: 5,
	changes: 50,
	solutions: 5
} as const;

/** 条ごとの変更点。paragraphs は変更後の項と号（delete は null） */
export type BillChange = { op: ChangeOp; num: string; provisionId: number | null; caption: string | null; paragraphs: Paragraph[] | null };

// ---- 変更後の条文の読み取り（決めたこと3） ----

export type BodyError = 'required' | 'tooLong' | 'control' | 'paragraphOrder' | 'itemOrder' | 'empty';
export type BodyResult = { ok: true; paragraphs: Paragraph[] } | { ok: false; line: number; error: BodyError };

const KANJI_DIGITS: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const ITEM_LINE = /^([一二三四五六七八九十百]+(?:の[一二三四五六七八九十百]+)*)　([\s\S]*)$/;
/** 項の行：半角の算用数字＋全角空白（全角の数字は項の行にしない） */
const PARAGRAPH_LINE = /^([0-9]+)　([\s\S]*)$/;

/** 「十二」→ 12（display.ts の itemLabel の逆） */
function kanjiNumber(s: string): number {
	let total = 0;
	let digit = 0;
	for (const ch of s) {
		if (KANJI_DIGITS[ch]) digit = KANJI_DIGITS[ch];
		else {
			total += (digit || 1) * (ch === '百' ? 100 : 10);
			digit = 0;
		}
	}
	return total + digit;
}

/** 「十二の二」→ "12_2" */
const itemNum = (label: string) => label.split('の').map(kanjiNumber).join('_');

/**
 * 書く画面の「変更後の条文」の欄を、項と号の木にする。形は articleBodyText と同じで、その逆。
 * 1行目は必ず第1項の本文。「2　」の行から次の項、「一　」の行からその項の号。それ以外の行は前の項か号の本文の続き（改行でつなぐ）。空の行は無視する
 */
export function parseArticleBody(raw: string): BodyResult {
	const text = raw.replace(/\r\n?/g, '\n');
	if ([...text].length > BILL_MAX.body) return { ok: false, line: 1, error: 'tooLong' };
	const lines = text.split('\n');
	const paragraphs: Paragraph[] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const at = i + 1;
		if (CONTROL.test(line)) return { ok: false, line: at, error: 'control' };
		if (line.trim() === '') continue;
		if (!paragraphs.length) {
			paragraphs.push({ num: '1', text: line, items: [] });
			continue;
		}
		const current = paragraphs[paragraphs.length - 1];
		const p = PARAGRAPH_LINE.exec(line);
		if (p) {
			if (p[1] !== String(paragraphs.length + 1)) return { ok: false, line: at, error: 'paragraphOrder' };
			if (!p[2].trim()) return { ok: false, line: at, error: 'empty' };
			paragraphs.push({ num: p[1], text: p[2], items: [] });
			continue;
		}
		const item = ITEM_LINE.exec(line);
		if (item) {
			const num = itemNum(item[1]);
			const last = current.items[current.items.length - 1];
			if (last && compareNum(last.num, num) >= 0) return { ok: false, line: at, error: 'itemOrder' };
			if (!item[2].trim()) return { ok: false, line: at, error: 'empty' };
			current.items.push({ num, text: item[2] });
			continue;
		}
		// 続きの行：前の号があればその号、なければ項の本文
		const target = current.items[current.items.length - 1] ?? current;
		target.text += `\n${line}`;
	}
	if (!paragraphs.length) return { ok: false, line: 1, error: 'required' };
	return { ok: true, paragraphs };
}

// ---- 制定のひな形（Issue #47） ----

/** 新法の第1条の見出し（仕様「法令名と第1条（目的）を必須にし」） */
export const ENACT_PURPOSE_CAPTION = '（目的）';
/** ひな形の第1条の、書きかえてもらう印。残っていたら保存しない */
export const ENACT_PLACEHOLDER = '○○';

// ---- 変更点の確かめ（決めたこと4） ----

export type ChangeError =
	| 'unknownProvision'
	| 'numMismatch'
	| 'unchanged'
	| 'bodyMissing'
	| 'captionTooLong'
	| 'captionInvalid'
	| 'deleteDeleted'
	| 'deleteHasBody'
	| 'addNotBranch'
	| 'addExists'
	| 'addNoParent'
	| 'duplicate'
	| 'enactNotAdd'
	| 'enactNumOrder'
	| 'enactPurpose'
	| 'enactPlaceholder'
	| 'amendEmpty'
	| 'repealHasChanges';

/** 基にした版の条（内部IDつき） */
export type BaseArticle = { id: number; num: string; caption: string; paragraphs: Paragraph[] };

/** 本文が「削除」だけの条 */
const isDeleted = (a: BaseArticle) => a.paragraphs.length === 1 && a.paragraphs[0].text === '削除' && a.paragraphs[0].items.length === 0;
const sameArticle = (caption: string, paragraphs: Paragraph[], a: BaseArticle) =>
	caption === a.caption && articleBodyText(paragraphs) === articleBodyText(a.paragraphs);

/**
 * 1つの法令の変更点を確かめる。action はその法令の扱い（改正・廃止・制定）、base は基にした版の条（制定の新法は null）。
 * 誤りは変更点の位置（法令全体のことは -1）と種類。変更点に誤りがあるときは、法令全体の決まりは確かめない
 */
export function checkChanges(
	action: BillKind,
	base: BaseArticle[] | null,
	changes: BillChange[]
): { ok: true } | { ok: false; errors: { index: number; error: ChangeError }[] } {
	if (action === 'repeal') return changes.length ? { ok: false, errors: [{ index: -1, error: 'repealHasChanges' }] } : { ok: true };
	const byId = new Map((base ?? []).map((a) => [a.id, a]));
	const baseNums = new Set((base ?? []).map((a) => a.num));
	const addNums = new Set(changes.filter((c) => c.op === 'add').map((c) => c.num));
	const seenNums = new Set<string>();
	const seenIds = new Set<number>();
	const errors: { index: number; error: ChangeError }[] = [];

	const errorOf = (c: BillChange, i: number): ChangeError | null => {
		if (seenNums.has(c.num) || (c.provisionId !== null && seenIds.has(c.provisionId))) return 'duplicate';
		seenNums.add(c.num);
		if (c.provisionId !== null) seenIds.add(c.provisionId);
		if (c.caption !== null) {
			if ([...c.caption].length > BILL_MAX.caption) return 'captionTooLong';
			if (CONTROL.test(c.caption)) return 'captionInvalid';
		}
		if (action === 'enact') {
			if (c.op !== 'add') return 'enactNotAdd';
			if (c.num !== String(i + 1)) return 'enactNumOrder';
			return c.paragraphs ? null : 'bodyMissing';
		}
		if (c.op === 'add') {
			const parts = c.num.split('_');
			if (!/^\d+(_\d+)+$/.test(c.num)) return 'addNotBranch';
			if (baseNums.has(c.num)) return 'addExists';
			const parent = parts.slice(0, -1).join('_');
			if (!baseNums.has(parent) && !addNums.has(parent)) return 'addNoParent';
			return c.paragraphs ? null : 'bodyMissing';
		}
		const target = c.provisionId === null ? undefined : byId.get(c.provisionId);
		if (!target) return 'unknownProvision';
		if (target.num !== c.num) return 'numMismatch';
		if (c.op === 'delete') {
			if (c.paragraphs !== null) return 'deleteHasBody';
			return isDeleted(target) ? 'deleteDeleted' : null;
		}
		if (!c.paragraphs) return 'bodyMissing';
		return sameArticle(c.caption ?? '', c.paragraphs, target) ? 'unchanged' : null;
	};

	changes.forEach((c, i) => {
		const error = errorOf(c, i);
		if (error) errors.push({ index: i, error });
	});
	if (errors.length) return { ok: false, errors };
	if (action === 'amend' && !changes.length) return { ok: false, errors: [{ index: -1, error: 'amendEmpty' }] };
	if (action === 'enact') {
		const first = changes[0];
		// 第1条（目的）が必須（仕様「法令名と第1条（目的）を必須にし」）
		if (!first || first.caption !== ENACT_PURPOSE_CAPTION || !first.paragraphs?.[0]?.text.trim()) {
			return { ok: false, errors: [{ index: -1, error: 'enactPurpose' }] };
		}
		// ひな形を書きかえずに保存しない（Issue #47 決めたこと2）
		if (articleBodyText(first.paragraphs).includes(ENACT_PLACEHOLDER)) return { ok: false, errors: [{ index: 0, error: 'enactPlaceholder' }] };
	}
	return { ok: true };
}

// ---- 法案の確かめ（決めたこと5） ----

export type BillField = 'kind' | 'title' | 'affected' | 'sideEffects' | 'summary' | 'supplementary' | 'newTitle' | 'laws' | 'changes' | 'solutions';
export type BillError =
	| IssueError
	| 'summaryLines'
	| 'lawTitleSuffix'
	| 'lawCount'
	| 'lawShape'
	| 'lawNotInCommittee'
	| 'duplicateLaw'
	| 'changeCount'
	| 'solutionCount'
	| 'duplicateSolution'
	| 'solutionHidden';

type Text = string | null | undefined;
export type BillRaw = {
	kind: Text;
	title: Text;
	affected: Text;
	sideEffects: Text;
	summary: Text;
	supplementary: Text;
	laws: { action: Text; lawId: string | null; newTitle: string | null }[];
	/** 法案全体の変更点の数 */
	changeCount: number;
	solutionIds: Text[];
};
export type BillValue = {
	kind: BillKind;
	title: string;
	affected: string;
	sideEffects: string;
	summary: string | null;
	supplementary: string | null;
	newTitle: string | null;
	solutionIds: number[];
};


/** 任意の欄：空なら null。誤りは checkText と同じ */
function optional(raw: Text, max: number, multiline: boolean): [string | null, IssueError | null] {
	const [text, error] = checkText(raw, max, multiline);
	return error === 'required' ? [null, null] : [text, error];
}

/** 種類ごとの対象の法令の形（seq 0 が主） */
function lawShapeOk(kind: BillKind, laws: BillRaw['laws']): boolean {
	return laws.every((l, i) => {
		const allowed = i === 0 ? [kind] : kind === 'repeal' ? ['repeal', 'amend'] : ['amend'];
		if (!allowed.includes(String(l.action))) return false;
		return l.action === 'enact' ? l.lawId === null && typeof l.newTitle === 'string' : typeof l.lawId === 'string' && l.newTitle === null;
	});
}

/**
 * 法案のフォームの値を確かめる。committeeLawIds は委員会の対象法令、visibleSolutionIds は引用したい解決策のうち表示中のもの（呼ぶ側が DB から引く）
 */
export function validateBill(
	raw: BillRaw,
	ctx: { committeeLawIds: readonly string[]; visibleSolutionIds: ReadonlySet<number> }
): { ok: true; value: BillValue } | { ok: false; errors: Partial<Record<BillField, BillError>> } {
	const errors: Partial<Record<BillField, BillError>> = {};
	const kind = (BILL_KINDS as readonly string[]).includes(String(raw.kind)) ? (raw.kind as BillKind) : null;
	if (!kind) errors.kind = 'invalid';

	const [title, titleError] = checkText(raw.title, BILL_MAX.title, false);
	const [affected, affectedError] = checkText(raw.affected, BILL_MAX.affected, true);
	const [sideEffects, sideEffectsError] = checkText(raw.sideEffects, BILL_MAX.sideEffects, true);
	const [supplementary, supplementaryError] = optional(raw.supplementary, BILL_MAX.supplementary, true);
	if (titleError) errors.title = titleError;
	if (affectedError) errors.affected = affectedError;
	if (sideEffectsError) errors.sideEffects = sideEffectsError;
	if (supplementaryError) errors.supplementary = supplementaryError;

	// 3行要約：空の行を除いて3行まで、各行60字まで
	let summary: string | null = null;
	const summaryLines = (raw.summary ?? '')
		.replace(/\r\n?/g, '\n')
		.split('\n')
		.map((l) => l.trim())
		.filter(Boolean);
	if (summaryLines.length > BILL_MAX.summaryLines) errors.summary = 'summaryLines';
	else {
		for (const line of summaryLines) {
			const [, e] = checkText(line, BILL_MAX.summaryLine, false);
			if (e) {
				errors.summary = e;
				break;
			}
		}
		if (summaryLines.length && !errors.summary) summary = summaryLines.join('\n');
	}

	// 対象の法令
	let newTitle: string | null = null;
	if (kind) {
		// 境界の関数なので、配列でない値も誤りとして返す
		const laws = Array.isArray(raw.laws) ? raw.laws : [];
		if (laws.length < 1 || laws.length > BILL_MAX.laws) errors.laws = 'lawCount';
		else if (!lawShapeOk(kind, laws)) errors.laws = 'lawShape';
		else if (laws.some((l) => l.lawId !== null && !ctx.committeeLawIds.includes(l.lawId))) errors.laws = 'lawNotInCommittee';
		else if (new Set(laws.map((l) => l.lawId ?? '')).size !== laws.length) errors.laws = 'duplicateLaw';
		else if (kind === 'enact') {
			const [t, e] = checkText(laws[0].newTitle, BILL_MAX.lawTitle, false);
			if (e) errors.newTitle = e;
			else if (!/(法|法律)$/.test(t)) errors.newTitle = 'lawTitleSuffix';
			else newTitle = t;
		}
	}

	if (!Number.isInteger(raw.changeCount) || raw.changeCount < 0 || raw.changeCount > BILL_MAX.changes) errors.changes = 'changeCount';

	// 元になった解決策：1〜5つ、重ならない、表示中のものだけ（形の違う番号は「引用できない解決策」と同じ扱い）
	const ids = (Array.isArray(raw.solutionIds) ? raw.solutionIds : []).map((s) => (/^[1-9]\d{0,9}$/.test(String(s)) ? Number(s) : NaN));
	if (ids.length < 1 || ids.length > BILL_MAX.solutions) errors.solutions = 'solutionCount';
	else if (new Set(ids.map(String)).size !== ids.length) errors.solutions = 'duplicateSolution';
	else if (ids.some((id) => !ctx.visibleSolutionIds.has(id))) errors.solutions = 'solutionHidden';

	if (Object.keys(errors).length) return { ok: false, errors };
	return { ok: true, value: { kind: kind!, title, affected, sideEffects, summary, supplementary, newTitle, solutionIds: ids } };
}

// ---- 正式名（決めたこと6） ----

/** laws は seq の順。title は laws.title（制定の新法は法令名） */
export function formalName(kind: BillKind, laws: { action: BillKind; title: string }[]): string {
	const main = laws[0].title;
	if (kind === 'enact') return `${main}案`;
	if (kind === 'repeal') {
		const repealed = laws.filter((l) => l.action === 'repeal').length;
		return repealed > 1 ? `${main}等を廃止する法律案` : `${main}を廃止する法律案`;
	}
	return laws.length > 1 ? `${main}等の一部を改正する法律案` : `${main}の一部を改正する法律案`;
}

// ---- 変更点の出し方（Issue #46） ----

/** 文字の比べで調べる違いの上限（1条あたり）。超える条は全文の置きかえとして出す */
export const DIFF_MAX_EDIT = 1000;
/**
 * 1ページあたりの違いの予算。比べの手間は違いの量の2乗で増え、公開のページでログインなしに動くので、ページ全体でも抑える。
 * Workers では処理のあいだ時計が進まないので、diffChars の timeout は使えない
 */
export const DIFF_PAGE_BUDGET = 5000;

/** 基にした版の条と変更後の条の文字ごとの違い。cost は使った予算（違いの字数。上限を超えたら上限の分） */
export function changeDiff(before: string, after: string, maxEdit: number): { parts: DiffPart[]; cost: number } {
	const parts = maxEdit > 0 ? diffChars(before, after, { maxEditLength: maxEdit }) : undefined;
	if (!parts) {
		return {
			parts: [
				{ value: before, removed: true },
				{ value: after, added: true }
			],
			cost: maxEdit
		};
	}
	return {
		parts: parts.map(({ value, added, removed }) => ({ value, added, removed })),
		cost: parts.reduce((n, p) => (p.added || p.removed ? n + [...p.value].length : n), 0)
	};
}

// ---- 一覧のタブ（Issue #48） ----

export const BILL_TABS = ['shingi', 'shitagaki', 'owari'] as const;
export type BillTab = (typeof BILL_TABS)[number];

/** ?tab= の値。省くと審議中。決まった値でなければ null。既定の審議中は書かない（同じ内容の URL を2つ作らない） */
export function parseBillTab(raw: string | null): BillTab | null {
	if (raw === null) return 'shingi';
	return raw !== 'shingi' && (BILL_TABS as readonly string[]).includes(raw) ? (raw as BillTab) : null;
}

/** 一覧のページの URL。審議中と1ページ目は省く */
export function billListHref(tab: BillTab, page: number): string {
	const params = new URLSearchParams();
	if (tab !== 'shingi') params.set('tab', tab);
	if (page > 1) params.set('page', String(page));
	const query = params.toString();
	return query ? `/houan?${query}` : '/houan';
}

// ---- 発議要件（Issue #49。設計書 docs/spec/49.md 決めたこと2・3） ----

/** 今月の参加者の 5% を切り上げ、最低3人。割合は小数を使わず整数で計算する */
export const proposalRequirement = (participants: number) => Math.max(3, Math.ceil((participants * 5) / 100));

/** 今月の参加者に数える行動：課題・わかる・解決策・解決策への反応・法案の起草（作る・保存・発議）・賛同。取り消し、通報、違反、運営の操作は数えない */
export const PARTICIPANT_KINDS = ['issue_post', 'support_add', 'solution_post', 'reaction_add', 'bill_draft', 'bill_save', 'bill_support_add', 'bill_propose'] as const;
