// 読める法律の取り込み（Issue #162、設計書 docs/spec/162.md 決めたこと3）。e-Gov の一覧の法律と憲法を、最新の版だけ入れる。
// 自宅サーバーの入口（scripts/sync-readable.ts）と db:reset から読むので、cloudflare:workers、import.meta.env、#lib に頼らない
import { eq, inArray, max } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { laws, readableArticles, readableLawNames, readableLaws } from '../db/schema';
import type { Heading, Paragraph } from '../domain/law';
import { readableSearchText } from '../domain/search';
import { isRetryable, readLawBody, readLawList, type FetchJson, type ListedLaw } from '../egov/client';
import type { BatchDb } from './law';

// 全文検索の表は FTS5 で、スキーマでは管理しない（drizzle/0033_readable_laws.sql）。D1 の batch は値つきの db.run を受け付けないので、builder で書くためにここで形だけ宣言する。
// contentless_delete = 1 なので、消すときは rowid の DELETE だけでよい
const searchInsert = sqliteTable('readable_search', { rowid: integer('rowid').notNull(), text: text('text').notNull() });

// D1 の上限（https://developers.cloudflare.com/d1/platform/limits/）：1文の値は100個、1文100KB、1回の batch に1000文。余裕をとって下回る値にする
const MAX_PARAMS = 100;
const MAX_BYTES = 90_000;
const STATEMENTS_PER_BATCH = 500;
/** 1条の paragraphs がこれを超える法令は失敗にする（設計書 決めたこと3の5）。入れる文に見出しなども乗るので、1文の上限より余裕をとる */
const ARTICLE_MAX_BYTES = 80_000;
/** e-Gov への負荷（決めたこと3の8）：1件ずつ1秒あけ、やり直しは5秒あけて1回 */
const PACE = 1_000;
const RETRY_WAIT = 5_000;

export type Sleep = (ms: number) => Promise<void>;
export const sleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const bytes = (s: string) => new TextEncoder().encode(s).length;

/** 値の数と大きさで分ける。size は1行の大きさ（バイト） */
function chunks<T>(rows: T[], perRow: number, size: (row: T) => number): T[][] {
	const result: T[][] = [];
	let chunk: T[] = [];
	let total = 0;
	for (const row of rows) {
		const s = size(row);
		if (chunk.length && ((chunk.length + 1) * perRow > MAX_PARAMS || total + s > MAX_BYTES)) {
			result.push(chunk);
			chunk = [];
			total = 0;
		}
		chunk.push(row);
		total += s;
	}
	if (chunk.length) result.push(chunk);
	return result;
}

const groups = <T>(rows: T[], size: number) => Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size));

/** 1件ずつ間をあけて読み、429・5xx・タイムアウトは1回だけやり直す */
function paced(fetchJson: FetchJson, wait: Sleep): FetchJson {
	let first = true;
	return async (url) => {
		if (!first) await wait(PACE);
		first = false;
		try {
			return await fetchJson(url);
		} catch (e) {
			if (!isRetryable(e)) throw e;
			await wait(RETRY_WAIT);
			return fetchJson(url);
		}
	};
}

type SearchRow = { rowid: number; text: string };
const searchRowBytes = (r: SearchRow) => bytes(r.text) + 16;

/** 条の行から、索引の text を作り直す（入れたときと同じ文字列） */
const searchRowOf = (a: { id: number; caption: string; paragraphs: Paragraph[] }): SearchRow => ({ rowid: a.id, text: readableSearchText(a.caption, a.paragraphs) });

/** その法令の索引と条を消す文（索引が先。索引は rowid だけで消す。contentless_delete = 1） */
function deleteArticles(db: BatchDb, lawId: string): BatchItem<'sqlite'>[] {
	const ids = db.select({ id: readableArticles.id }).from(readableArticles).where(eq(readableArticles.lawId, lawId));
	return [db.delete(searchInsert).where(inArray(searchInsert.rowid, ids)), db.delete(readableArticles).where(eq(readableArticles.lawId, lawId))];
}

/** その法令の名前の行（正式名と略称）を書き直す文。本文の「特商法9条」を名前で引くため（Issue #165） */
function writeNames(db: BatchDb, law: ListedLaw): BatchItem<'sqlite'>[] {
	const names = [...new Set([law.title, ...law.abbrevs])];
	return [
		db.delete(readableLawNames).where(eq(readableLawNames.lawId, law.lawId)),
		...chunks(names, 2, (n) => bytes(n) + 64).map((part) => db.insert(readableLawNames).values(part.map((name) => ({ name, lawId: law.lawId }))))
	];
}

/** 法令名などの欄（synced_updated・article_count・headings 以外） */
const fieldsOf = (law: ListedLaw) => ({
	title: law.title,
	titleKana: law.titleKana,
	lawNum: law.lawNum,
	lawType: law.lawType,
	category: law.category,
	abbrevs: law.abbrevs,
	promulgationDate: law.promulgationDate,
	lastAmended: law.lastAmended,
	revisionId: law.revisionId,
	updated: law.updated
});

type Stored = typeof readableLaws.$inferSelect;
const sameFields = (stored: Stored, law: ListedLaw) => {
	const fields = fieldsOf(law);
	return (Object.keys(fields) as (keyof typeof fields)[]).every((k) => JSON.stringify(stored[k]) === JSON.stringify(fields[k]));
};

/** 本文を入れ替える（決めたこと3の5）。途中で失敗しても synced_updated は NULL のままなので、次の回に読み直す */
async function replaceArticles(db: BatchDb, law: ListedLaw, body: { articles: { num: string; label: string; caption: string; paragraphs: Paragraph[] }[]; headings: Heading[] }) {
	const rows = body.articles.map((a, seq) => ({ seq, num: a.num, label: a.label, caption: a.caption, paragraphs: a.paragraphs, size: bytes(JSON.stringify(a.paragraphs)) }));
	const tooLarge = rows.find((r) => r.size > ARTICLE_MAX_BYTES);
	if (tooLarge) throw new Error(`${law.lawId}：第${tooLarge.num}条の本文が ${ARTICLE_MAX_BYTES} バイトを超えています`);

	await db.batch([
		db.update(readableLaws).set({ syncedUpdated: null, articleCount: null }).where(eq(readableLaws.id, law.lawId)),
		...deleteArticles(db, law.lawId)
	] as never);

	// id は表の最大値 + 1 から順に振る（索引の rowid を入れる前に決める）
	const [{ top }] = await db.select({ top: max(readableArticles.id) }).from(readableArticles);
	const first = (top ?? 0) + 1;
	const articles = rows.map(({ size, ...r }, i) => ({ id: first + i, lawId: law.lawId, ...r, size }));
	// 条と、その条の索引の行は同じ batch に入れる（索引だけ残ると、次の 'delete' と合わなくなる）
	for (const group of groups(articles, 1_000)) {
		const statements: BatchItem<'sqlite'>[] = [
			...chunks(group, 7, (a) => a.size + bytes(a.caption + a.label + a.num) + 64).map((part) => db.insert(readableArticles).values(part.map(({ size, ...a }) => a))),
			...chunks(group.map(searchRowOf), 2, searchRowBytes).map((part) => db.insert(searchInsert).values(part))
		];
		for (const batch of groups(statements, STATEMENTS_PER_BATCH)) await db.batch(batch as never);
	}

	await db
		.update(readableLaws)
		.set({ syncedUpdated: law.updated, articleCount: articles.length, headings: body.headings, revisionId: law.revisionId })
		.where(eq(readableLaws.id, law.lawId));
}

export type ReadableSyncResult = {
	/** 一覧を読めなかったか、形が違ったときの理由。このときは何も書いていない */
	listError: string | null;
	/** 失敗した法令 */
	failed: string[];
	/** 本文を読んだ法令 */
	read: string[];
	/** 本則の条がない法令（ページは出さない。docs/readable-laws.md に載せる） */
	empty: string[];
	/** 消した法令（一覧から消えた） */
	removed: string[];
};

/** 読める法律を取り込む。fetchJson は e-Gov の JSON を読む関数、wait は待つ関数（テストは待たない） */
export async function syncReadable(db: BatchDb, fetchJson: FetchJson, wait: Sleep): Promise<ReadableSyncResult> {
	const result: ReadableSyncResult = { listError: null, failed: [], read: [], empty: [], removed: [] };
	const egov = paced(fetchJson, wait);

	// 1. 一覧を全部読む（全ページと2つの種類が、そろって形を通ったときだけ次へ進む）
	let listed: ListedLaw[];
	try {
		listed = [...(await readLawList(egov, 'Act')), ...(await readLawList(egov, 'Constitution'))];
	} catch (e) {
		console.error('一覧を読めませんでした', e);
		result.listError = e instanceof Error ? e.message : String(e);
		return result;
	}
	// 未施行の版しかない法律は入れない
	const current = new Map(listed.filter((l) => l.currentRevisionStatus === 'CurrentEnforced').map((l) => [l.lawId, l]));

	// 2. 保存している行と比べる
	const playable = new Set((await db.select({ id: laws.id }).from(laws)).map((l) => l.id));
	const stored = new Map((await db.select().from(readableLaws)).map((r) => [r.id, r]));
	const toWrite: BatchItem<'sqlite'>[] = [];
	const toRead: ListedLaw[] = [];
	for (const law of current.values()) {
		const row = stored.get(law.lawId);
		const isPlayable = playable.has(law.lawId);
		// 3. 欄を書く。遊べる法律は本文を読まないので、欄がそろった時点で済み
		const fields = { ...fieldsOf(law), ...(isPlayable ? { syncedUpdated: law.updated } : {}) };
		// 名前の行は法令の行のあと（外部キー）。欄が変わったときだけ書き直す
		if (!row) toWrite.push(db.insert(readableLaws).values({ id: law.lawId, ...fields }), ...writeNames(db, law));
		else if (!sameFields(row, law) || (isPlayable && row.syncedUpdated !== law.updated)) toWrite.push(db.update(readableLaws).set(fields).where(eq(readableLaws.id, law.lawId)), ...writeNames(db, law));
		if (!isPlayable && (!row || row.syncedUpdated !== law.updated || row.articleCount === null)) toRead.push(law);
	}
	for (const batch of groups(toWrite, STATEMENTS_PER_BATCH)) await db.batch(batch as never);

	// 4・5. 読み直す法令ごとに本文を読み、入れ替える。1つの失敗でほかを止めない
	for (const law of toRead) {
		try {
			const body = await readLawBody(egov, law.revisionId);
			await replaceArticles(db, law, body);
			result.read.push(law.lawId);
			if (!body.articles.length) result.empty.push(law.lawId);
		} catch (e) {
			console.error(`${law.lawId} の取り込みに失敗しました`, e);
			result.failed.push(law.lawId);
		}
	}

	// 6. 一覧にない法令を消す（索引 → 条 → 名前 → 法令の行）
	for (const id of stored.keys()) {
		if (current.has(id)) continue;
		try {
			await db.batch([...deleteArticles(db, id), db.delete(readableLawNames).where(eq(readableLawNames.lawId, id)), db.delete(readableLaws).where(eq(readableLaws.id, id))] as never);
			result.removed.push(id);
		} catch (e) {
			console.error(`${id} を消せませんでした`, e);
			result.failed.push(id);
		}
	}
	return result;
}
