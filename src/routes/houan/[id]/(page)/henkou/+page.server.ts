// 法案の変更点のタブ。文字の比べはここだけで行う（概要のタブでは走らせない）
import { error } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { parseIssueId } from '#lib/domain/issues.ts';
import { billById, billChangeViews } from '#lib/server/bills.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const id = parseIssueId(params.id);
	const db = drizzle(env.DB);
	const bill = id === null ? undefined : await billById(db, id);
	if (!bill) error(404);
	return { changes: await billChangeViews(db, bill) };
};
