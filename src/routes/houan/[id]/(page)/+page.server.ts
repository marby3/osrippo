// 賛同と発議の受け付け（Issue #49）
import { proposeAction, supportAction } from '#lib/server/bill-actions.ts';
import type { Actions } from './$types';

export const actions: Actions = {
	support: supportAction,
	propose: proposeAction
};
