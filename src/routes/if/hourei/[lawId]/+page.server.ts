// IF世界の法令ページ（Issue #72。SpLaw・PcLaw）。ログインは要らない。現実の法令か制定の新法だけ
import { error, redirect } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { lawIdOfAlias } from '#lib/domain/law/aliases.ts';
import { ifLawPage } from '#lib/server/if-world.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
	// 別名は本来の URL へ送る（Issue #164。条だけのページの「この条の URL」が別名で出るため）
	const canonical = lawIdOfAlias(params.lawId);
	if (canonical) redirect(301, `/if/hourei/${canonical}${url.search}`);
	const page = await ifLawPage(drizzle(env.DB), params.lawId);
	if (!page) error(404);
	return { ...page, ifBand: true as const };
};
