// 本文の「特商法9条」を条へのリンクにする（Issue #165）。見つけ方は domain/law/refs.ts。
// 読む行を少なくする：本文から抜き出した名前の候補だけを、名前の表（readable_law_names。索引あり）と遊べる法律の題名で引く。
// 条があるかは、引けた法律と条の番号だけを確かめる。1ページの本文はまとめて引く（名前で1回、条で1回）
// 条のリンク元（Issue #166）：書いたときに、本文が触れている条を law_refs へ入れる（articlesTouchedBy → saveLawRefs）。前からある本文は backfillLawRefs
import { and, asc, eq, gt, isNotNull, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { alias, type SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { issues, LAW_REF_KINDS, lawRefs, laws, lawRevisions, posts, provisions, provisionVersions, readableArticles, readableLawNames, readableLaws, solutions } from '../db/schema';
import { articleBodyText, articleLabel, compareNum, type Paragraph } from '../domain/law';
import { lawNameTable, lawRefNames, lawRefTargets, type LawRefIndex } from '../domain/law/refs';
import { currentRevision, type Db } from './law';

/** 列の値が、JSON の配列のどれかに当たる（値の数が多くても、渡す値は1つ。D1 の1文の値は100個まで） */
const inJson = (column: SQLiteColumn, values: string[]): SQL => sql`${column} IN (SELECT value FROM json_each(${JSON.stringify(values)}))`;

/** 1ページで引く名前の数。これより多い分は引かない（その本文の条はリンクにならない） */
const NAMES_MAX = 2_000;

/**
 * ページの本文から、条へのリンクの表を作る（ページの load が lawRefs として返す）。リンクにするものがなければ undefined。
 * リンクは飾りなので、引けなかったときもページは出す（undefined を返す）
 */
export async function lawRefsFor(db: Db, texts: string[]): Promise<LawRefIndex | undefined> {
	try {
		return await findLawRefs(db, texts);
	} catch (e) {
		console.error('本文の条へのリンクを作れませんでした', e);
		return undefined;
	}
}

/** 本文の名前を引いた結果。table は名前の表、names は本文から抜き出した名前の候補、exists はあると確かめた条（`法令ID/条の番号`） */
type LookedUp = { table: Record<string, string | null>; names: string[]; targets: { lawId: string; num: string }[]; exists: Set<string> };

const keyOf = (t: { lawId: string; num: string }) => `${t.lawId}/${t.num}`;

/** 本文の名前と条を、まとめて引く（名前で1回、条で1回）。リンクにするものがなければ undefined */
async function lookUp(db: Db, texts: string[]): Promise<LookedUp | undefined> {
	const names = lawRefNames(texts).slice(0, NAMES_MAX);
	if (!names.length) return undefined;

	// 正式名と e-Gov の略称（読める法律）と、遊べる法律の題名（読める法律を取り込む前の環境でも引けるように）
	const hits = await db
		.select({ name: readableLawNames.name, lawId: readableLawNames.lawId })
		.from(readableLawNames)
		.where(inJson(readableLawNames.name, names))
		.union(db.select({ name: laws.title, lawId: laws.id }).from(laws).where(inJson(laws.title, names)));
	const table = lawNameTable(hits);
	const targets = lawRefTargets(texts, table);
	if (!targets.length) return undefined;

	const ids = [...new Set(targets.map((t) => t.lawId))];
	const nums = [...new Set(targets.map((t) => t.num))];
	// 遊べる法律は現在の版の条（法令の条・項・号を provisions_law_id でたどり、条の番号で絞る）、読める法律は取り込み済みの条
	const from = alias(lawRevisions, 'from_revision');
	const to = alias(lawRevisions, 'to_revision');
	const currentSeq = sql`(SELECT max(c.seq) FROM law_revisions c WHERE c.law_id = ${provisions.lawId} AND c.branch = 'real' AND c.status = 'enforced')`;
	const found = await db
		.select({ lawId: provisions.lawId, num: provisionVersions.num })
		.from(provisions)
		.innerJoin(provisionVersions, eq(provisionVersions.provisionId, provisions.id))
		.innerJoin(from, eq(from.id, provisionVersions.fromRevisionId))
		.leftJoin(to, eq(to.id, provisionVersions.toRevisionId))
		.where(
			and(
				inJson(provisions.lawId, ids),
				eq(provisions.kind, 'article'),
				inJson(provisionVersions.num, nums),
				eq(from.branch, 'real'),
				lte(from.seq, currentSeq),
				or(isNull(to.id), gt(to.seq, currentSeq))
			)
		)
		.union(
			db
				.select({ lawId: readableArticles.lawId, num: readableArticles.num })
				.from(readableArticles)
				.innerJoin(readableLaws, eq(readableLaws.id, readableArticles.lawId))
				.where(and(inJson(readableArticles.lawId, ids), inJson(readableArticles.num, nums), isNotNull(readableLaws.syncedUpdated)))
		);
	return { table, names, targets, exists: new Set(found.map(keyOf)) };
}

async function findLawRefs(db: Db, texts: string[]): Promise<LawRefIndex | undefined> {
	const found = await lookUp(db, texts);
	if (!found) return undefined;
	const articles = found.targets.map(keyOf).filter((key) => found.exists.has(key));
	if (!articles.length) return undefined;
	// ページに渡すのは、本文で使う名前だけ
	const used = new Set(found.names);
	return { names: Object.fromEntries(Object.entries(found.table).filter(([name]) => used.has(name))), articles };
}

// ---- 条のリンク元（Issue #166）：書いたときに、本文が触れている条を law_refs へ入れる ----

export type LawRefKind = (typeof LAW_REF_KINDS)[number];
type ArticleRef = { lawId: string; num: string };

/** 本文の組ごとに、触れている条（あると確かめたもの）。名前と条は、すべての組の分をまとめて引く */
export async function articlesTouched(db: Db, items: string[][]): Promise<ArticleRef[][]> {
	const found = await lookUp(db, items.flat());
	if (!found) return items.map(() => []);
	return items.map((texts) => lawRefTargets(texts, found.table).filter((t) => found.exists.has(keyOf(t))));
}

/**
 * 書く前に、本文が触れている条を引く（書く人を待たせないよう、引けなかったときは空にして書くのを止めない。リンク元が欠けるだけ）。
 * 入れるのは書いたあと（saveLawRefs）
 */
export async function articlesTouchedBy(db: Db, texts: string[]): Promise<ArticleRef[]> {
	try {
		return (await articlesTouched(db, [texts]))[0];
	} catch (e) {
		console.error('本文が触れている条を引けませんでした', e);
		return [];
	}
}

/** D1 の1文の値は100個まで。law_refs は4列 */
const REF_ROWS_PER_INSERT = 25;

/** 本文が触れている条を law_refs へ入れる。すでにある行は足さない。足した行の数を返す */
export async function saveLawRefs(db: Db, kind: LawRefKind, refId: number, refs: ArticleRef[]): Promise<number> {
	let added = 0;
	for (let i = 0; i < refs.length; i += REF_ROWS_PER_INSERT) {
		const rows = refs.slice(i, i + REF_ROWS_PER_INSERT).map((r) => ({ kind, refId, lawId: r.lawId, num: r.num }));
		added += (await db.insert(lawRefs).values(rows).onConflictDoNothing().returning({ refId: lawRefs.refId })).length;
	}
	return added;
}

/** 一度きりの処理で1回に読む行の数（名前の候補が NAMES_MAX を超えないように小さく） */
const BACKFILL_PAGE = 50;

/**
 * 前からある課題・解決策・質疑・答弁・補足の本文から law_refs を作る（scripts/backfill-law-refs.ts）。状態にかかわらずすべての行を読む（非表示は読むときに外す）。
 * 何度流しても同じ行になる。読んだ行の数と、足した行の数を返す
 */
export async function backfillLawRefs(db: Db) {
	const sources: { kind: LawRefKind; page: (after: number) => Promise<{ id: number; texts: string[] }[]> }[] = [
		{
			kind: 'issue',
			page: async (after) =>
				(
					await db
						.select({ id: issues.id, title: issues.title, affected: issues.affected, example: issues.example })
						.from(issues)
						.where(gt(issues.id, after))
						.orderBy(asc(issues.id))
						.limit(BACKFILL_PAGE)
				).map((r) => ({ id: r.id, texts: issueTexts(r) }))
		},
		{
			kind: 'solution',
			page: async (after) =>
				(await db.select({ id: solutions.id, body: solutions.body }).from(solutions).where(gt(solutions.id, after)).orderBy(asc(solutions.id)).limit(BACKFILL_PAGE)).map(
					(r) => ({ id: r.id, texts: [r.body] })
				)
		},
		{
			kind: 'post',
			page: async (after) =>
				(await db.select({ id: posts.id, body: posts.body }).from(posts).where(gt(posts.id, after)).orderBy(asc(posts.id)).limit(BACKFILL_PAGE)).map((r) => ({
					id: r.id,
					texts: [r.body]
				}))
		}
	];
	const read = { issue: 0, solution: 0, post: 0, added: 0 };
	for (const source of sources) {
		let after = 0;
		for (;;) {
			const rows = await source.page(after);
			if (!rows.length) break;
			const touched = await articlesTouched(
				db,
				rows.map((r) => r.texts)
			);
			for (const [i, row] of rows.entries()) read.added += await saveLawRefs(db, source.kind, row.id, touched[i]);
			read[source.kind] += rows.length;
			after = rows[rows.length - 1].id;
		}
	}
	return read;
}

/** 課題の本文：題名・困っている人・具体例 */
export const issueTexts = (issue: { title: string; affected: string; example: string }) => [issue.title, issue.affected, issue.example];

/** いまの版の、その番号の条の内部ID（遊べる法律）。条がなければ空 */
export async function currentArticleIds(db: Db, lawId: string, num: string): Promise<number[]> {
	const current = await currentRevision(db, lawId);
	if (!current) return [];
	const from = alias(lawRevisions, 'from_revision');
	const to = alias(lawRevisions, 'to_revision');
	const rows = await db
		.select({ id: provisions.id })
		.from(provisionVersions)
		.innerJoin(provisions, eq(provisions.id, provisionVersions.provisionId))
		.innerJoin(from, eq(from.id, provisionVersions.fromRevisionId))
		.leftJoin(to, eq(to.id, provisionVersions.toRevisionId))
		.where(
			and(
				eq(provisions.lawId, lawId),
				eq(provisions.kind, 'article'),
				eq(provisionVersions.num, num),
				eq(from.branch, 'real'),
				lte(from.seq, current.seq),
				or(isNull(to.id), gt(to.seq, current.seq))
			)
		);
	return rows.map((r) => r.id);
}

/** 条のカード（Issue #165。案 SpLawCard・PcLawCard）：条の見出しと最初の項。ない条は undefined */
export type ArticleCard = {
	lawTitle: string;
	label: string;
	caption: string;
	/** 最初の項（号を含む） */
	text: string;
	/** 項の数 */
	paragraphs: number;
	/** 遊べる法律は現在の版の施行日。読める法律は null（最新の版だけ） */
	asOf: string | null;
};

export async function articleCard(db: Db, lawId: string, num: string): Promise<ArticleCard | undefined> {
	const [law] = await db.select({ title: laws.title }).from(laws).where(eq(laws.id, lawId));
	if (law) {
		const current = await currentRevision(db, lawId);
		if (!current) return undefined;
		const from = alias(lawRevisions, 'from_revision');
		const to = alias(lawRevisions, 'to_revision');
		// 現在の版で有効な行（provisionsAt と同じ条件。法令の全部の行は読まない）
		const rows = (where: SQL | undefined) =>
			db
				.select({ id: provisions.id, num: provisionVersions.num, caption: provisionVersions.caption, text: provisionVersions.text })
				.from(provisionVersions)
				.innerJoin(provisions, eq(provisions.id, provisionVersions.provisionId))
				.innerJoin(from, eq(from.id, provisionVersions.fromRevisionId))
				.leftJoin(to, eq(to.id, provisionVersions.toRevisionId))
				.where(and(where, eq(from.branch, 'real'), lte(from.seq, current.seq), or(isNull(to.id), gt(to.seq, current.seq))));
		const [article] = await rows(and(eq(provisions.lawId, lawId), eq(provisions.kind, 'article'), eq(provisionVersions.num, num)));
		if (!article) return undefined;
		const paragraphs = (await rows(and(eq(provisions.parentId, article.id), eq(provisions.kind, 'paragraph')))).sort((a, b) => compareNum(a.num, b.num));
		const first = paragraphs[0];
		const items = first ? (await rows(and(eq(provisions.parentId, first.id), eq(provisions.kind, 'item')))).sort((a, b) => compareNum(a.num, b.num)) : [];
		return {
			lawTitle: law.title,
			label: articleLabel(num),
			caption: article.caption ?? '',
			text: first ? articleBodyText([{ num: first.num, text: first.text ?? '', items: items.map((i) => ({ num: i.num, text: i.text ?? '' })) }]) : '',
			paragraphs: paragraphs.length,
			asOf: current.enforcementDate
		};
	}
	const [row] = await db
		.select({ lawTitle: readableLaws.title, label: readableArticles.label, caption: readableArticles.caption, paragraphs: readableArticles.paragraphs })
		.from(readableArticles)
		.innerJoin(readableLaws, eq(readableLaws.id, readableArticles.lawId))
		.where(and(eq(readableArticles.lawId, lawId), eq(readableArticles.num, num), isNotNull(readableLaws.syncedUpdated)))
		.orderBy(asc(readableArticles.seq))
		.limit(1);
	if (!row) return undefined;
	const paragraphs = row.paragraphs as Paragraph[];
	return {
		lawTitle: row.lawTitle,
		label: row.label,
		caption: row.caption,
		text: paragraphs.length ? articleBodyText(paragraphs.slice(0, 1)) : '',
		paragraphs: paragraphs.length,
		asOf: null
	};
}
