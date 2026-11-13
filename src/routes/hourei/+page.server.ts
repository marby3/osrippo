// 法律の一覧と検索（Issue #163。画面の案 SpLaws・PcLaws）。いま遊べる法律をいちばん上に、その下に読める法律を50件ずつ
import { error } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { lapsedBefore } from '#lib/domain/bills.ts';
import { tokyoDate } from '#lib/domain/law/display.ts';
import { parseLawListQuery } from '#lib/domain/law-list.ts';
import { parseQuery, snippet } from '#lib/domain/search.ts';
import { nowOf, sessionsAt } from '#lib/server/client.ts';
import { lawCategories, listReadableLaws, playableLawGroups, searchLawArticles } from '#lib/server/law-list.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	// 並び・五十音・分野・ページの形が違えば 404（信頼の境界）。言葉の形が違うときは 200 で理由を出す（/kadai と同じ）
	const query = parseLawListQuery(event.url.searchParams);
	if (!query) error(404);
	const db = drizzle(env.DB);
	const categories = await lawCategories(db);
	if (query.bunya !== null && !categories.some((c) => c.name === query.bunya)) error(404);

	const now = nowOf(event);
	const today = tokyoDate(now);
	const before = lapsedBefore(sessionsAt(now).previous);
	const search = parseQuery(query.q);
	const searching = search.ok && search.words.length > 0;
	if (!search.ok && query.page > 1) error(404);
	const words = search.ok ? search.words : [];
	const { rows, hasNext } = search.ok ? await listReadableLaws(db, query, words, before, today) : { rows: [], hasNext: false };
	// 2ページ目以降で法律がなければ 404（課題の一覧と同じ）
	if (query.page > 1 && rows.length === 0) error(404);

	// 条文から探すのは、言葉があって1ページ目のときだけ
	const found = searching && query.page === 1 ? await searchLawArticles(db, words) : null;
	const articles = found && { ...found, rows: found.rows.map((r) => ({ ...r, parts: snippet(r.text, words) })) };
	// 本数は、言葉と五十音で絞っていないときだけ出す（分野の本数から足す。数えるために表をもう一度読まない）
	const total =
		searching || !search.ok || query.kana
			? null
			: query.bunya
				? (categories.find((c) => c.name === query.bunya)?.count ?? 0)
				: categories.reduce((n, c) => n + c.count, 0);
	return {
		query,
		// いま遊べる法律は、探していない1ページ目だけ
		playable: !query.q.trim() && query.page === 1 ? await playableLawGroups(db, before, today) : [],
		categories,
		rows,
		hasNext,
		total,
		articles,
		searching,
		searchError: search.ok ? null : search.error
	};
};
