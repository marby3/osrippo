// 書く画面が取りに行く条文：委員会の対象の法令の、いま施行されている版の条（Issue #46）。法令の本文は公開なのでログインは要らない
import { error, json } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { FIRST_COMMITTEE } from '#lib/server/bill-form.ts';
import { draftArticles } from '#lib/server/bills.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const data = await draftArticles(drizzle(env.DB), FIRST_COMMITTEE, url.searchParams.get('law') ?? '');
	if (!data) error(404);
	return json(data);
};
