// 法案の一覧（Issue #48）。下書きもだれでも見られる
import { error } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { parseBillTab } from '#lib/domain/bills.ts';
import { parsePage } from '#lib/domain/issues.ts';
import { billTabCounts, listBills } from '#lib/server/bills.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const tab = parseBillTab(url.searchParams.get('tab'));
	const page = parsePage(url.searchParams.get('page'));
	if (tab === null || page === null) error(404);
	const db = drizzle(env.DB);
	const { rows, hasNext } = await listBills(db, tab, page);
	// 2ページ目以降で法案がなければ 404（課題の一覧と同じ）
	if (page > 1 && rows.length === 0) error(404);
	return { tab, page, rows, hasNext, counts: await billTabCounts(db) };
};
