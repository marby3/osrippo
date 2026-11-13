// 会期のリプレイ（Issue #170。決めたことは Issue #198 の「#170」の節）。ログインは要らない。
// 読むときに組み、会期の終わりの処理（結果の記録と反映）は呼ばない。形が違うか、まだ終わっていない会期は 404
import { error } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { sessionFromKey } from '#lib/domain/toukei.ts';
import { FIRST_COMMITTEE } from '#lib/server/bill-form.ts';
import { committeeNameOf } from '#lib/server/chairs.ts';
import { nowOf, sessionsAt } from '#lib/server/client.ts';
import { replayOf } from '#lib/server/kaiki.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const db = drizzle(env.DB);
	const now = nowOf(event);
	const session = sessionFromKey(event.params.kaiki, sessionsAt(now).minutes);
	if (!session || now < session.endsAt) error(404);
	const [committee, replay] = await Promise.all([committeeNameOf(db, FIRST_COMMITTEE), replayOf(db, session)]);
	return { session: session.key, committee, ...replay };
};
