import { error, json } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { lawIdOfAlias } from '#lib/domain/law/aliases.ts';
import { articleCard } from '#lib/server/law-refs.ts';
import type { RequestHandler } from './$types';

/** 条のカード（Issue #165）：本文の「特商法9条」のリンクを押したときに読む。条の見出しと最初の項だけ。ない条は 404 */
export const GET: RequestHandler = async ({ params }) => {
	const card = await articleCard(drizzle(env.DB), lawIdOfAlias(params.lawId) ?? params.lawId, params.num);
	if (!card) error(404);
	return json(card);
};
