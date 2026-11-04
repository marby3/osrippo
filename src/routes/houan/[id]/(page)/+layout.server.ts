// 法案のページ（概要と変更点のタブ）。下書きもだれでも見られる（Issue #46）
import { error } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { parseIssueId } from '#lib/domain/issues.ts';
import { billById, billView } from '#lib/server/bills.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ params, locals }) => {
	const id = parseIssueId(params.id);
	const db = drizzle(env.DB);
	// 作りかけ（rev = 0）は billById が返さない
	const bill = id === null ? undefined : await billById(db, id);
	if (!bill) error(404);
	return {
		bill: await billView(db, bill),
		canEdit: locals.user?.id === bill.userId && bill.status === 'draft'
	};
};
