// 採決の結果（Issue #71。SpResult・PcResult）。ログインは要らない。締切の前は結果も票も読まない（設計書 docs/spec/71.md 決めたこと8）
import { articleLabel } from '#lib/domain/law/parse.ts';
import { referenceComparison } from '#lib/domain/votes.ts';
import { nowOf, sessionsAt } from '#lib/server/client.ts';
import { adjustmentOf, ifPlaceOf } from '#lib/server/if-world.ts';
import type { BatchDb } from '#lib/server/law.ts';
import { postableBill, progressOf } from '#lib/server/post-actions.ts';
import { billStageNow, priorAmendmentResults, resultOnRead } from '#lib/server/results.ts';
import { resubmitStateOf } from '#lib/server/resubmit.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const { db, bill } = await postableBill(event);
	const now = nowOf(event);
	const { progress, session } = progressOf(bill, now);
	const shell = { bill: { id: bill.id, title: bill.title }, session };
	if (progress !== 'lapsed') return { ...shell, phase: 'before' as const };
	const result = await resultOnRead(db as unknown as BatchDb, bill, sessionsAt(now).minutes, now);
	if (!result) return { ...shell, phase: 'counting' as const };
	// 確認中は可否も票の数も返さない（docs/spec/73.md の C）
	if (result.review?.status === 'open') return { ...shell, phase: 'reviewing' as const };
	const voided = result.review?.status === 'voided';
	// 出し直しのリンクは提出者にだけ。outcome は要調整の期限切れで可決のまま残るので、段階で判定する（docs/spec/75.md）
	let resubmittable = false;
	if (event.locals.user?.id === bill.userId) {
		const view = await billStageNow(db as unknown as BatchDb, bill, now, sessionsAt(now).minutes);
		const state = await resubmitStateOf(db, view.bill, view.stage);
		resubmittable = state.can && state.next === null;
	}
	const reference = { yes: result.refYes, no: result.refNo, abstain: result.refAbstain };
	return {
		...shell,
		phase: 'done' as const,
		resubmittable,
		// 無効の行の outcome は可決のまま残っているので、そのまま使わない（廃案として返す）
		outcome: voided ? ('lapsed' as const) : result.outcome,
		voidedNote: voided ? (result.review?.note ?? '') : null,
		quorum: result.quorum,
		counted: { yes: result.yes, no: result.no, abstain: result.abstain },
		reference,
		comparison: voided ? null : referenceComparison(result.outcome, reference, result.quorum),
		place: !voided && result.outcome === 'passed' ? await ifPlaceOf(db, bill.id, result.rev) : null,
		adjustment: !voided && result.outcome === 'passed' ? await adjustmentOf(db, result.sessionKey, bill.id) : null,
		now,
		// 無効は本案ごと廃案なので、修正案の可否も出さない
		amendments: (voided ? [] : await priorAmendmentResults(db, bill.id, session.key)).map((a) => ({ id: a.id, location: articleLabel(a.num), status: a.status as 'passed' | 'failed' | 'superseded' | 'lapsed' }))
	};
};
