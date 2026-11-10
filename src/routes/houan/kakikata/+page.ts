// 法案の書き方（Issue #59）。ログインも DB も要らない。説明に出す数はルールの値から作る（ルールを変えたときに食い違わないように）
import { BILL_MAX, PROPOSAL_MIN, PROPOSAL_PERCENT } from '#lib/domain/bills.ts';
import { DAY, LIMITS } from '#lib/domain/limits.ts';
import { sessionDays } from '#lib/domain/session.ts';
import type { PageLoad } from './$types';

export const load: PageLoad = () => {
	return {
		waitDays: LIMITS.billAccountAge / DAY,
		solutions: BILL_MAX.solutions,
		laws: BILL_MAX.laws,
		changes: BILL_MAX.changes,
		percent: PROPOSAL_PERCENT,
		min: PROPOSAL_MIN,
		...sessionDays()
	};
};
