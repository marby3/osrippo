// 公開ミラーの書き出しの入口（Issue #155）：書き出せる会期の一覧。自宅サーバーのバッチだけが MIRROR_TOKEN を付けて読む
import { error, json } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { isSessionKey } from '#lib/domain/mirror.ts';
import { nowOf } from '#lib/server/client.ts';
import { mirrorSessions, tokenMatches, unauthorized } from '#lib/server/mirror.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	// ログインのセッションは見ない。トークンだけで通す
	if (!tokenMatches(event.request.headers.get('authorization'), env.MIRROR_TOKEN)) return unauthorized();
	const after = event.url.searchParams.get('after');
	if (after !== null && !isSessionKey(after)) error(400);
	const sessions = await mirrorSessions(drizzle(env.DB), nowOf(event), after);
	return json({ sessions }, { headers: { 'cache-control': 'no-store' } });
};
