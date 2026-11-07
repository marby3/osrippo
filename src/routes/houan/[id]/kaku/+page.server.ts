// 法案の下書きと要調整の法案を直す（Issue #46・#72）。提出者だけ
import { error } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { billProgress, referralSession, type BillChange } from '#lib/domain/bills.ts';
import { articleBodyText, articleLabel } from '#lib/domain/law/index.ts';
import { parseIssueId } from '#lib/domain/issues.ts';
import { submitBill } from '#lib/server/bill-actions.ts';
import { FIRST_COMMITTEE, type BillFormValues } from '#lib/server/bill-form.ts';
import { billById, billSupportState, citedCandidates, committeeLawList, draftArticles, lawTitlesOf } from '#lib/server/bills.ts';
import { nowOf, sessionsAt } from '#lib/server/client.ts';
import { adjustmentOf, currentNumsOf, staleArticlesOfBill } from '#lib/server/if-world.ts';
import { requireUser } from '#lib/server/require-user.ts';
import { canEditDraft } from '#lib/server/cosponsors.ts';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

/** ない法案は 404（ログインより先に）。提出者でないか下書きでなければ 403 */
async function editable(event: RequestEvent) {
	const id = parseIssueId(event.params.id);
	const bill = id === null ? undefined : await billById(drizzle(env.DB), id);
	if (!bill) error(404);
	const user = requireUser(event);
	const db = drizzle(env.DB);
	const now = nowOf(event);
	// 要調整の法案は、期限までに提出者が直せる（docs/spec/72.md 決めたこと7）
	const { minutes } = sessionsAt(now);
	const stage = bill.status === 'proposed' && bill.proposedAt !== null && billProgress(bill, now, minutes) === 'lapsed' ? await adjustmentOf(db, referralSession(bill.proposedAt, minutes).key, bill.id) : null;
	const adjusting = stage !== null && stage.reason !== 'repealed' && now < stage.dueAt;
	// 下書きは提出者と共同提出者が直せる。要調整は提出者だけ（docs/spec/76.md 決めたこと3）
	const allowed = bill.status === 'draft' ? await canEditDraft(db, bill, user.id) : adjusting && bill.userId === user.id;
	if (!allowed) error(403);
	return { bill, user, adjusting, adjustment: adjusting ? stage : null };
}

export const load: PageServerLoad = async (event) => {
	const { bill, adjusting, adjustment } = await editable(event);
	const db = drizzle(env.DB);
	const titles = await lawTitlesOf(db, bill);
	const multiple = bill.laws.length > 1;
	// 法令ごとに、条文は IF世界の最新を出し、それを基にした版として送る（docs/spec/72.md 決めたこと4、docs/spec/53.md 決めたこと5）
	const slots = await Promise.all(
		bill.laws.map(async (law) => {
			const articles = law.lawId ? await draftArticles(db, FIRST_COMMITTEE, law.lawId) : undefined;
			// 番号が変わった条の行は、同じ内部IDの条のいまの番号で出す。なくなった条の行は選び直してもらう（docs/spec/95.md 決めたこと4）
			const nums = law.lawId ? await currentNumsOf(db, law.lawId, law.changes.flatMap((c) => (c.provisionId === null ? [] : [c.provisionId]))) : new Map<number, string | null>();
			return { law, articles, nums };
		})
	);
	const targetOf = (c: BillChange, nums: Map<number, string | null>) => (c.provisionId === null ? c.num : nums.has(c.provisionId) ? (nums.get(c.provisionId) ?? '') : c.num);
	const rows = slots.flatMap(({ law, nums }) =>
		law.changes.map((c) => ({
			change: c,
			gone: c.op !== 'add' && c.provisionId !== null && nums.get(c.provisionId) === null,
			value: {
				op: c.op,
				target: c.op === 'add' ? '' : targetOf(c, nums),
				num: c.op === 'add' ? articleLabel(c.num) : '',
				caption: c.caption ?? '',
				body: c.paragraphs ? articleBodyText(c.paragraphs) : '',
				seq: String(law.seq)
			}
		}))
	);
	const candidates = await citedCandidates(db, bill.solutionIds);
	// 非表示になった解決策は候補に出ないので、引用からも外して、そのことを知らせる
	const solutionIds = bill.solutionIds.filter((id) => candidates.some((c) => c.id === id));
	const [main, ...extras] = slots;
	const initial: BillFormValues = {
		kind: bill.kind,
		title: bill.title,
		newTitle: main?.law.newTitle ?? '',
		law: main?.law.lawId ?? '',
		base: main?.articles?.revisionId ?? '',
		extras: extras.map((x) => ({ law: x.law.lawId ?? '', base: x.articles?.revisionId ?? '', action: x.law.action })),
		affected: bill.affected,
		sideEffects: bill.sideEffects,
		summary: bill.summary ?? '',
		supplementary: bill.supplementary ?? '',
		solutions: solutionIds.map(String),
		rows: rows.map((r) => r.value)
	};
	return {
		edit: { id: bill.id, rev: bill.rev, title: bill.title },
		laws: await committeeLawList(db, FIRST_COMMITTEE),
		candidates,
		dropped: bill.solutionIds.length - solutionIds.length,
		supports: (await billSupportState(db, bill.id, bill.rev, null)).supports,
		initial,
		articles: slots.map((x) => x.articles ?? null),
		// 基にしたあとで変わった条（docs/spec/72.md の B2）
		conflicts: await staleArticlesOfBill(db, bill.laws, multiple ? titles : null),
		goneRows: rows.flatMap((r, i) => (r.gone ? [i] : [])),
		// IF世界で廃止された法令（法令が2本以上なら名前で知らせる）
		repealed: slots.filter((x) => x.law.lawId && !x.articles).map((x) => (multiple ? (titles.get(x.law.lawId as string) ?? '') : '')),
		adjusting,
		adjustmentReason: adjustment?.reason ?? null,
		siteKey: env.TURNSTILE_SITE_KEY
	};
};

export const actions: Actions = {
	default: async (event) => {
		const { bill, user, adjusting } = await editable(event);
		return submitBill(event, user, { ...bill, adjusting });
	}
};
