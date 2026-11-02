import { error } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { lawPage, todayInTokyo } from '#lib/server/law.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const page = await lawPage(drizzle(env.DB), params.lawId);
	if (!page) error(404);
	return { ...page, today: todayInTokyo() };
};
