// 賛同と発議（Issue #49）、出し直し（Issue #75）、共同提出者と撤回と統合案（Issue #76）の受け付け
import { cosponsorAction, mergeAction, proposeAction, resubmitAction, supportAction, withdrawAction } from '#lib/server/bill-actions.ts';
import type { Actions } from './$types';

export const actions: Actions = {
	support: supportAction,
	propose: proposeAction,
	resubmit: resubmitAction,
	cosponsor: cosponsorAction,
	withdraw: withdrawAction,
	merge: mergeAction
};
