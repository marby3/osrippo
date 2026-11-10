// ホーム（Issue #44：今の会期。Issue #127：あなたの割り当て法案。Issue #128：今日の条文）
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { nowOf, sessionsAt } from '#lib/server/client.ts';
import { tokyoDate } from '#lib/domain/law/index.ts';
import { cachedTodayArticle } from '#lib/server/today.ts';
import { assignmentRows, isEligibleVoter } from '#lib/server/votes.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const now = nowOf(event);
	const { session, previous } = sessionsAt(now);
	const db = drizzle(env.DB);
	const today = tokyoDate(now);
	const base = { session, today, todayArticle: await cachedTodayArticle(db, today) };
	const user = event.locals.user;
	if (!user) return { ...base, assignment: null };
	if (now < session.voteAt) return { ...base, assignment: { open: false as const } };
	// 採決の期間は、採決の一覧と同じくじで割り当てを決める（docs/spec/65.md 決めたこと8）
	const rows = await assignmentRows(db, user.id, session, previous, now, Math.random);
	return {
		...base,
		assignment: { open: true as const, total: rows.length, done: rows.filter((r) => r.choice !== null).length, eligible: await isEligibleVoter(db, user.id, session) }
	};
};
