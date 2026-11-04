// 法案の下書きを直す（Issue #46）。提出者だけ、下書きのあいだだけ
import { error } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { articleBodyText, articleLabel } from '#lib/domain/law/index.ts';
import { parseIssueId } from '#lib/domain/issues.ts';
import { submitBill } from '#lib/server/bill-actions.ts';
import { FIRST_COMMITTEE, type BillFormValues } from '#lib/server/bill-form.ts';
import { billById, citedCandidates, committeeLawList, draftArticles } from '#lib/server/bills.ts';
import { requireUser } from '#lib/server/require-user.ts';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

/** ない法案は 404（ログインより先に）。提出者でないか下書きでなければ 403 */
async function editable(event: RequestEvent) {
	const id = parseIssueId(event.params.id);
	const bill = id === null ? undefined : await billById(drizzle(env.DB), id);
	if (!bill) error(404);
	const user = requireUser(event);
	if (bill.userId !== user.id || bill.status !== 'draft') error(403);
	return { bill, user };
}

export const load: PageServerLoad = async (event) => {
	const { bill } = await editable(event);
	const db = drizzle(env.DB);
	const law = bill.laws[0];
	// 条文はいま施行されている版を出し、それを基にした版として送る（docs/spec/45.md 決めたこと7）
	const articles = law?.lawId ? await draftArticles(db, FIRST_COMMITTEE, law.lawId) : undefined;
	const initial: BillFormValues = {
		kind: bill.kind,
		title: bill.title,
		law: law?.lawId ?? '',
		base: articles?.revisionId ?? '',
		affected: bill.affected,
		sideEffects: bill.sideEffects,
		summary: bill.summary ?? '',
		supplementary: bill.supplementary ?? '',
		solutions: bill.solutionIds.map(String),
		rows: (law?.changes ?? []).map((c) => ({
			op: c.op,
			target: c.op === 'add' ? '' : c.num,
			num: c.op === 'add' ? articleLabel(c.num) : '',
			caption: c.caption ?? '',
			body: c.paragraphs ? articleBodyText(c.paragraphs) : ''
		}))
	};
	return {
		view: 'form' as const,
		edit: { id: bill.id, rev: bill.rev, title: bill.title },
		laws: await committeeLawList(db, FIRST_COMMITTEE),
		candidates: await citedCandidates(db, bill.solutionIds),
		initial,
		articles: articles ?? null,
		siteKey: env.TURNSTILE_SITE_KEY
	};
};

export const actions: Actions = {
	default: async (event) => {
		const { bill, user } = await editable(event);
		return submitBill(event, user, { id: bill.id, kind: bill.kind });
	}
};
