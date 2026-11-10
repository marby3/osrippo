// ホーム（Issue #44：今の会期。Issue #127：あなたの割り当て法案）
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { nowOf, sessionsAt } from '#lib/server/client.ts';
import { assignmentRows, isEligibleVoter } from '#lib/server/votes.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const now = nowOf(event);
	const { session, previous } = sessionsAt(now);
	const user = event.locals.user;
	if (!user) return { session, assignment: null };
	if (now < session.voteAt) return { session, assignment: { open: false as const } };
	// 採決の期間は、採決の一覧と同じくじで割り当てを決める（docs/spec/65.md 決めたこと8）
	const db = drizzle(env.DB);
	const rows = await assignmentRows(db, user.id, session, previous, now, Math.random);
	return {
		session,
		assignment: { open: true as const, total: rows.length, done: rows.filter((r) => r.choice !== null).length, eligible: await isEligibleVoter(db, user.id, session) }
	};
};
