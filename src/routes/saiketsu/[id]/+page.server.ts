// 投票の画面（Issue #70。SpVote・PcVote）。確かめの順：番号と存在 → ログイン → 国 → 締め出し → Turnstile → 入力 → 状態 → 上限 → 保存。
// 登録からの日数は見ない（投票資格がなければ参考の票になるだけ。docs/spec/65.md 決めたこと5）
import { error, fail, redirect } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { ja } from '#lib/copy/ja.ts';
import { parseVoteChoice } from '#lib/domain/votes.ts';
import { priorRequirementAt } from '#lib/server/amendment-actions.ts';
import { priorVoteCount } from '#lib/server/amendments.ts';
import { billChangeViews, billView } from '#lib/server/bills.ts';
import { checkTurnstile, nowOf, refusalMessage, sessionsAt, writeGuard } from '#lib/server/client.ts';
import { postableBill, progressOf } from '#lib/server/post-actions.ts';
import { requireUser } from '#lib/server/require-user.ts';
import { assignmentRows, castVote, isEligibleVoter, myVote, voteLimit } from '#lib/server/votes.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const { db, bill } = await postableBill(event);
	const now = nowOf(event);
	const { progress, session } = progressOf(bill, now);
	// 会期が終わった法案は結果のページへ。発議済みで今は採決の対象でない法案は、行き止まりにせず法案のページへ。どちらもログインは要らない
	if (progress === 'lapsed') redirect(303, `/saiketsu/${bill.id}/kekka`);
	if (progress !== 'vote') redirect(303, `/houan/${bill.id}`);
	const user = requireUser(event);
	const { previous } = sessionsAt(now);
	const rows = await assignmentRows(db, user.id, session, previous, now, Math.random);
	const required = await priorRequirementAt(db, bill.committeeId, now);
	const [view, changes, mine, eligible, prior] = await Promise.all([
		billView(db, bill, now),
		billChangeViews(db, bill),
		myVote(db, session.key, bill.id, user.id),
		isEligibleVoter(db, user.id, session),
		priorVoteCount(db, session.key, bill, required)
	]);
	const position = rows.findIndex((r) => r.id === bill.id);
	return {
		// 解決策や提出者はこの画面で使わないので渡さない
		bill: { id: view.id, title: view.title, summary: view.summary, repealed: view.repealed, changeCount: view.changeCount },
		changes,
		mine,
		eligible,
		hasPriorAmendment: prior > 0,
		position: position < 0 ? null : position + 1,
		total: rows.length,
		done: rows.filter((r) => r.choice !== null).length,
		siteKey: env.TURNSTILE_SITE_KEY
	};
};

export const actions: Actions = {
	vote: async (event) => {
		const { db, bill } = await postableBill(event);
		const user = event.locals.user;
		if (!user) redirect(303, `/login?next=${encodeURIComponent(`/saiketsu/${bill.id}`)}`);
		const now = nowOf(event);
		const form = await event.request.formData();
		const guard = await writeGuard(event, db, user, now, 'participate');
		if (!guard.ok) return guard.failure;
		if (!(await checkTurnstile(event, String(form.get('cf-turnstile-response') ?? ''), guard.ip))) return fail(400, { message: ja.guard.turnstileFailed });
		const choice = parseVoteChoice(form.get('choice'));
		if (choice === null) error(400);
		const { progress, session } = progressOf(bill, now);
		if (progress !== 'vote') return fail(409, { message: ja.vote.closed });
		// 同じ票の入れ直しは上限に数えない
		if ((await myVote(db, session.key, bill.id, user.id)) !== choice) {
			const limited = await voteLimit(db, guard.actor, now);
			if (limited) return fail(429, { message: refusalMessage(limited.refusal) });
		}
		const { previous } = sessionsAt(now);
		if (!(await castVote(db, guard.actor, session, previous, bill.id, choice, now, Math.random))) return fail(409, { message: ja.vote.closed });
		return { voted: true };
	}
};
