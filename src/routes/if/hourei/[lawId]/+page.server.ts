// IF世界の法令ページ（Issue #72。SpLaw・PcLaw）。ログインは要らない。現実の法令か制定の新法だけ
import { error } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { ifLawPage } from '#lib/server/if-world.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const page = await ifLawPage(drizzle(env.DB), params.lawId);
	if (!page) error(404);
	return { ...page, ifBand: true as const };
};
