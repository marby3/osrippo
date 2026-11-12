// 公開ミラーの書き出しの入口（Issue #155）：確定した会期の IF世界の法令。確定していない会期と形の違う会期は 404
import { error, json } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { nowOf } from '#lib/server/client.ts';
import { mirrorSession, tokenMatches } from '#lib/server/mirror.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	if (!tokenMatches(event.request.headers.get('authorization'), env.MIRROR_TOKEN)) error(401);
	const snapshot = await mirrorSession(drizzle(env.DB), event.params.session, nowOf(event));
	if (!snapshot) error(404);
	return json(snapshot, { headers: { 'cache-control': 'no-store' } });
};
