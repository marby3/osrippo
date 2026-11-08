// 法案の書き方（Issue #59）。ログインは要らない。説明に出す数はルールの値から作る（ルールを変えたときに食い違わないように）
import { BILL_MAX, PROPOSAL_MIN, PROPOSAL_PERCENT } from '#lib/domain/bills.ts';
import { DAY, LIMITS } from '#lib/domain/limits.ts';
import { sessionAt } from '#lib/domain/session.ts';
import type { PageServerLoad } from './$types';

const JST = 9 * 60 * 60 * 1000;
/** 会期の時刻の、日本時間の日 */
const dayOf = (at: number) => new Date(at + JST).getUTCDate();

export const load: PageServerLoad = () => {
	// どの月でも同じ日なので、ある月の会期から求める
	const session = sessionAt(Date.UTC(2030, 0, 10), null);
	const deliberation = dayOf(session.deliberationAt);
	return {
		waitDays: LIMITS.billAccountAge / DAY,
		solutions: BILL_MAX.solutions,
		laws: BILL_MAX.laws,
		changes: BILL_MAX.changes,
		percent: PROPOSAL_PERCENT,
		min: PROPOSAL_MIN,
		// 発議の締切は質疑の始まりの0時なので、発議できるのはその前の日まで
		proposeUntil: deliberation - 1,
		deliberation,
		vote: dayOf(session.voteAt)
	};
};
