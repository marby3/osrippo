// e-Gov 法令 API v2 に触るのはここだけ（設計書 docs/spec/74.md 決めたこと1・2）。応答は信頼の境界なので、使う値だけ形を確かめる。
// 自宅サーバーの同期から読むので、cloudflare:workers、import.meta.env、#lib に頼らない
import { parseHeadings, parseLaw, type EgovNode } from '../domain/law';
import { revisionStatus, type EgovRevision } from './revision';

const API = 'https://laws.e-gov.go.jp/api/2';
const TIMEOUT = 30_000;

/** URL を受けて JSON を返す。本物は fetchEgovJson、テストはテストデータ */
export type FetchJson = (url: string) => Promise<unknown>;

/** e-Gov が成功以外の状態で応えた */
export class EgovStatusError extends Error {
	constructor(
		readonly status: number,
		url: string
	) {
		super(`e-Gov の応答が ${status} でした：${url}`);
	}
}

export const fetchEgovJson: FetchJson = async (url) => {
	const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT), headers: { accept: 'application/json' } });
	if (!response.ok) throw new EgovStatusError(response.status, url);
	return response.json();
};

/** やり直してよい失敗：429・5xx・タイムアウト（設計書 docs/spec/162.md 決めたこと3の8） */
export const isRetryable = (e: unknown) =>
	(e instanceof EgovStatusError && (e.status === 429 || e.status >= 500)) || (e instanceof Error && e.name === 'TimeoutError');

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
	// 欠けた応答で保存済みの読みを消さないよう、NULL と書かれているときだけ NULL にする
	if (row.law_title_kana !== null && typeof row.law_title_kana !== 'string') throw wrong('題名の読みの形が違います');
	if (typeof row.amendment_enforcement_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.amendment_enforcement_date)) throw wrong('施行日の形が違います');
	if (!revisionStatus(row.current_revision_status)) throw wrong(`知らない状態 ${String(row.current_revision_status)}`);
	if (row.repeal_status !== 'None') throw wrong(`法令が廃止されています（${String(row.repeal_status)}）`);
	if (!isTextOrNull(row.amendment_law_title) || !isTextOrNull(row.amendment_law_num) || !isTextOrNull(row.amendment_promulgate_date)) throw wrong('改正法の形が違います');
	return {
		law_revision_id: id,
		law_title: row.law_title,
		law_title_kana: row.law_title_kana,
		amendment_enforcement_date: row.amendment_enforcement_date,
		amendment_law_title: (row.amendment_law_title as string | null | undefined) ?? null,
		amendment_law_num: (row.amendment_law_num as string | null | undefined) ?? null,
		amendment_promulgate_date: (row.amendment_promulgate_date as string | null | undefined) ?? null,
		current_revision_status: row.current_revision_status as string
	};
}

/** 版の本文を読み、条と見出しに分ける。別の版の本文、根が違う本文は断る。本則の条がなければ条は空 */
export async function readLawBody(fetchJson: FetchJson, revisionId: string) {
	const body = await fetchJson(`${API}/law_data/${encodeURIComponent(revisionId)}`);
	const wrong = (what: string) => new Error(`${revisionId}：${what}`);
	if (!isObject(body)) throw wrong('本文の形が違います');
	if (!isObject(body.revision_info) || body.revision_info.law_revision_id !== revisionId) throw wrong('別の版の本文が返りました');
	if (!isObject(body.law_full_text) || body.law_full_text.tag !== 'Law') throw wrong('本文の形が違います');
	const text = body.law_full_text as EgovNode;
	return { articles: parseLaw(text), headings: parseHeadings(text) };
}

/** 版の本文を読み、条と見出しに分ける。readLawBody に加えて、条のない本文も断る（全部の条を閉じてしまわないように） */
export async function readLawText(fetchJson: FetchJson, revisionId: string) {
	const body = await readLawBody(fetchJson, revisionId);
	if (!body.articles.length) throw new Error(`${revisionId}：本文に条がありません`);
	return body;
}

/** 法令の一覧の1行（設計書 docs/spec/162.md 決めたこと2）。使う値だけ */
export type ListedLaw = {
	lawId: string;
	lawNum: string;
	lawType: 'Act' | 'Constitution';
	promulgationDate: string;
	revisionId: string;
	title: string;
	titleKana: string | null;
	abbrevs: string[];
	category: string | null;
	updated: string;
	/** 改正法の施行日。改正法がない（制定から改正なし）か、日付が null なら null */
	lastAmended: string | null;
	currentRevisionStatus: string;
};

const LIST_LIMIT = 500;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isNullableText = (v: unknown): v is string | null => v === null || typeof v === 'string';

/** 一覧の1行の形を確かめる。違えば理由を返す */
function checkListedLaw(row: unknown, expected: ListedLaw['lawType']): ListedLaw | string {
	if (!isObject(row) || !isObject(row.law_info) || !isObject(row.revision_info)) return '行の形が違います';
	const law = row.law_info;
	const rev = row.revision_info;
	const id = isText(law.law_id) ? law.law_id : '（law_id なし）';
	const wrong = (what: string) => `${id}：${what}`;
	if (!isText(law.law_id)) return wrong('law_id の形が違います');
	if (!isText(law.law_num)) return wrong('law_num の形が違います');
	// 法律の効力を持つ政令や勅令は「Act,CabinetOrder」のようにカンマでつないで返る。読んだ種類を含んでいれば、その種類として扱う
	if (typeof law.law_type !== 'string' || !law.law_type.split(',').includes(expected)) return wrong('law_type の形が違います');
	if (typeof law.promulgation_date !== 'string' || !DATE.test(law.promulgation_date)) return wrong('promulgation_date の形が違います');
	for (const key of ['law_revision_id', 'law_title', 'updated', 'current_revision_status']) {
		if (!isText(rev[key])) return wrong(`${key} の形が違います`);
	}
	for (const key of ['law_title_kana', 'category', 'abbrev', 'amendment_law_id', 'amendment_enforcement_date']) {
		if (!isNullableText(rev[key])) return wrong(`${key} の形が違います`);
	}
	const enforced = rev.amendment_enforcement_date as string | null;
	if (enforced !== null && !DATE.test(enforced)) return wrong('amendment_enforcement_date の形が違います');
	const abbrev = rev.abbrev as string | null;
	return {
		lawId: law.law_id,
		lawNum: law.law_num,
		lawType: expected,
		promulgationDate: law.promulgation_date,
		revisionId: rev.law_revision_id as string,
		title: rev.law_title as string,
		titleKana: rev.law_title_kana as string | null,
		abbrevs: (abbrev ?? '')
			.split(',')
			.map((a) => a.trim())
			.filter(Boolean),
		category: rev.category as string | null,
		updated: rev.updated as string,
		lastAmended: rev.amendment_law_id ? enforced : null,
		currentRevisionStatus: rev.current_revision_status as string
	};
}

/**
 * 法令の一覧を全部読む（設計書 docs/spec/162.md 決めたこと1・2）。法律は廃止されていないものだけ、憲法は全件。
 * offset を count ずつ進め、total_count に届いたら終わる。1行でも形が違えば一覧全体を断る
 */
export async function readLawList(fetchJson: FetchJson, lawType: ListedLaw['lawType']): Promise<ListedLaw[]> {
	const laws: ListedLaw[] = [];
	const filter = lawType === 'Act' ? 'law_type=Act&repeal_status=None' : 'law_type=Constitution';
	for (let offset = 0; ; ) {
		const body = await fetchJson(`${API}/laws?${filter}&limit=${LIST_LIMIT}&offset=${offset}`);
		const wrong = (what: string) => new Error(`${lawType} の一覧（offset ${offset}）：${what}`);
		if (!isObject(body) || !Array.isArray(body.laws) || !Number.isInteger(body.total_count) || !Number.isInteger(body.count)) throw wrong('一覧の形が違います');
		const total = body.total_count as number;
		const count = body.count as number;
		if (count !== body.laws.length) throw wrong('count と行の数が違います');
		if (offset < total && count === 0) throw wrong('行がありません');
		for (const row of body.laws) {
			const law = checkListedLaw(row, lawType);
			if (typeof law === 'string') throw wrong(law);
			laws.push(law);
		}
		offset += count;
		if (offset >= total) return laws;
	}
}
