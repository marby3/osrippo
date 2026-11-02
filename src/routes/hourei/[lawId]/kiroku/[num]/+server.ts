import { error, json } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { articleHistory } from '#lib/server/law.ts';
import type { RequestHandler } from './$types';

/** 条ごとの変わった記録（法令ページで「変わった記録を見る」を押したときに読む） */
export const GET: RequestHandler = async ({ params }) => {
	const history = await articleHistory(drizzle(env.DB), params.lawId, params.num);
	if (!history) error(404);
	return json(history);
};
