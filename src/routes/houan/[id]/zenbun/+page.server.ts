// 条文全体のなかで変更点を見る（Issue #54）。ログインは要らず、法案のページを見られる人はだれでも見られる
import { error } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { parseIssueId } from '#lib/domain/issues.ts';
import { billById, billFullText } from '#lib/server/bills.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
	const id = parseIssueId(params.id);
	const db = drizzle(env.DB);
	const bill = id === null ? undefined : await billById(db, id);
	if (!bill) error(404);
	// 法令の位置（0 から）。ないときは1本目。形が違うか法令の数を超えたら 404
	const raw = url.searchParams.get('hourei');
	const seq = raw === null ? 0 : /^(0|[1-9]\d?)$/.test(raw) ? Number(raw) : -1;
	const full = seq < 0 ? undefined : await billFullText(db, bill, seq);
	if (!full) error(404);
	return { bill: { id: bill.id, title: bill.title }, supplementary: bill.supplementary, ...full };
};
