// 議員ダッシュボード（Issue #149、設計書 docs/spec/149.md）。有効な議員の認証がある人だけ。ほかの人には 404
import { error } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { billProgress, lapsedBefore } from '#lib/domain/bills.ts';
import { parsePage, type ListQuery } from '#lib/domain/issues.ts';
import { billTabCounts, listBills } from '#lib/server/bills.ts';
import { nowOf, sessionsAt } from '#lib/server/client.ts';
import { GIIN_PAGE_SIZE, listedIssueCount, originIssues, passedBills, passedCount, topSolutions } from '#lib/server/giin.ts';
import { listIssues } from '#lib/server/issues.ts';
import { legislatorNameAt } from '#lib/server/verifications.ts';
import type { PageServerLoad } from './$types';

export type GiinTab = 'kadai' | 'houan' | 'kaketsu';

/** URL の形を確かめる。既定（課題のタブ、立場を超えた支持順、すべて、1ページ目）は引数なしの URL だけ。違えば null（404） */
function parseQuery(params: URLSearchParams) {
	const tab = params.get('tab');
	const sort = params.get('sort');
	const kaiketsu = params.get('kaiketsu');
	const houan = params.get('houan');
	const page = parsePage(params.get('page'));
	if (tab !== null && tab !== 'houan' && tab !== 'kaketsu') return null;
	if (page === null) return null;
	// 並びと絞り込みは課題のタブだけ。絞り込みは1つだけ
	if (tab !== null && (sort !== null || kaiketsu !== null || houan !== null)) return null;
	if (sort !== null && sort !== 'support' && sort !== 'new') return null;
	if (kaiketsu !== null && kaiketsu !== 'ari') return null;
	if (houan !== null && (houan !== 'ari' || kaiketsu !== null)) return null;
	return { tab: (tab ?? 'kadai') as GiinTab, sort: sort ?? 'bridge', solutions: kaiketsu === 'ari', bills: houan === 'ari', page } as const;
}

export const load: PageServerLoad = async (event) => {
	const user = event.locals.user;
	if (!user) error(404);
	const db = drizzle(env.DB);
	const now = nowOf(event);
	const name = await legislatorNameAt(db, user.id, now);
	if (name === null) error(404);
	const query = parseQuery(event.url.searchParams);
	if (query === null) error(404);
	const { previous, minutes } = sessionsAt(now);
	const before = lapsedBefore(previous);
	const [issueCount, billCounts, passed] = await Promise.all([listedIssueCount(db), billTabCounts(db, before), passedCount(db)]);
	const counts = { kadai: issueCount, houan: billCounts.shingi, kaketsu: passed };
	const base = { name, query, counts };

	if (query.tab === 'kadai') {
		const q: ListQuery = { sort: query.sort, topic: 'all', solutions: query.solutions, bills: query.bills, q: '', page: query.page };
		const { rows, hasNext, bridgeFallback } = await listIssues(db, q, null, now, [], previous, GIIN_PAGE_SIZE, true);
		if (query.page > 1 && rows.length === 0) error(404);
		const top = await topSolutions(db, rows.map((r) => r.id));
		return {
			...base,
			issues: rows.map((r) => ({ id: r.id, title: r.title, supports: r.supports, ratio: r.ratio ?? null, solution: top.get(r.id) ?? null })),
			bills: [],
			passed: [],
			hasNext,
			bridgeFallback
		};
	}
	if (query.tab === 'houan') {
		const { rows, hasNext } = await listBills(db, 'shingi', query.page, before, GIIN_PAGE_SIZE);
		if (query.page > 1 && rows.length === 0) error(404);
		const origin = await originIssues(db, rows.map((r) => r.id));
		return {
			...base,
			issues: [],
			bills: rows.map((r) => ({ id: r.id, title: r.title, progress: billProgress(r, now, minutes), origin: origin.get(r.id) ?? null })),
			passed: [],
			hasNext,
			bridgeFallback: false
		};
	}
	const { rows, hasNext } = await passedBills(db, query.page);
	if (query.page > 1 && rows.length === 0) error(404);
	return { ...base, issues: [], bills: [], passed: rows, hasNext, bridgeFallback: false };
};
