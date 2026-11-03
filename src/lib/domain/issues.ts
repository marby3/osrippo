// 課題の入力と一覧の URL の判定（設計書 docs/spec/25.md 決めたこと1・2・4）

export const ISSUE_MAX = { title: 60, affected: 60, example: 400 } as const;
export const PAGE_SIZE = 50;

export type IssueField = 'title' | 'affected' | 'example' | 'topic';
export type IssueError = 'required' | 'tooLong' | 'newline' | 'control' | 'invalid';
export type IssueInput = { title: string; affected: string; example: string; topicId: number | null };
export type IssueValidation =
	| { ok: true; value: IssueInput }
	| { ok: false; errors: Partial<Record<IssueField, IssueError>> };

/** 制御文字と、文字の向きを変える書式文字（一覧で表示を偽れないように）。ゼロ幅接合子などは絵文字に使うので許す */
const CONTROL = /[\p{Cc}‪-‮⁦-⁩]/u;
const CONTROL_EXCEPT_NEWLINE = /(?!\n)[\p{Cc}‪-‮⁦-⁩]/u;

/** 前後の空白を除き、改行を \n にそろえて確かめる（通報と運営のメモでも使う） */
export function checkText(raw: string | null | undefined, max: number, multiline: boolean): [string, IssueError | null] {
	const text = (raw ?? '').replace(/\r\n?/g, '\n').trim();
	if (!text) return [text, 'required'];
	if (!multiline && text.includes('\n')) return [text, 'newline'];
	if ((multiline ? CONTROL_EXCEPT_NEWLINE : CONTROL).test(text)) return [text, 'control'];
	// 文字数はコードポイントで数える
	if ([...text].length > max) return [text, 'tooLong'];
	return [text, null];
}

/** 課題を書くフォームの値を確かめる。topic は今回のお題の id か "none" */
export function validateIssue(
	raw: Record<IssueField, string | null | undefined>,
	currentTopicId: number | null
): IssueValidation {
	const errors: Partial<Record<IssueField, IssueError>> = {};
	const [title, titleError] = checkText(raw.title, ISSUE_MAX.title, false);
	const [affected, affectedError] = checkText(raw.affected, ISSUE_MAX.affected, false);
	const [example, exampleError] = checkText(raw.example, ISSUE_MAX.example, true);
	if (titleError) errors.title = titleError;
	if (affectedError) errors.affected = affectedError;
	if (exampleError) errors.example = exampleError;

	let topicId: number | null = null;
	if (currentTopicId !== null && raw.topic === String(currentTopicId)) topicId = currentTopicId;
	else if (raw.topic !== 'none') errors.topic = 'invalid';

	if (Object.keys(errors).length) return { ok: false, errors };
	return { ok: true, value: { title, affected, example, topicId } };
}

/** URL の課題の番号。形が違えば null（404） */
export function parseIssueId(raw: string): number | null {
	return /^[1-9]\d{0,9}$/.test(raw) ? Number(raw) : null;
}

export const SORTS = ['support', 'new', 'rising'] as const;
export type Sort = (typeof SORTS)[number];
/** 絞り込みは「すべて」「今回のお題」「解決策あり」から1つ（設計書 docs/spec/34.md 決めたこと8） */
export type ListQuery = { sort: Sort; topic: 'all' | 'current'; solutions: boolean; page: number };

/** 一覧の検索文字列。形が違えば null（404）。1ページ目は page なしの URL だけ */
export function parseListQuery(params: URLSearchParams): ListQuery | null {
	const sort = params.get('sort');
	const topic = params.get('topic');
	const page = params.get('page');
	const kaiketsu = params.get('kaiketsu');
	if (sort !== null && sort !== 'new' && sort !== 'rising') return null;
	if (topic !== null && topic !== 'current') return null;
	if (kaiketsu !== null && (kaiketsu !== 'ari' || topic !== null)) return null;
	const pageNumber = parsePage(page);
	if (pageNumber === null) return null;
	return { sort: sort ?? 'support', topic: topic ?? 'all', solutions: kaiketsu === 'ari', page: pageNumber };
}

/** ページの番号：なければ1。2〜9999 の整数（先頭の0なし）だけ。1ページ目は page なしの URL だけなので、page=1 は形が違う */
export function parsePage(raw: string | null): number | null {
	if (raw === null) return 1;
	return /^(?:[2-9]|[1-9]\d{1,3})$/.test(raw) ? Number(raw) : null;
}

/** 一覧の URL（既定の値は書かない） */
export function listHref({ sort, topic, solutions, page }: ListQuery): string {
	const params = new URLSearchParams();
	if (sort !== 'support') params.set('sort', sort);
	if (topic !== 'all') params.set('topic', topic);
	if (solutions) params.set('kaiketsu', 'ari');
	if (page > 1) params.set('page', String(page));
	const search = params.toString();
	return search ? `/kadai?${search}` : '/kadai';
}
