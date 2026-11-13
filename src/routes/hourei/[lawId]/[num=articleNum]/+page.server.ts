// 条だけのページ（Issue #164。案 SpLawArticle・PcLawArticle）。遊べる法律と読める法律の両方。ない条は 404
import { error, redirect } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { aliasOfLaw, lawIdOfAlias } from '#lib/domain/law/aliases.ts';
import { articleAround } from '#lib/domain/law/display.ts';
import { lawPage, readableLawPage, todayInTokyo } from '#lib/server/law.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
	// 別名で来たら本来の URL へ送る（検索に二重に載せない）
	const canonical = lawIdOfAlias(params.lawId);
	if (canonical) redirect(301, `/hourei/${canonical}/${params.num}${url.search}`);
	// 共有する URL は、別名のある法律なら別名の形（読みやすい。開くと本来の URL へ送る）
	const shareUrl = `${url.origin}/hourei/${aliasOfLaw(params.lawId) ?? params.lawId}/${params.num}`;

	const db = drizzle(env.DB);
	// 遊べる法律が先。なければ読める法律（法令のページと同じ）
	const page = await lawPage(db, params.lawId);
	if (page) {
		const around = articleAround(page.articles, params.num);
		if (!around) error(404);
		const { band: _, ...article } = around.article;
		return { kind: 'playable' as const, law: page.law, asOf: page.current.enforcementDate, today: todayInTokyo(), ...around, article, shareUrl };
	}
	const readable = await readableLawPage(db, params.lawId);
	if (readable) {
		const around = articleAround(readable.articles, params.num);
		if (!around) error(404);
		const { band: _, ...article } = around.article;
		return { kind: 'readable' as const, law: readable.law, ...around, article, shareUrl };
	}
	error(404);
};
