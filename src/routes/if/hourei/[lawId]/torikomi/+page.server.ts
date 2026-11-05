// 現実の改正の取り込みの一覧（Issue #95。設計書 docs/spec/95.md 決めたこと5）。ログインは要らない。現実の法令だけで、新法にはない
import { error } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { parsePage } from '#lib/domain/issues.ts';
import { importPage } from '#lib/server/if-world.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
	const page = parsePage(url.searchParams.get('page'));
	if (page === null) error(404);
	const data = await importPage(drizzle(env.DB), params.lawId, page);
	if (!data || (page > 1 && data.imports.length === 0)) error(404);
	return { ...data, page };
};
