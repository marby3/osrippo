// 法律の一覧と検索（Issue #163）。読む行は SQL で絞って LIMIT までにする（2,100本を全部読んで JS で絞らない）
import { and, asc, count, desc, eq, gte, isNotNull, sql, type SQL } from 'drizzle-orm';
import { billLaws, bills, committeeLaws, committees, laws, readableArticles, readableLaws } from '../db/schema';
import { articleBodyText } from '../domain/law/display';
import { KANA_ROWS, LAW_LIST_PAGE, lawNumDisplay, lawNumWord, toHiragana, unchangedYears, type LawListQuery } from '../domain/law-list';
import { matchPhrase, type Word } from '../domain/search';
import type { Db } from './law';
import { searchProvisions } from './search';

/** 一覧の1行（いま遊べる法律のカードも同じ形） */
export type LawRow = {
	id: string;
	title: string;
	/** 略称（e-Gov の略称の1つ目）。検索はすべての略称で引く */
	abbrev: string | null;
	/** 算用数字にした法令番号 */
	lawNum: string;
	/** 最後の改正の施行日。制定から改正がなければ null */
	lastAmended: string | null;
	/** 「N年変わっていない」の年数。タグを出さないなら null */
	unchangedYears: number | null;
	playable: boolean;
	ifChanged: boolean;
	deliberating: boolean;
	/** 法令のページへのリンクにするか（遊べる法律か、本文を入れ終えて条のある読める法律） */
	linked: boolean;
};

/**
 * 遊べる法律の「IF世界で変更あり」「審議中の法案あり」。どちらも遊べる法律（laws）にしかない。
 * before は lapsedBefore の値で、これより後に発議した法案が審議中（法案の一覧の「審議中」のタブと同じ分け方）
 */
async function playableFlags(db: Db, before: number) {
	const changed = await db
		.select({ id: laws.id })
		.from(laws)
		.where(sql`EXISTS (SELECT 1 FROM if_revisions r WHERE r.law_id = ${laws.id})`);
	const deliberating = await db
		.selectDistinct({ id: billLaws.lawId })
		.from(bills)
		.innerJoin(billLaws, and(eq(billLaws.billId, bills.id), eq(billLaws.rev, bills.rev)))
		.where(and(eq(bills.status, 'proposed'), gte(bills.proposedAt, before), isNotNull(billLaws.lawId)));
	return { changed: new Set(changed.map((r) => r.id)), deliberating: new Set(deliberating.map((r) => r.id)) };
}

type Flags = Awaited<ReturnType<typeof playableFlags>>;

function toRow(
	r: { id: string; title: string; abbrevs: string[] | null; lawNum: string; lastAmended: string | null; playable: boolean; ready: boolean },
	flags: Flags,
	today: string
): LawRow {
	return {
		id: r.id,
		title: r.title,
		abbrev: r.abbrevs?.[0] ?? null,
		lawNum: lawNumDisplay(r.lawNum),
		lastAmended: r.lastAmended,
		unchangedYears: unchangedYears(r.lastAmended, today),
		playable: r.playable,
		ifChanged: flags.changed.has(r.id),
		deliberating: flags.deliberating.has(r.id),
		linked: r.playable || r.ready
	};
}

/** いま遊べる法律：委員会ごとの対象法令。略称と最後の改正日は読める法律の表から（取り込む前なら出さない） */
export async function playableLawGroups(db: Db, before: number, today: string) {
	const rows = await db
		.select({
			committeeId: committees.id,
			committee: committees.name,
			id: laws.id,
			title: laws.title,
			lawNum: laws.lawNum,
			abbrevs: readableLaws.abbrevs,
			lastAmended: readableLaws.lastAmended
		})
		.from(committeeLaws)
		.innerJoin(committees, eq(committees.id, committeeLaws.committeeId))
		.innerJoin(laws, eq(laws.id, committeeLaws.lawId))
		.leftJoin(readableLaws, eq(readableLaws.id, laws.id))
		.orderBy(asc(committees.id), asc(laws.id));
	if (!rows.length) return [];
	const flags = await playableFlags(db, before);
	const groups: { committee: string; laws: LawRow[] }[] = [];
	let last: number | null = null;
	for (const r of rows) {
		if (r.committeeId !== last) groups.push({ committee: r.committee, laws: [] });
		last = r.committeeId;
		groups[groups.length - 1].laws.push(toRow({ ...r, lastAmended: r.lastAmended ?? null, playable: true, ready: false }, flags, today));
	}
	return groups;
}

/** 分野と本数（本数の多い順）。分野のない法律は数えない */
export async function lawCategories(db: Db) {
	const rows = await db
		.select({ name: readableLaws.category, count: count() })
		.from(readableLaws)
		.where(isNotNull(readableLaws.category))
		.groupBy(readableLaws.category);
	return rows
		.map((r) => ({ name: r.name as string, count: r.count }))
		.sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** LIKE の言葉：% と _ と \ を文字として扱う */
const contains = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** 法令名・読み・略称・法令番号のどれかに、言葉が入っている（言葉はそろえたあとのもの） */
function nameMatches(w: Word): SQL {
	return sql`(${readableLaws.title} LIKE ${contains(w.norm)} ESCAPE '\\'
		OR ${readableLaws.titleKana} LIKE ${contains(toHiragana(w.norm))} ESCAPE '\\'
		OR ${readableLaws.abbrevs} LIKE ${contains(w.norm)} ESCAPE '\\'
		OR ${readableLaws.lawNum} LIKE ${contains(lawNumWord(w.norm))} ESCAPE '\\')`;
}

/** 本文を入れ終えて、条のある読める法律か（ページへのリンクにする。条文の検索にも出す） */
const ready = sql<number>`${readableLaws.syncedUpdated} IS NOT NULL AND ${readableLaws.articleCount} >= 1`;

/** 遊べる法律でない（遊べる法律の名前と条は laws の側の表から引く。読める法律の表に行が残っていても引かない） */
const notPlayable = sql`${readableLaws.id} NOT IN (SELECT id FROM ${laws})`;

/** 変わった日：最後の改正日、なければ公布日（索引 readable_laws_changed と同じ式） */
const changedOn = sql`coalesce(${readableLaws.lastAmended}, ${readableLaws.promulgationDate})`;

/** 読める法律（遊べる法律も含む）の1ページ。words は q を parseQuery で分けた言葉 */
export async function listReadableLaws(db: Db, query: LawListQuery, words: Word[], before: number, today: string) {
	const conditions: SQL[] = words.map(nameMatches);
	if (query.bunya) conditions.push(eq(readableLaws.category, query.bunya));
	const kana = KANA_ROWS.find((r) => r.key === query.kana);
	if (kana) conditions.push(sql`${readableLaws.titleKana} >= ${kana.from} AND ${readableLaws.titleKana} < ${kana.to}`);
	const order =
		query.narabi === 'kaisei'
			? [desc(changedOn), asc(readableLaws.id)]
			: query.narabi === 'nagai'
				? [asc(changedOn), asc(readableLaws.id)]
				: [asc(readableLaws.titleKana), asc(readableLaws.id)];
	const rows = await db
		.select({
			id: readableLaws.id,
			title: readableLaws.title,
			abbrevs: readableLaws.abbrevs,
			lawNum: readableLaws.lawNum,
			lastAmended: readableLaws.lastAmended,
			playable: sql<number>`${laws.id} IS NOT NULL`,
			ready: ready
		})
		.from(readableLaws)
		.leftJoin(laws, eq(laws.id, readableLaws.id))
		.where(conditions.length ? and(...conditions) : undefined)
		.orderBy(...order)
		.limit(LAW_LIST_PAGE + 1)
		.offset((query.page - 1) * LAW_LIST_PAGE);
	const shown = rows.slice(0, LAW_LIST_PAGE);
	const flags = shown.some((r) => r.playable) ? await playableFlags(db, before) : { changed: new Set<string>(), deliberating: new Set<string>() };
	return {
		rows: shown.map((r) => toRow({ ...r, playable: Boolean(r.playable), ready: Boolean(r.ready) }, flags, today)),
		hasNext: rows.length > LAW_LIST_PAGE
	};
}

/** 遊べる法律のうち、読める法律の表の法令名・読み・略称・法令番号で当たるもの（全体の検索。Issue #208。/hourei と同じ規則） */
export async function searchPlayableLawNames(db: Db, words: Word[]) {
	const rows = await db
		.select({ id: laws.id })
		.from(readableLaws)
		.innerJoin(laws, eq(laws.id, readableLaws.id))
		.where(and(...words.map(nameMatches)));
	return rows.map((r) => r.id);
}

/**
 * 全体の検索（/kensaku。Issue #208）の法令の欄の、読める法律。遊べる法律は外す（全体の検索は laws の題名で別に引く）。
 * 五十音の順に offset から limit 件と、当たった本数。LIKE は索引で引けないので表を一回りする。数えるのと1ページを読むのを1回にする
 */
export async function searchReadableLawNames(db: Db, words: Word[], limit: number, offset: number) {
	const rows = await db
		.select({ id: readableLaws.id, title: readableLaws.title, ready, total: sql<number>`count(*) OVER ()` })
		.from(readableLaws)
		.where(and(notPlayable, ...words.map(nameMatches)))
		.orderBy(asc(readableLaws.titleKana), asc(readableLaws.id))
		// 遊べる法律でページが埋まっても、本数を知るために1行は読む
		.limit(Math.max(limit, 1))
		.offset(offset);
	return { total: rows[0]?.total ?? 0, rows: rows.slice(0, limit).map((r) => ({ id: r.id, title: r.title, linked: Boolean(r.ready) })) };
}

/** 条文から探したときに出す条の数 */
export const ARTICLE_HITS = 50;
/** 読める法律の条文を探せる言葉の長さ（trigram の索引だけなので3文字から。ユーザーの決定4） */
const READABLE_MIN = 3;

/** 読める法律の条文を探さない（言葉に短いものがある）か */
export const readableTooShort = (words: Word[]) => words.some((w) => [...w.norm].length < READABLE_MIN);

/** 読める法律の条文の索引で当たる rowid を、upTo の4倍まで（外の条件で落ちる行のぶんの余裕） */
const windowSize = (upTo: number) => upTo * 4;
function readableWindow(words: Word[], upTo: number) {
	const match = words.map((w) => matchPhrase(w.norm)).join(' AND ');
	return sql`SELECT rowid FROM readable_search WHERE readable_search MATCH ${match} ORDER BY rowid LIMIT ${windowSize(upTo)}`;
}

/**
 * 読める法律の条文で、言葉がすべて当たる条（readable_articles と readable_laws を結んだ行の条件）。
 * 遊べる法律の条（版のある表から引く）と、本文を入れ終えていない法律・条のない法律の条は外す。
 * FTS5 は rowid の順に返すので、LIMIT を内側に置くと当たった条を全部は読まずに止まる。外の条件で落ちる行のぶん、upTo の4倍まで読む
 */
function readableArticleHits(words: Word[], upTo: number) {
	return and(
		sql`${readableArticles.id} IN (${readableWindow(words, upTo)})`,
		notPlayable,
		ready
	);
}

/** 読める法律の条文で当たる条を、rowid の順に offset から limit 件。upTo は当たる条の何件目までを見るか（数えたときとそろえる） */
export async function searchReadableArticles(db: Db, words: Word[], limit: number, offset = 0, upTo = offset + limit) {
	const found = await db
		.select({
			lawId: readableArticles.lawId,
			lawTitle: readableLaws.title,
			num: readableArticles.num,
			label: readableArticles.label,
			caption: readableArticles.caption,
			paragraphs: readableArticles.paragraphs
		})
		.from(readableArticles)
		.innerJoin(readableLaws, eq(readableLaws.id, readableArticles.lawId))
		.where(readableArticleHits(words, upTo))
		.orderBy(asc(readableArticles.id))
		.limit(limit)
		.offset(offset);
	return found.map((a) => ({
		lawId: a.lawId,
		lawTitle: a.lawTitle,
		num: a.num,
		label: a.label,
		text: [a.caption, articleBodyText(a.paragraphs)].filter(Boolean).join('　')
	}));
}

/**
 * 読める法律の条文で当たる条の数。cap 件まで数えて止める。
 * windowFull は、索引の窓（cap の4倍）を使い切ったこと。そのときは窓の外にも当たる条があるかもしれないので、数は正確でない
 */
export async function countReadableArticles(db: Db, words: Word[], cap: number) {
	const hits = db
		.select({ id: readableArticles.id })
		.from(readableArticles)
		.innerJoin(readableLaws, eq(readableLaws.id, readableArticles.lawId))
		.where(readableArticleHits(words, cap))
		.limit(cap)
		.as('hits');
	const [counted] = await db
		.select({ n: count(), scanned: sql<number>`(SELECT count(*) FROM (${readableWindow(words, cap)}))` })
		.from(hits);
	return { n: counted?.n ?? 0, windowFull: (counted?.scanned ?? 0) >= windowSize(cap) };
}

/**
 * 条文から探す：遊べる法律はいまの全文検索（2文字は bigram）、読める法律は readable_search（3文字以上の言葉だけ）。
 * 遊べる法律の条を先に、あわせて ARTICLE_HITS まで。readableShort は、言葉が短くて読める法律の条文を探さなかったこと
 */
export async function searchLawArticles(db: Db, words: Word[]) {
	const playable = await searchProvisions(db, words);
	const rows = playable.rows.slice(0, ARTICLE_HITS).map((r) => ({
		lawId: r.lawId,
		lawTitle: r.lawTitle,
		label: r.position,
		href: r.href,
		text: r.text
	}));
	let more = playable.total > rows.length;
	const readableShort = readableTooShort(words);
	const room = ARTICLE_HITS - rows.length;
	if (!readableShort) {
		const found = await searchReadableArticles(db, words, room + 1);
		if (found.length > room) more = true;
		for (const a of found.slice(0, room)) rows.push({ lawId: a.lawId, lawTitle: a.lawTitle, label: a.label, href: `/hourei/${a.lawId}#jo-${a.num}`, text: a.text });
	}
	return { rows, more, readableShort };
}
