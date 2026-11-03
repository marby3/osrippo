// 似た課題を返す（設計書 docs/spec/30.md 決めたこと1）。下書きのタイトルを URL に入れないよう POST で受ける
import { error, json } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { ISSUE_MAX } from '#lib/domain/issues.ts';
import { findSimilar } from '#lib/server/reports.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) error(401);
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		error(400);
	}
	const q = typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as { q?: unknown }).q : undefined;
	if (typeof q !== 'string' || [...q].length > ISSUE_MAX.title) error(400);
	if (!q.trim()) return json({ issues: [] });
	return json({ issues: await findSimilar(drizzle(env.DB), q) });
};
