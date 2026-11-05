// 修正案の受け付け（Issue #68。設計書 docs/spec/68.md 決めたこと4〜7・9）
import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { ja } from '../copy/ja';
import { acceptOpen, AMENDMENT_REASON_MAX, amendmentOpen, amendmentVoteOpen, applyAmendments, checkAmendedLaw, hasAmendableLaw, parseArticleKey, priorVoteRequirement, validateAmendmentBody, validateAmendmentReason } from '../domain/amendments';
import { parseIssueId } from '../domain/issues';
import { billWaitUntil } from '../domain/limits';
import { VOTE_CHOICES, type VoteChoice } from '../domain/votes';
import { acceptAmendment, amendableArticles, amendmentOf, castAmendmentVote, createAmendment, myAmendmentVote, setAmendmentSupport, updateAmendment, type AmendmentRow } from './amendments';
import { sessionParticipants } from './bills';
import { checkTurnstile, nowOf, refusalMessage, sessionsAt, writeGuard } from './client';
import { baseArticlesOf } from './if-world';
import type { BatchDb, Db } from './law';
import { postableBill, progressOf } from './post-actions';
import { voteLimit } from './votes';

export const amendmentsPath = (billId: number) => `/houan/${billId}/shusei`;

/** 修正案を扱える法案。ない番号、下書き、変えられる条のない法案は 404 */
export async function amendableBill(event: Pick<RequestEvent, 'params'>) {
	const { db, bill } = await postableBill(event);
	if (!hasAmendableLaw(bill.laws)) error(404);
	return { db: db as unknown as BatchDb, bill };
}

/** その会期に固定した今月の参加者から求めた、本案より先に採決するのに要る賛同 */
export async function priorRequirementAt(db: Db, committeeId: number, now: number) {
	const { session, previous } = sessionsAt(now);
	return priorVoteRequirement(await sessionParticipants(db, committeeId, session, previous, now));
}

/** 修正案を出す、または更新する（?koushin=<番号>）。書けたら修正案のタブへ */
export async function amendmentPostAction(event: RequestEvent) {
	const { db, bill } = await amendableBill(event);
	const koushin = event.url.searchParams.get('koushin');
	let target: AmendmentRow | undefined;
	if (koushin !== null) {
		const id = parseIssueId(koushin);
		target = id === null ? undefined : await amendmentOf(db, id, bill.id);
		if (!target) error(404);
	}
	const user = event.locals.user;
	if (!user) redirect(303, `/login?next=${encodeURIComponent(amendmentsPath(bill.id))}`);

	const now = nowOf(event);
	const form = await event.request.formData();
	const body = String(form.get('body') ?? '');
	const reasonRaw = String(form.get('reason') ?? '');
	const articleRaw = String(form.get('article') ?? '');
	const keep = { article: articleRaw, body, reason: reasonRaw };

	const guard = await writeGuard(event, db, user, now);
	if (!guard.ok) return fail(guard.failure.status, { ...guard.failure.data, ...keep });
	const wait = billWaitUntil(guard.actor.registeredAt, now);
	if (wait !== null) return fail(403, { message: ja.amendment.tooNew(wait), ...keep });
	if (!(await checkTurnstile(event, String(form.get('cf-turnstile-response') ?? ''), guard.ip))) return fail(400, { message: ja.guard.turnstileFailed, ...keep });

	const rev = parseIssueId(String(form.get('rev') ?? ''));
	const key = target ? { lawSeq: target.lawSeq, num: target.num } : parseArticleKey(articleRaw);
	if (rev === null || key === null) return fail(400, { message: ja.amendment.invalid, ...keep });
	const reason = validateAmendmentReason(reasonRaw);
	if (!reason.ok) {
		const text = reason.error === 'tooLong' ? ja.issue.errors.tooLong(AMENDMENT_REASON_MAX) : ja.issue.errors[reason.error];
		return fail(400, { reasonError: text, ...keep });
	}

	const { progress, session } = progressOf(bill, now);
	if (!amendmentOpen(progress)) return fail(409, { message: ja.amendment.closed, ...keep });
	if (target) {
		if (target.userId !== user.id) return fail(403, { message: ja.amendment.notMine, ...keep });
		if (target.status !== 'open' || target.baseRev === bill.rev) return fail(409, { message: ja.amendment.noUpdate, ...keep });
	} else if (bill.userId === user.id) {
		return fail(403, { message: ja.amendment.author, ...keep });
	}
	if (rev !== bill.rev) return fail(409, { message: ja.amendment.staleForm, ...keep });

	const article = (await amendableArticles(db, bill)).find((a) => a.lawSeq === key.lawSeq && a.num === key.num);
	if (!article) return fail(400, { message: ja.amendment.invalid, ...keep });
	const checked = validateAmendmentBody(body, article);
	if (!checked.ok) return fail(400, { error: checked.error, line: checked.line, updating: target !== undefined, ...keep });
	const law = bill.laws[key.lawSeq];
	const amended = applyAmendments(bill.laws, [{ lawSeq: key.lawSeq, num: key.num, provisionId: article.provisionId, caption: article.caption, paragraphs: checked.paragraphs }]);
	const rule = checkAmendedLaw(
		law.action,
		law.baseRevisionId ? await baseArticlesOf(db, law) : null,
		amended[key.lawSeq].changes,
		amended.reduce((n, l) => n + l.changes.length, 0)
	);
	if (rule) return fail(400, { ruleError: rule === 'changeCount' ? ja.bill.errors.changeCount : ja.bill.changeErrors[rule], ...keep });

	const result = target
		? await updateAmendment(db, guard.actor, bill, target, checked.paragraphs, reason.reason, now)
		: await createAmendment(
				db,
				guard.actor,
				{ billId: bill.id, sessionKey: session.key, baseRev: rev, lawSeq: key.lawSeq, num: key.num, provisionId: article.provisionId, caption: article.caption, paragraphs: checked.paragraphs, reason: reason.reason },
				now
			);
	if (!result.ok) {
		return 'refusal' in result ? fail(429, { message: refusalMessage(result.refusal), ...keep }) : fail(409, { message: ja.amendment.noUpdate, ...keep });
	}
	redirect(303, amendmentsPath(bill.id));
}

/** 取り込む */
export async function acceptAction(event: RequestEvent) {
	const { db, bill } = await amendableBill(event);
	const user = event.locals.user;
	if (!user) redirect(303, `/login?next=${encodeURIComponent(amendmentsPath(bill.id))}`);
	const now = nowOf(event);
	const form = await event.request.formData();
	const id = parseIssueId(String(form.get('amendment') ?? ''));
	const keep = { amendment: id };
	const guard = await writeGuard(event, db, user, now);
	if (!guard.ok) return fail(guard.failure.status, { ...guard.failure.data, ...keep });
	const revision = parseIssueId(String(form.get('revision') ?? ''));
	if (id === null || revision === null) error(400);
	const amendment = await amendmentOf(db, id, bill.id);
	if (!amendment) error(404);
	if (bill.userId !== user.id) return fail(403, { message: ja.amendment.notAuthor, ...keep });
	const { progress, session } = progressOf(bill, now);
	if (!acceptOpen(progress, now, session.voteAt)) return fail(409, { message: ja.amendment.acceptClosed, ...keep });
	if (!(await acceptAmendment(db, guard.actor, bill.id, id, revision, now))) return fail(409, { message: ja.amendment.stale, ...keep });
	return { accepted: id };
}

/** 本案より先に採決するための賛同 */
export async function amendmentSupportAction(event: RequestEvent) {
	const { db, bill } = await amendableBill(event);
	const user = event.locals.user;
	if (!user) redirect(303, `/login?next=${encodeURIComponent(amendmentsPath(bill.id))}`);
	const now = nowOf(event);
	const form = await event.request.formData();
	const id = parseIssueId(String(form.get('amendment') ?? ''));
	const keep = { amendment: id };
	const guard = await writeGuard(event, db, user, now);
	if (!guard.ok) return fail(guard.failure.status, { ...guard.failure.data, ...keep });
	const wait = billWaitUntil(guard.actor.registeredAt, now);
	if (wait !== null) return fail(403, { message: ja.amendment.tooNew(wait), ...keep });
	const revision = parseIssueId(String(form.get('revision') ?? ''));
	const op = form.get('op');
	if (id === null || revision === null || (op !== 'add' && op !== 'remove')) error(400);
	const amendment = await amendmentOf(db, id, bill.id);
	if (!amendment) error(404);
	const { progress } = progressOf(bill, now);
	if (!amendmentOpen(progress)) return fail(409, { message: ja.amendment.closed, ...keep });
	if (amendment.userId === user.id || bill.userId === user.id) return fail(403, { message: ja.amendment.ownSupport, ...keep });
	const result = await setAmendmentSupport(db, guard.actor, amendment, bill.rev, revision, op, now);
	if (!result.ok) return 'refusal' in result ? fail(429, { message: refusalMessage(result.refusal), ...keep }) : fail(409, { message: ja.amendment.stale, ...keep });
	return { supported: id };
}

/** 修正案の票。Turnstile を通す（仕様「投票のときにもbot対策を通す」）。投票資格がなければ参考の票になるだけなので、登録からの日数は見ない */
export async function amendmentVoteAction(event: RequestEvent) {
	const { db, bill } = await amendableBill(event);
	const user = event.locals.user;
	if (!user) redirect(303, `/login?next=${encodeURIComponent(amendmentsPath(bill.id))}`);
	const now = nowOf(event);
	const form = await event.request.formData();
	const id = parseIssueId(String(form.get('amendment') ?? ''));
	const keep = { amendment: id };
	const guard = await writeGuard(event, db, user, now);
	if (!guard.ok) return fail(guard.failure.status, { ...guard.failure.data, ...keep });
	if (!(await checkTurnstile(event, String(form.get('cf-turnstile-response') ?? ''), guard.ip))) return fail(400, { message: ja.guard.turnstileFailed, ...keep });
	const choice = String(form.get('choice'));
	if (id === null || !(VOTE_CHOICES as readonly string[]).includes(choice)) error(400);
	if (!(await amendmentOf(db, id, bill.id))) error(404);
	const { progress } = progressOf(bill, now);
	if (!amendmentVoteOpen(progress)) return fail(409, { message: ja.amendment.voteClosed, ...keep });
	const { session, previous } = sessionsAt(now);
	const required = await priorRequirementAt(db, bill.committeeId, now);
	// 同じ票の入れ直しは上限に数えない
	if ((await myAmendmentVote(db, session.key, id, guard.actor.userId)) !== choice) {
		const limited = await voteLimit(db, guard.actor, now);
		if (limited) return fail(429, { message: refusalMessage(limited.refusal), ...keep });
	}
	if (!(await castAmendmentVote(db, guard.actor, session, previous, id, required, choice as VoteChoice, now, Math.random))) {
		return fail(409, { message: ja.amendment.notVoting, ...keep });
	}
	return { voted: id };
}
