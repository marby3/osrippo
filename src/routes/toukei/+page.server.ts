// 統計ページ（Issue #154、設計書 docs/spec/154.md）。ログインは要らない。結果は作らない（C）。人数と「考えが変わった」の数は返さない
import { error } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { sessionFromKey } from '#lib/domain/toukei.ts';
import { nowOf, sessionsAt } from '#lib/server/client.ts';
import { bridgeRanking, changedRanking, finishedSessions, resultView, sessionResults } from '#lib/server/toukei.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const db = drizzle(env.DB);
	const now = nowOf(event);
	const minutes = sessionsAt(now).minutes;
	const sessions = await finishedSessions(db, now, minutes);
	const raw = event.url.searchParams.get('kaiki');
	let session = sessions[0] ?? null;
	if (raw !== null) {
		// 形が違うか、まだ終わっていない会期は 404。終わっていれば結果の行がなくても出す（D）
		const chosen = sessionFromKey(raw, minutes);
		if (!chosen || now < chosen.endsAt) error(404);
		session = chosen;
	}
	const options = sessions.map((s) => s.key);
	// IF世界の法案の結果を出すので、帯を付ける（設計書 A）
	const ifBand = true as const;
	if (session === null) return { options, session: null, ifBand };
	const rows = await sessionResults(db, session);
	return {
		options,
		ifBand,
		session: session.key,
		results: rows.map(resultView),
		bridges: await bridgeRanking(db, rows, minutes, now),
		rethink: await changedRanking(db, session)
	};
};
