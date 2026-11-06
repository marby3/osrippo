// 法案のページ（概要と変更点のタブ）。下書きもだれでも見られる（Issue #46）
import { error } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { bills } from '#lib/db/schema.ts';
import { hasAmendableLaw } from '#lib/domain/amendments.ts';
import { nextStage, proposalRequirement } from '#lib/domain/bills.ts';
import { parseIssueId } from '#lib/domain/issues.ts';
import { billWaitUntil } from '#lib/domain/limits.ts';
import { FIRST_COMMITTEE } from '#lib/server/bill-form.ts';
import { amendmentCount, coDrafters } from '#lib/server/amendments.ts';
import { billById, billSupportState, billView, relatedBills, sessionParticipants, supportRev } from '#lib/server/bills.ts';
import { nowOf, sessionsAt } from '#lib/server/client.ts';
import type { BatchDb } from '#lib/server/law.ts';
import { questionTotal } from '#lib/server/posts.ts';
import { billStageNow } from '#lib/server/results.ts';
import { resubmitStateOf } from '#lib/server/resubmit.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async (event) => {
	const { params, locals } = event;
	const id = parseIssueId(params.id);
	const db = drizzle(env.DB);
	// 作りかけ（rev = 0）は billById が返さない
	const loaded = id === null ? undefined : await billById(db, id);
	if (!loaded) error(404);
	const now = nowOf(event);
	const user = locals.user;
	const { session, previous, minutes } = sessionsAt(now);
	const { bill, progress, adjustment, stage } = await billStageNow(db as unknown as BatchDb, loaded, now, minutes);
	const isAuthor = user?.id === bill.userId;
	const draft = bill.status === 'draft';
	const { supports, mine } = await billSupportState(db, bill.id, supportRev(bill), user?.id ?? null);
	// 発議要件を読むのは提出者が下書きを見るときだけ（その会期で最初に読まれたときに固定する。docs/spec/49.md 決めたこと3）
	let required: number | null = null;
	if (draft && isAuthor) {
		required = proposalRequirement(await sessionParticipants(db, FIRST_COMMITTEE, session, previous, now));
	}
	return {
		bill: await billView(db, bill),
		progress,
		stage,
		// 要調整：期限を出し、提出者には直すリンクを出す
		adjustment: stage === 'adjusting' ? adjustment : null,
		next: nextStage(bill, now, minutes),
		// 下書きには質疑がないのでタブを出さない
		questionCount: draft ? null : await questionTotal(db, bill.id),
		// 変えられる条のない法案（廃止だけの法案）には修正案のタブを出さない
		amendmentTotal: draft || !hasAmendableLaw(bill.laws) ? null : await amendmentCount(db, bill.id),
		coDrafters: draft ? [] : await coDrafters(db, bill.id),
		related: draft ? [] : await relatedBills(db, bill, minutes),
		canEdit: isAuthor && (draft || stage === 'adjusting'),
		// 出し直し（docs/spec/75.md）。提出者にだけ渡す
		resubmit: isAuthor && progress === 'lapsed' ? await resubmitStateOf(db, bill, stage) : null,
		origin: bill.resubmittedFrom === null ? null : ((await db.select({ id: bills.id, title: bills.title }).from(bills).where(eq(bills.id, bill.resubmittedFrom)))[0] ?? null),
		support: {
			rev: bill.rev,
			count: supports,
			mine,
			open: draft && !isAuthor,
			loggedIn: Boolean(user),
			waitUntil: user && draft && !isAuthor ? billWaitUntil(user.createdAt.getTime(), now) : null,
			required
		}
	};
};
