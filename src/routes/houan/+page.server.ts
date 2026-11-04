// 法案の一覧（Issue #48）。下書きもだれでも見られる
import { error } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { billProgress, lapsedBefore, parseBillTab } from '#lib/domain/bills.ts';
import { parsePage } from '#lib/domain/issues.ts';
import { billTabCounts, listBills } from '#lib/server/bills.ts';
import { nowOf, sessionsAt } from '#lib/server/client.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const { url } = event;
	const tab = parseBillTab(url.searchParams.get('tab'));
	const page = parsePage(url.searchParams.get('page'));
	if (tab === null || page === null) error(404);
	const db = drizzle(env.DB);
	const now = nowOf(event);
	const { previous, minutes } = sessionsAt(now);
	const before = lapsedBefore(previous);
	const { rows, hasNext } = await listBills(db, tab, page, before);
	// 2ページ目以降で法案がなければ 404（課題の一覧と同じ）
	if (page > 1 && rows.length === 0) error(404);
	return {
		tab,
		page,
		rows: rows.map(({ id, kind, title, supports, status, proposedAt }) => ({ id, kind, title, supports, progress: billProgress({ status, proposedAt }, now, minutes) })),
		hasNext,
		counts: await billTabCounts(db, before)
	};
};
