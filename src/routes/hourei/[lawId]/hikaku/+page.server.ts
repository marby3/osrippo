import { error } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { comparePage } from '#lib/server/law.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
	const page = await comparePage(
		drizzle(env.DB),
		params.lawId,
		url.searchParams.get('kaisei')
	);
	if (!page) error(404);
	return page;
};
