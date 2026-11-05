// e-Gov 法令 API v2 に触るのはここだけ（設計書 docs/spec/74.md 決めたこと1・2）。応答は信頼の境界なので、使う値だけ形を確かめる。
// 自宅サーバーの同期と seed から読むので、cloudflare:workers、import.meta.env、#lib に頼らない
import { parseHeadings, parseLaw, type EgovNode } from '../domain/law';

const API = 'https://laws.e-gov.go.jp/api/2';
const TIMEOUT = 30_000;

/** URL を受けて JSON を返す。本物は fetchEgovJson、テストはテストデータ */
export type FetchJson = (url: string) => Promise<unknown>;

export type EgovRevision = {
	law_revision_id: string;
	law_title: string;
	law_title_kana: string | null;
	amendment_enforcement_date: string;
	amendment_law_title: string | null;
	amendment_law_num: string | null;
	amendment_promulgate_date: string | null;
	current_revision_status: string;
};

/** e-Gov の版の状態と DB の状態の対応。ここにない値は知らない状態 */
export const REVISION_STATUS: Record<string, 'enforced' | 'scheduled'> = {
	CurrentEnforced: 'enforced',
	PreviousEnforced: 'enforced',
	UnEnforced: 'scheduled'
};

export const fetchEgovJson: FetchJson = async (url) => {
	const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT), headers: { accept: 'application/json' } });
	if (!response.ok) throw new Error(`e-Gov の応答が ${response.status} でした：${url}`);
	return response.json();
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isTextOrNull = (v: unknown) => v === null || v === undefined || typeof v === 'string';

/** 版の一覧の生の行。古い順（一覧は新しい順で、同じ施行日の順も一覧の位置で決まるので、日付で並べ直さない） */
export type ListedRevision = Record<string, unknown> & { law_revision_id: string };

export async function readRevisionList(fetchJson: FetchJson, lawId: string): Promise<ListedRevision[]> {
	const body = await fetchJson(`${API}/law_revisions/${encodeURIComponent(lawId)}`);
	if (!isObject(body) || !Array.isArray(body.revisions)) throw new Error(`${lawId}：版の一覧の形が違います`);
	const rows: unknown[] = body.revisions;
	for (const row of rows) {
		if (!isObject(row) || typeof row.law_revision_id !== 'string' || !row.law_revision_id) throw new Error(`${lawId}：版の一覧の行の形が違います`);
	}
	return [...(rows as ListedRevision[])].reverse();
}

/** 使う版の値を確かめる。古い版の値では止めないよう、呼ぶ側が使う版だけ渡す */
export function checkRevision(row: ListedRevision): EgovRevision {
	const id = row.law_revision_id;
	const wrong = (what: string) => new Error(`${id}：${what}`);
	if (typeof row.law_title !== 'string' || !row.law_title) throw wrong('題名の形が違います');
	if (!isTextOrNull(row.law_title_kana)) throw wrong('題名の読みの形が違います');
	if (typeof row.amendment_enforcement_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.amendment_enforcement_date)) throw wrong('施行日の形が違います');
	if (typeof row.current_revision_status !== 'string' || !REVISION_STATUS[row.current_revision_status]) throw wrong(`知らない状態 ${String(row.current_revision_status)}`);
	if (row.repeal_status !== 'None') throw wrong(`法令が廃止されています（${String(row.repeal_status)}）`);
	if (!isTextOrNull(row.amendment_law_title) || !isTextOrNull(row.amendment_law_num) || !isTextOrNull(row.amendment_promulgate_date)) throw wrong('改正法の形が違います');
	return {
		law_revision_id: id,
		law_title: row.law_title,
		law_title_kana: (row.law_title_kana as string | null | undefined) ?? null,
		amendment_enforcement_date: row.amendment_enforcement_date,
		amendment_law_title: (row.amendment_law_title as string | null | undefined) ?? null,
		amendment_law_num: (row.amendment_law_num as string | null | undefined) ?? null,
		amendment_promulgate_date: (row.amendment_promulgate_date as string | null | undefined) ?? null,
		current_revision_status: row.current_revision_status
	};
}

/** 版の本文を読み、条と見出しに分ける。別の版の本文、根が違う本文、条のない本文は断る（全部の条を閉じてしまわないように） */
export async function readLawText(fetchJson: FetchJson, revisionId: string) {
	const body = await fetchJson(`${API}/law_data/${encodeURIComponent(revisionId)}`);
	const wrong = (what: string) => new Error(`${revisionId}：${what}`);
	if (!isObject(body)) throw wrong('本文の形が違います');
	if (!isObject(body.revision_info) || body.revision_info.law_revision_id !== revisionId) throw wrong('別の版の本文が返りました');
	if (!isObject(body.law_full_text) || body.law_full_text.tag !== 'Law') throw wrong('本文の形が違います');
	const text = body.law_full_text as EgovNode;
	const articles = parseLaw(text);
	if (!articles.length) throw wrong('本文に条がありません');
	return { articles, headings: parseHeadings(text) };
}
