// 法案を書く（Issue #46）。解決策から書き始める：/houan/kaku?kaiketsu=<解決策の番号>
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { billWaitUntil } from '#lib/domain/limits.ts';
import { parseIssueId } from '#lib/domain/issues.ts';
import { submitBill } from '#lib/server/bill-actions.ts';
import { FIRST_COMMITTEE, type BillFormValues } from '#lib/server/bill-form.ts';
import { candidateSolutions, citableSolution, committeeLawList } from '#lib/server/bills.ts';
import { nowOf } from '#lib/server/client.ts';
import { requireUser } from '#lib/server/require-user.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const user = requireUser(event);
	const db = drizzle(env.DB);
	const wait = billWaitUntil(user.createdAt.getTime(), nowOf(event));
	if (wait !== null) return { view: 'wait' as const, until: wait };
	// ?kaiketsu= はちょうど1つ。表示中の解決策でなければ、解決策から書き始めることを案内する
	const raw = event.url.searchParams.getAll('kaiketsu');
	const id = raw.length === 1 ? parseIssueId(raw[0]) : null;
	const start = id === null ? undefined : await citableSolution(db, id);
	if (!start) return { view: 'start' as const };
	const initial: BillFormValues = {
		kind: 'amend',
		title: '',
		newTitle: '',
		law: '',
		base: '',
		affected: '',
		sideEffects: '',
		summary: '',
		supplementary: '',
		solutions: [String(start.id)],
		rows: [{ op: 'amend', target: '', num: '', caption: '', body: '' }]
	};
	return {
		view: 'form' as const,
		laws: await committeeLawList(db, FIRST_COMMITTEE),
		candidates: await candidateSolutions(db, start.issueId),
		back: `/kadai/${start.issueId}`,
		initial,
		articles: null,
		siteKey: env.TURNSTILE_SITE_KEY
	};
};

export const actions: Actions = {
	default: async (event) => submitBill(event, requireUser(event), null)
};
