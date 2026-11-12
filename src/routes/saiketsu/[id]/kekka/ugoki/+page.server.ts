// 会期中の考えの動き（Issue #87、設計書 docs/spec/87.md の I）。ログインは要らない。結果が出て、確認中でも無効でもないときだけ割合を渡す
import { motionView } from '#lib/domain/stance-stats.ts';
import { nowOf, sessionsAt } from '#lib/server/client.ts';
import type { BatchDb } from '#lib/server/law.ts';
import { postableBill, progressOf } from '#lib/server/post-actions.ts';
import { resultOnRead } from '#lib/server/results.ts';
import { stanceStatsOf } from '#lib/server/stance-stats.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const { db, bill } = await postableBill(event);
	const now = nowOf(event);
	const { progress, session } = progressOf(bill, now);
	const shell = { bill: { id: bill.id, title: bill.title }, session, ifBand: true as const };
	if (progress === 'withdrawn') return { ...shell, phase: 'withdrawn' as const };
	if (progress !== 'lapsed') return { ...shell, phase: 'before' as const };
	const minutes = sessionsAt(now).minutes;
	const result = await resultOnRead(db as unknown as BatchDb, bill, minutes, now);
	if (!result) return { ...shell, phase: 'counting' as const };
	if (result.review?.status === 'open') return { ...shell, phase: 'reviewing' as const };
	if (result.review?.status === 'voided') return { ...shell, phase: 'voided' as const };
	const stats = await stanceStatsOf(db, bill, minutes, now);
	// 人数は渡さない。10人未満なら null
	return { ...shell, phase: 'done' as const, motion: stats ? motionView(stats.weeks) : null };
};
