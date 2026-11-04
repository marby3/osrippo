// 法案を書く画面のフォームを受ける（Issue #46）。値を読み、validateBill・parseArticleBody・checkChanges と
// 基にした版の比べ（docs/spec/45.md 決めたこと7）を通して、createDraft・saveDraft に渡す形にする
import { and, eq, inArray } from 'drizzle-orm';
import { ja } from '../copy/ja';
import { committeeLaws, lawRevisions, solutions } from '../db/schema';
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
import { articlesOfRevision, currentRevision, type Db } from './law';
import type { DraftInput } from './bills';

/** 第1委員会（消費者保護）。委員会が1つのあいだは、法案はすべてここに出す */
export const FIRST_COMMITTEE = 1;
/** v0.3 の書く画面で選べる種類。制定は #47 */
export const FORM_KINDS = ['amend', 'repeal'] as const;
export type FormKind = (typeof FORM_KINDS)[number];

export type RowValues = { op: string; target: string; num: string; caption: string; body: string };
export type BillFormValues = {
	kind: string;
	title: string;
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
	const visible = ids.length
		? await db
				.select({ id: solutions.id })
				.from(solutions)
				.where(and(inArray(solutions.id, ids), inArray(solutions.status, ['visible', 'restored'])))
		: [];
	const checked = validateBill(
		{
			kind,
			title: v.title,
			affected: v.affected,
			sideEffects: v.sideEffects,
			summary: v.summary,
			supplementary: v.supplementary,
			laws: kind ? [{ action: kind, lawId: v.law, newTitle: null }] : [],
			changeCount: v.rows.length,
			solutionIds: v.solutions
		},
		{ committeeLawIds: lawIds, visibleSolutionIds: new Set(visible.map((r) => r.id)) }
	);
	if (!checked.ok) {
		for (const [field, e] of Object.entries(checked.errors) as [BillField, BillError][]) errors.fields[field] = fieldMessage(e);
		if (checked.errors.changes) errors.changes = errors.fields.changes;
	}
	// 選ばれていない法令は「選んでください」。それ以外の対象外の法令・ない種類は作り変えた値
	if (!v.law) errors.fields.laws = ja.bill.lawRequired;
	else if (checked.ok === false && checked.errors.laws) return invalid();
	if (!kind) return invalid();
	if (!v.law) return { ok: false, status: 400, errors };

	// 基にした版：その法令の版でなければ作り変えた値。いまの版でなければ、開いたあとで新しい版が施行された
	const [base] = await db.select({ id: lawRevisions.id, lawId: lawRevisions.lawId }).from(lawRevisions).where(eq(lawRevisions.id, v.base));
	if (!base || base.lawId !== v.law) return invalid();
	const current = await currentRevision(db, v.law);
	const baseChanged = current?.id !== base.id;

	// 変更点
	const articles = await articlesOfRevision(db, base.id);
	const byNum = new Map(articles.map((a) => [a.num, a]));
	const changes: BillChange[] = [];
	let rowsOk = true;
	for (const [i, row] of v.rows.entries()) {
		if (!(CHANGE_OPS as readonly string[]).includes(row.op)) return invalid();
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
		const base: BaseArticle[] = articles.map((a) => ({ id: a.id, num: a.num, caption: a.caption, paragraphs: a.paragraphs }));
		const result = checkChanges(kind, base, changes);
		if (!result.ok) {
			for (const { index, error } of result.errors) {
				if (index < 0) errors.changes = ja.bill.changeErrors[error];
				else errors.rows[index] = { field: CHANGE_FIELD[error], message: ja.bill.changeErrors[error] };
			}
		}
	}

	if (Object.keys(errors.fields).length || Object.keys(errors.rows).length || errors.changes || !checked.ok) {
		return { ok: false, status: 400, errors };
	}
	if (baseChanged) return { ok: false, status: 409, errors: { ...errors, message: ja.bill.baseChanged } };
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
			laws: [{ action: kind, lawId: v.law, baseRevisionId: base.id, newTitle: null, changes }],
			solutionIds: value.solutionIds
		}
	};
}
