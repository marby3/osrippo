// 採決の一覧（Issue #70。SpVoteList・PcVoteList）。採決の期間に初めて開いたときに割り当てを固定する
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { nowOf, sessionsAt } from '#lib/server/client.ts';
import { requireUser } from '#lib/server/require-user.ts';
import { assignmentRows, isEligibleVoter } from '#lib/server/votes.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const user = requireUser(event);
	const now = nowOf(event);
	const { session, previous } = sessionsAt(now);
	if (now < session.voteAt) return { session, open: false as const };
	const db = drizzle(env.DB);
	const rows = await assignmentRows(db, user.id, session, previous, now, Math.random);
	return {
		session,
		open: true as const,
		rows: rows.map((r) => ({ id: r.id, title: r.title, voted: r.choice !== null })),
		eligible: await isEligibleVoter(db, user.id, session)
	};
};
