// ほかの法案（Issue #70 基準3）。/houan の「審議中」には次の会期に採決する法案も混ざるので、別に持つ
import { error, redirect } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { parsePage } from '#lib/domain/issues.ts';
import { nowOf, sessionsAt } from '#lib/server/client.ts';
import { requireUser } from '#lib/server/require-user.ts';
import { assignedBills, otherBillsInVote } from '#lib/server/votes.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const user = requireUser(event);
	const page = parsePage(event.url.searchParams.get('page'));
	if (page === null) error(404);
	const now = nowOf(event);
	const { session, previous } = sessionsAt(now);
	if (now < session.voteAt) redirect(303, '/saiketsu');
	const db = drizzle(env.DB);
	// 先に割り当てを固定する（ここから開いても、一覧と同じ法案が除かれる）
	await assignedBills(db, user.id, session, previous, now, Math.random);
	const { rows, hasNext } = await otherBillsInVote(db, user.id, session, previous, page);
	if (page > 1 && rows.length === 0) error(404);
	return { rows: rows.map((r) => ({ id: r.id, title: r.title, voted: r.choice !== null })), hasNext, page };
};
