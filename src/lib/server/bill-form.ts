// 法案を書く画面のフォームを受ける（Issue #46）。値を読み、validateBill・parseArticleBody・checkChanges と
// 基にした版の比べ（docs/spec/45.md 決めたこと7）を通して、createDraft・saveDraft に渡す形にする
import { and, eq, inArray } from 'drizzle-orm';
import { ja } from '../copy/ja';
import { committeeLaws, ifLaws, issues, laws, lawRevisions, solutions } from '../db/schema';
import {
	BILL_MAX,
	CHANGE_OPS,
	checkChanges,
	parseArticleBody,
	parseBaseToken,
	validateBill,
	type BaseArticle,
	type BillChange,
	type BillError,
	type BillField,
	type ChangeError,
	type ChangeOp
} from '../domain/bills';
import { LISTED, SOLUTION_SHOWN } from '../domain/reports';
import { ifArticles, ifHeadOf } from './if-world';
import type { Db } from './law';
import type { DraftInput } from './bills';

/** 第1委員会（消費者保護）。委員会が1つのあいだは、法案はすべてここに出す */
export const FIRST_COMMITTEE = 1;
/** 書く画面で選べる種類 */
export const FORM_KINDS = ['amend', 'repeal', 'enact'] as const;
export type FormKind = (typeof FORM_KINDS)[number];

/** seq はどの法令の行か（法令の位置。0 が主。docs/spec/53.md 決めたこと3） */
export type RowValues = { op: string; target: string; num: string; caption: string; body: string; seq?: string };
/** 足した法令（law.N・base.N・action.N。N は 1 から） */
export type ExtraLawValues = { law: string; base: string; action: string };
export type BillFormValues = {
	kind: string;
	title: string;
	/** 制定の法令名 */
	newTitle: string;
	law: string;
	base: string;
	extras: ExtraLawValues[];
	/** law.N の番号が飛んでいた（作り変えた値） */
	gap?: boolean;
	affected: string;
	sideEffects: string;
	summary: string;
	supplementary: string;
	solutions: string[];
	rows: RowValues[];
};
export type RowField = 'target' | 'num' | 'caption' | 'body';
export type BillFormErrors = {
	fields: Partial<Record<BillField, string>>;
	rows: Record<number, { field: RowField; message: string }>;
	/** 変更点全体の誤り（主の法令の変える条がない、廃止に条がある、法案全体で多すぎる） */
	changes?: string;
	/** 足した法令の枠の誤り（位置は seq） */
	laws?: Record<number, { law?: string; changes?: string }>;
	message?: string;
};

/** 変更の行は 0 から続く番号で送る。上限の1つ先まで読み、超えたことが分かるようにする */
const ROW_SCAN = BILL_MAX.changes + 1;

export function readBillForm(form: FormData): BillFormValues {
	const s = (key: string) => {
		const v = form.get(key);
		return typeof v === 'string' ? v : '';
	};
	const rows: RowValues[] = [];
	for (let i = 0; i < ROW_SCAN && form.has(`op.${i}`); i++) {
		rows.push({ op: s(`op.${i}`), target: s(`target.${i}`), num: s(`num.${i}`), caption: s(`caption.${i}`), body: s(`body.${i}`), seq: s(`seq.${i}`) });
	}
	// 足した法令は上限まで読む（上限を超えたことは数で分かる）。途中が抜けていれば作り変えた値
	const extras: ExtraLawValues[] = [];
	let gap = false;
	let missing = false;
	for (let n = 1; n <= BILL_MAX.laws; n++) {
		if (!form.has(`law.${n}`)) {
			missing = true;
			continue;
		}
		if (missing) gap = true;
		extras.push({ law: s(`law.${n}`), base: s(`base.${n}`), action: s(`action.${n}`) || 'amend' });
	}
	return {
		kind: s('kind'),
		title: s('title'),
		newTitle: s('newTitle'),
		law: s('law'),
		base: s('base'),
		extras,
		gap,
		affected: s('affected'),
		sideEffects: s('sideEffects'),
		summary: s('summary'),
		supplementary: s('supplementary'),
		solutions: form.getAll('solution').filter((v): v is string => typeof v === 'string'),
		rows
	};
}

/** 足す条の番号：「第3条の2」「3条の2」（全角の数字も）→ "3_2"。枝番のない「第3条」は "3"（checkChanges が枝番でないと断る） */
export function branchNum(label: string): string | null {
	const m = /^第?([1-9]\d{0,3})条?((?:の[1-9]\d{0,3})*)$/.exec(label.normalize('NFKC').replace(/\s/g, ''));
	return m ? m[1] + m[2].replaceAll('の', '_') : null;
}

const fieldMessage = (e: BillError) => {
	const messages: Record<string, string> = ja.bill.errors;
	return messages[e] ?? ja.bill.formInvalid;
};

/** 変更点の誤りを出す欄 */
const CHANGE_FIELD: Record<ChangeError, RowField> = {
	unknownProvision: 'target',
	numMismatch: 'target',
	deleteDeleted: 'target',
	duplicate: 'target',
	addNotBranch: 'num',
	addExists: 'num',
	addNoParent: 'num',
	captionTooLong: 'caption',
	captionInvalid: 'caption',
	unchanged: 'body',
	bodyMissing: 'body',
	deleteHasBody: 'body',
	enactNotAdd: 'num',
	enactNumOrder: 'num',
	enactPurpose: 'caption',
	enactPlaceholder: 'body',
	amendEmpty: 'target',
	repealHasChanges: 'target'
};

type Checked = { ok: true; input: DraftInput } | { ok: false; status: 400 | 409; errors: BillFormErrors };

/** 行の法令の位置：空なら 0。10進の整数で、法令の数より小さいこと（作り変えた値は null） */
const rowSeq = (raw: string | undefined, lawCount: number) => {
	if (!raw) return 0;
	if (!/^(0|[1-9]\d?)$/.test(raw)) return null;
	const n = Number(raw);
	return n < lawCount ? n : null;
};

type LawBase = { lawId: string; baseId: string; baseIfSeq: number; articles: Awaited<ReturnType<typeof ifArticles>> };

/**
 * フォームの値を確かめる。形の違う値（作り変えたもの）も、欄の誤りと同じく 400 で返す。
 * 法令ごとに、版の印・廃止・基にした版・変更点を確かめる（docs/spec/53.md 決めたこと4）。行の誤りは法案全体の通し番号で返す
 */
export async function checkBillForm(db: Db, v: BillFormValues): Promise<Checked> {
	const errors: BillFormErrors = { fields: {}, rows: {} };
	const invalid = (): Checked => ({ ok: false, status: 400, errors: { ...errors, message: ja.bill.formInvalid } });
	const kind = (FORM_KINDS as readonly string[]).includes(v.kind) ? (v.kind as FormKind) : null;
	if (v.gap) return invalid();
	const lawError = (seq: number, e: { law?: string; changes?: string }) => {
		errors.laws ??= {};
		errors.laws[seq] = { ...errors.laws[seq], ...e };
	};

	const lawIds = (await db.select({ id: committeeLaws.lawId }).from(committeeLaws).where(eq(committeeLaws.committeeId, FIRST_COMMITTEE))).map(
		(r) => r.id
	);
	const ids = v.solutions.filter((s) => /^[1-9]\d{0,9}$/.test(s)).map(Number);
	// 数が上限を超えていれば問い合わせない（validateBill が誤りにする。D1 は1文に100個までしか値を結び付けられない）。
	// 引用できるのは、一覧に出る課題の表示中の解決策（課題はほかの課題でもよい。docs/spec/53.md 決めたこと7）
	const visible =
		ids.length && v.solutions.length <= BILL_MAX.solutions
			? await db
					.select({ id: solutions.id })
					.from(solutions)
					.innerJoin(issues, eq(issues.id, solutions.issueId))
					.where(and(inArray(solutions.id, ids), inArray(solutions.status, SOLUTION_SHOWN), inArray(issues.status, LISTED)))
			: [];
	const main = kind === 'enact' ? { action: kind, lawId: null, newTitle: v.newTitle } : { action: kind, lawId: v.law, newTitle: null };
	const checked = validateBill(
		{
			kind,
			title: v.title,
			affected: v.affected,
			sideEffects: v.sideEffects,
			summary: v.summary,
			supplementary: v.supplementary,
			laws: kind ? [main, ...v.extras.map((x) => ({ action: x.action, lawId: x.law, newTitle: null }))] : [],
			changeCount: v.rows.length,
			solutionIds: v.solutions
		},
		{ committeeLawIds: lawIds, visibleSolutionIds: new Set(visible.map((r) => r.id)) }
	);
	if (!checked.ok) {
		for (const [field, e] of Object.entries(checked.errors) as [BillField, BillError][]) errors.fields[field] = fieldMessage(e);
		if (checked.errors.changes) errors.changes = errors.fields.changes;
	}
	if (!kind) return invalid();
	const lawCount = 1 + v.extras.length;
	const seqs = v.rows.map((r) => rowSeq(r.seq, lawCount));
	if (seqs.some((n) => n === null)) return invalid();

	// 選ばれていない法令は「選んでください」。それ以外の対象外の法令は作り変えた値
	const mainEmpty = kind !== 'enact' && !v.law;
	if (mainEmpty || v.extras.some((x) => !x.law)) {
		// 空の法令は validateBill が対象外の法令とみなすので、その誤りは出さない
		delete errors.fields.laws;
		if (mainEmpty) errors.fields.laws = ja.bill.lawRequired;
		v.extras.forEach((x, i) => {
			if (!x.law) lawError(i + 1, { law: ja.bill.lawRequired });
		});
		return { ok: false, status: 400, errors };
	}
	// 種類を切り替えると、主と足した枠で同じ法令を選べてしまうので、重なった枠のそばに出す
	if (!checked.ok && checked.errors.laws === 'duplicateLaw') {
		const chosen = [kind === 'enact' ? null : v.law, ...v.extras.map((x) => x.law)];
		const at = chosen.findIndex((law, i) => law !== null && chosen.indexOf(law) < i);
		if (at > 0) {
			lawError(at, { law: ja.bill.lawDuplicate });
			return { ok: false, status: 400, errors };
		}
	}
	if (!checked.ok && checked.errors.laws) return invalid();

	if (kind === 'enact') {
		// 制定に法令の番号や版は付かない（作り変えた値）
		if (v.law || v.base) return invalid();
		if (!errors.fields.newTitle) {
			const [same] = await db.select({ id: laws.id }).from(laws).where(eq(laws.title, v.newTitle.trim()));
			const [taken] = same ? [] : await db.select({ id: ifLaws.id }).from(ifLaws).where(eq(ifLaws.title, v.newTitle.trim()));
			if (same || taken) errors.fields.newTitle = ja.bill.lawTitleExists;
		}
	}

	// 基にする版の条（法令の位置ごと）。制定の新法は空の法令から書くのでない
	const bases: (LawBase | null)[] = [];
	const targets = [kind === 'enact' ? null : { law: v.law, base: v.base }, ...v.extras.map((x) => ({ law: x.law, base: x.base }))];
	for (const [seq, t] of targets.entries()) {
		if (!t) {
			bases.push(null);
			continue;
		}
		// 基にした版の印：形が違うか、その法令の版でなければ作り変えた値。いまの IF世界の最新でなければ、開いたあとで変わった
		const token = parseBaseToken(t.base);
		if (!token) return invalid();
		const [base] = await db.select({ id: lawRevisions.id, lawId: lawRevisions.lawId }).from(lawRevisions).where(eq(lawRevisions.id, token.revisionId));
		if (!base || base.lawId !== t.law) return invalid();
		const head = await ifHeadOf(db, t.law);
		if (head.repealed) {
			if (seq === 0) return { ok: false, status: 400, errors: { fields: { laws: ja.ifLaw.lawRepealed }, rows: {}, message: ja.ifLaw.lawRepealed } };
			lawError(seq, { law: ja.ifLaw.lawRepealed });
			return { ok: false, status: 400, errors: { ...errors, message: ja.ifLaw.lawRepealed } };
		}
		// 誤りを直してから開き直すのは手間なので、版が変わったことを先に知らせる
		if (head.branchRevisionId !== base.id || head.seq !== token.ifSeq) return { ok: false, status: 409, errors: { fields: {}, rows: {}, message: ja.bill.baseChanged } };
		bases.push({ lawId: t.law, baseId: base.id, baseIfSeq: token.ifSeq, articles: await ifArticles(db, t.law, base.id, token.ifSeq) });
	}
	const actionOf = (seq: number): FormKind => (seq === 0 ? kind : (v.extras[seq - 1].action as FormKind));

	// 変更点（法令ごとに分け、行の通し番号を覚えておく）
	const changes: BillChange[][] = targets.map(() => []);
	const indexes: number[][] = targets.map(() => []);
	let rowsOk = true;
	for (const [i, row] of v.rows.entries()) {
		if (!(CHANGE_OPS as readonly string[]).includes(row.op)) return invalid();
		const seq = seqs[i] as number;
		const enactRow = seq === 0 && kind === 'enact';
		// 制定の条はすべて足す形で、番号は画面が順に付ける。ほかの形は作り変えた値
		if (enactRow && (row.op !== 'add' || branchNum(row.num) === null)) return invalid();
		const op = row.op as ChangeOp;
		const caption = row.caption.trim() || null;
		const byNum = new Map((bases[seq]?.articles ?? []).map((a) => [a.num, a]));
		let num: string | null;
		let provisionId: number | null = null;
		if (op === 'add') {
			num = branchNum(row.num);
			if (num === null) {
				errors.rows[i] = { field: 'num', message: ja.bill.changeErrors.addNotBranch };
				rowsOk = false;
				continue;
			}
		} else {
			const target = byNum.get(row.target);
			if (!target) {
				errors.rows[i] = { field: 'target', message: ja.bill.changeErrors.unknownProvision };
				rowsOk = false;
				continue;
			}
			num = target.num;
			provisionId = target.id;
		}
		indexes[seq].push(i);
		if (op === 'delete') {
			changes[seq].push({ op, num, provisionId, caption: null, paragraphs: null });
			continue;
		}
		const body = parseArticleBody(row.body);
		if (!body.ok) {
			errors.rows[i] = { field: 'body', message: ja.bill.bodyErrorAt(body.line, ja.bill.bodyErrors[body.error]) };
			rowsOk = false;
			continue;
		}
		changes[seq].push({ op, num, provisionId, caption, paragraphs: body.paragraphs });
	}
	if (rowsOk && !errors.changes) {
		for (const [seq, law] of changes.entries()) {
			const action = actionOf(seq);
			const articles = bases[seq]?.articles ?? null;
			const baseArticles: BaseArticle[] | null = articles && articles.map((a) => ({ id: a.id, num: a.num, caption: a.caption, paragraphs: a.paragraphs }));
			const result = checkChanges(action, baseArticles, law);
			if (result.ok) continue;
			// 制定には番号の欄がないので、番号の誤りは作り変えた値
			if (action === 'enact' && result.errors.some(({ error }) => CHANGE_FIELD[error] === 'num' || CHANGE_FIELD[error] === 'target')) return invalid();
			for (const { index, error } of result.errors) {
				const at = indexes[seq][index];
				// 第1条（目的）の誤りは第1条の見出しのそばに出す
				if (index < 0 && error === 'enactPurpose' && law.length) errors.rows[indexes[seq][0]] = { field: 'caption', message: ja.bill.changeErrors[error] };
				else if (index < 0 && seq === 0) errors.changes = ja.bill.changeErrors[error];
				else if (index < 0) lawError(seq, { changes: ja.bill.changeErrors[error] });
				else errors.rows[at] = { field: CHANGE_FIELD[error], message: ja.bill.changeErrors[error] };
			}
		}
	}

	if (Object.keys(errors.fields).length || Object.keys(errors.rows).length || errors.changes || errors.laws || !checked.ok) {
		return { ok: false, status: 400, errors };
	}
	const value = checked.value;
	return {
		ok: true,
		input: {
			kind,
			committeeId: FIRST_COMMITTEE,
			title: value.title,
			affected: value.affected,
			sideEffects: value.sideEffects,
			summary: value.summary,
			supplementary: value.supplementary,
			laws: targets.map((_, seq) => {
				const base = bases[seq];
				return base
					? { action: actionOf(seq), lawId: base.lawId, baseRevisionId: base.baseId, baseIfSeq: base.baseIfSeq, newTitle: null, changes: changes[seq] }
					: { action: 'enact' as const, lawId: null, baseRevisionId: null, baseIfSeq: 0, newTitle: value.newTitle, changes: changes[seq] };
			}),
			solutionIds: value.solutionIds
		}
	};
}
