// 法案を書く画面のフォームを受ける（Issue #46）。値を読み、validateBill・parseArticleBody・checkChanges と
// 基にした版の比べ（docs/spec/45.md 決めたこと7）を通して、createDraft・saveDraft に渡す形にする
import { and, eq, inArray } from 'drizzle-orm';
import { ja } from '../copy/ja';
import { committeeLaws, issues, laws, lawRevisions, solutions } from '../db/schema';
import {
	BILL_MAX,
	CHANGE_OPS,
	checkChanges,
	parseArticleBody,
	validateBill,
	type BaseArticle,
	type BillChange,
	type BillError,
	type BillField,
	type ChangeError,
	type ChangeOp
} from '../domain/bills';
import { LISTED, SOLUTION_SHOWN } from '../domain/reports';
import { articlesOfRevision, currentRevision, type Db } from './law';
import type { DraftInput } from './bills';

/** 第1委員会（消費者保護）。委員会が1つのあいだは、法案はすべてここに出す */
export const FIRST_COMMITTEE = 1;
/** 書く画面で選べる種類 */
export const FORM_KINDS = ['amend', 'repeal', 'enact'] as const;
export type FormKind = (typeof FORM_KINDS)[number];

export type RowValues = { op: string; target: string; num: string; caption: string; body: string };
export type BillFormValues = {
	kind: string;
	title: string;
	/** 制定の法令名 */
	newTitle: string;
	law: string;
	base: string;
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
	/** 変更点全体の誤り（変える条がない、廃止に条がある、多すぎる） */
	changes?: string;
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
		rows.push({ op: s(`op.${i}`), target: s(`target.${i}`), num: s(`num.${i}`), caption: s(`caption.${i}`), body: s(`body.${i}`) });
	}
	return {
		kind: s('kind'),
		title: s('title'),
		newTitle: s('newTitle'),
		law: s('law'),
		base: s('base'),
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

/** フォームの値を確かめる。形の違う値（作り変えたもの）も、欄の誤りと同じく 400 で返す */
export async function checkBillForm(db: Db, v: BillFormValues): Promise<Checked> {
	const errors: BillFormErrors = { fields: {}, rows: {} };
	const invalid = (): Checked => ({ ok: false, status: 400, errors: { ...errors, message: ja.bill.formInvalid } });
	const kind = (FORM_KINDS as readonly string[]).includes(v.kind) ? (v.kind as FormKind) : null;

	const lawIds = (await db.select({ id: committeeLaws.lawId }).from(committeeLaws).where(eq(committeeLaws.committeeId, FIRST_COMMITTEE))).map(
		(r) => r.id
	);
	const ids = v.solutions.filter((s) => /^[1-9]\d{0,9}$/.test(s)).map(Number);
	// 数が上限を超えていれば問い合わせない（validateBill が誤りにする。D1 は1文に100個までしか値を結び付けられない）。
	// 引用できるのは、一覧に出る課題の表示中の解決策
	const visible =
		ids.length && v.solutions.length <= BILL_MAX.solutions
			? await db
					.select({ id: solutions.id, issueId: solutions.issueId })
					.from(solutions)
					.innerJoin(issues, eq(issues.id, solutions.issueId))
					.where(and(inArray(solutions.id, ids), inArray(solutions.status, SOLUTION_SHOWN), inArray(issues.status, LISTED)))
			: [];
	const checked = validateBill(
		{
			kind,
			title: v.title,
			affected: v.affected,
			sideEffects: v.sideEffects,
			summary: v.summary,
			supplementary: v.supplementary,
			laws: kind ? [kind === 'enact' ? { action: kind, lawId: null, newTitle: v.newTitle } : { action: kind, lawId: v.law, newTitle: null }] : [],
			changeCount: v.rows.length,
			solutionIds: v.solutions
		},
		{ committeeLawIds: lawIds, visibleSolutionIds: new Set(visible.map((r) => r.id)) }
	);
	if (!checked.ok) {
		for (const [field, e] of Object.entries(checked.errors) as [BillField, BillError][]) errors.fields[field] = fieldMessage(e);
		if (checked.errors.changes) errors.changes = errors.fields.changes;
	}
	// ほかの解決策を足せるのは同じ課題から（Issue #46 基準1）
	if (new Set(visible.map((r) => r.issueId)).size > 1) errors.fields.solutions = ja.bill.solutionsOneIssue;
	if (!kind) return invalid();

	// 基にする版の条。制定は空の法令から書くのでない
	let articles: Awaited<ReturnType<typeof articlesOfRevision>> | null = null;
	let baseId: string | null = null;
	if (kind === 'enact') {
		// 制定に法令の番号や版は付かない（作り変えた値）
		if (v.law || v.base) return invalid();
		if (!errors.fields.newTitle) {
			const [same] = await db.select({ id: laws.id }).from(laws).where(eq(laws.title, v.newTitle.trim()));
			if (same) errors.fields.newTitle = ja.bill.lawTitleExists;
		}
	} else {
		// 選ばれていない法令は「選んでください」。それ以外の対象外の法令は作り変えた値
		if (!v.law) {
			errors.fields.laws = ja.bill.lawRequired;
			return { ok: false, status: 400, errors };
		}
		if (!checked.ok && checked.errors.laws) return invalid();
		// 基にした版：その法令の版でなければ作り変えた値。いまの版でなければ、開いたあとで新しい版が施行された
		const [base] = await db.select({ id: lawRevisions.id, lawId: lawRevisions.lawId }).from(lawRevisions).where(eq(lawRevisions.id, v.base));
		if (!base || base.lawId !== v.law) return invalid();
		// 誤りを直してから開き直すのは手間なので、版が変わったことを先に知らせる
		const current = await currentRevision(db, v.law);
		if (current?.id !== base.id) return { ok: false, status: 409, errors: { fields: {}, rows: {}, message: ja.bill.baseChanged } };
		baseId = base.id;
		articles = await articlesOfRevision(db, base.id);
	}

	// 変更点
	const byNum = new Map((articles ?? []).map((a) => [a.num, a]));
	const changes: BillChange[] = [];
	let rowsOk = true;
	for (const [i, row] of v.rows.entries()) {
		if (!(CHANGE_OPS as readonly string[]).includes(row.op)) return invalid();
		// 制定の条はすべて足す形で、番号は画面が順に付ける。ほかの形は作り変えた値
		if (kind === 'enact' && (row.op !== 'add' || branchNum(row.num) === null)) return invalid();
		const op = row.op as ChangeOp;
		const caption = row.caption.trim() || null;
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
		if (op === 'delete') {
			changes.push({ op, num, provisionId, caption: null, paragraphs: null });
			continue;
		}
		const body = parseArticleBody(row.body);
		if (!body.ok) {
			errors.rows[i] = { field: 'body', message: ja.bill.bodyErrorAt(body.line, ja.bill.bodyErrors[body.error]) };
			rowsOk = false;
			continue;
		}
		changes.push({ op, num, provisionId, caption, paragraphs: body.paragraphs });
	}
	if (rowsOk && !errors.changes) {
		const baseArticles: BaseArticle[] | null = articles && articles.map((a) => ({ id: a.id, num: a.num, caption: a.caption, paragraphs: a.paragraphs }));
		const result = checkChanges(kind, baseArticles, changes);
		if (!result.ok) {
			// 制定には番号の欄がないので、番号の誤りは作り変えた値
			if (kind === 'enact' && result.errors.some(({ error }) => CHANGE_FIELD[error] === 'num' || CHANGE_FIELD[error] === 'target')) return invalid();
			for (const { index, error } of result.errors) {
				// 第1条（目的）の誤りは第1条の見出しのそばに出す
				if (index < 0 && error === 'enactPurpose' && changes.length) errors.rows[0] = { field: 'caption', message: ja.bill.changeErrors[error] };
				else if (index < 0) errors.changes = ja.bill.changeErrors[error];
				else errors.rows[index] = { field: CHANGE_FIELD[error], message: ja.bill.changeErrors[error] };
			}
		}
	}

	if (Object.keys(errors.fields).length || Object.keys(errors.rows).length || errors.changes || !checked.ok) {
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
			laws: [
				kind === 'enact'
					? { action: kind, lawId: null, baseRevisionId: null, newTitle: value.newTitle, changes }
					: { action: kind, lawId: v.law, baseRevisionId: baseId, newTitle: null, changes }
			],
			solutionIds: value.solutionIds
		}
	};
}
