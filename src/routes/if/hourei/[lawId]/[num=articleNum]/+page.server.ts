// IF世界の条だけのページ（Issue #164）。帯と「架空の法令」、noindex を付ける。ない条は 404
import { error, redirect } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { aliasOfLaw, lawIdOfAlias } from '#lib/domain/law/aliases.ts';
import { articleAround } from '#lib/domain/law/display.ts';
import { ifLawPage } from '#lib/server/if-world.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
	const canonical = lawIdOfAlias(params.lawId);
	if (canonical) redirect(301, `/if/hourei/${canonical}/${params.num}${url.search}`);
	const page = await ifLawPage(drizzle(env.DB), params.lawId);
	const around = page && articleAround(page.articles, params.num);
	if (!page || !around) error(404);
	const { band: _, ...article } = around.article;
	return {
		law: page.law,
		real: page.real,
		// 法令のページと同じく、IF世界で廃止・制定した法律にはそのことを出す
		repealedBy: page.repealedBy,
		enactedBy: page.enactedBy,
		...around,
		article,
		shareUrl: `${url.origin}/if/hourei/${aliasOfLaw(params.lawId) ?? params.lawId}/${params.num}`,
		ifBand: true as const
	};
};
