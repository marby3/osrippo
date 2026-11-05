// 書く画面が取りに行く条文：委員会の対象の法令の、IF世界の最新の条（Issue #46・#72）。公開の情報なのでログインは要らない
import { error, json } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { FIRST_COMMITTEE } from '#lib/server/bill-form.ts';
import { draftArticles } from '#lib/server/bills.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const data = await draftArticles(drizzle(env.DB), FIRST_COMMITTEE, url.searchParams.get('law') ?? '');
	if (!data) error(404);
	// 架空の条文を含むので検索に載せない（docs/spec/72.md の F）
	return json(data, { headers: { 'X-Robots-Tag': 'noindex' } });
};
