import { error, redirect } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { lawIdOfAlias } from '#lib/domain/law/aliases.ts';
import { lawPage, readableLawPage, todayInTokyo } from '#lib/server/law.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
	// 別名（/hourei/tokushoho）は本来の URL へ送る。検索に二重に載せない（Issue #164）
	const canonical = lawIdOfAlias(params.lawId);
	if (canonical) redirect(301, `/hourei/${canonical}${url.search}`);
	const db = drizzle(env.DB);
	// 遊べる法律が先。なければ読める法律（設計書 docs/spec/162.md 決めたこと4）
	const page = await lawPage(db, params.lawId);
	if (page) return { kind: 'playable' as const, ...page, today: todayInTokyo() };
	const readable = await readableLawPage(db, params.lawId);
	if (readable) return { kind: 'readable' as const, ...readable };
	error(404);
};
