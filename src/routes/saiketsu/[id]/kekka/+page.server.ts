// 採決の結果（Issue #71。SpResult・PcResult）。ログインは要らない。締切の前は結果も票も読まない（設計書 docs/spec/71.md 決めたこと8）
import { articleLabel } from '#lib/domain/law/parse.ts';
import { referenceComparison } from '#lib/domain/votes.ts';
import { nowOf, sessionsAt } from '#lib/server/client.ts';
import type { BatchDb } from '#lib/server/law.ts';
import { postableBill, progressOf } from '#lib/server/post-actions.ts';
import { priorAmendmentResults, resultOnRead } from '#lib/server/results.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const { db, bill } = await postableBill(event);
	const now = nowOf(event);
	const { progress, session } = progressOf(bill, now);
	const shell = { bill: { id: bill.id, title: bill.title }, session };
	if (progress !== 'lapsed') return { ...shell, phase: 'before' as const };
	const result = await resultOnRead(db as unknown as BatchDb, bill, sessionsAt(now).minutes, now);
	if (!result) return { ...shell, phase: 'counting' as const };
	const reference = { yes: result.refYes, no: result.refNo, abstain: result.refAbstain };
	return {
		...shell,
		phase: 'done' as const,
		outcome: result.outcome,
		quorum: result.quorum,
		counted: { yes: result.yes, no: result.no, abstain: result.abstain },
		reference,
		comparison: referenceComparison(result.outcome, reference, result.quorum),
		amendments: (await priorAmendmentResults(db, bill.id)).map((a) => ({ id: a.id, location: articleLabel(a.num), status: a.status as 'passed' | 'failed' | 'superseded' | 'lapsed' }))
	};
};
