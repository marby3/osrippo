// 本文の「特商法9条」を条へのリンクにする（Issue #165）。見つけ方は domain/law/refs.ts。
// 読む行を少なくする：本文から抜き出した名前の候補だけを、名前の表（readable_law_names。索引あり）と遊べる法律の題名で引く。
// 条があるかは、引けた法律と条の番号だけを確かめる。1ページの本文はまとめて引く（名前で1回、条で1回）
import { and, asc, eq, gt, isNotNull, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { alias, type SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { laws, lawRevisions, provisions, provisionVersions, readableArticles, readableLawNames, readableLaws } from '../db/schema';
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

async function findLawRefs(db: Db, texts: string[]): Promise<LawRefIndex | undefined> {
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
	const exists = new Set(found.map((f) => `${f.lawId}/${f.num}`));
	const articles = targets.map((t) => `${t.lawId}/${t.num}`).filter((key) => exists.has(key));
	if (!articles.length) return undefined;
	// ページに渡すのは、本文で使う名前だけ
	const used = new Set(names);
	return { names: Object.fromEntries(Object.entries(table).filter(([name]) => used.has(name))), articles };
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
