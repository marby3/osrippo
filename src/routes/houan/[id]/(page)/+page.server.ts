// 賛同と発議（Issue #49）、出し直し（Issue #75）の受け付け
import { proposeAction, resubmitAction, supportAction } from '#lib/server/bill-actions.ts';
import type { Actions } from './$types';

export const actions: Actions = {
	support: supportAction,
	propose: proposeAction,
	resubmit: resubmitAction
};
