// 専門家の解説の書く・直す・通報の受け付け（Issue #152）。法案の概要のページの ?/commentary・?/reportCommentary
import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { ja } from '../copy/ja';
import { checkText, parseIssueId } from '../domain/issues';
import { validateSolutionReport } from '../domain/reports';
import { billById } from './bills';
import { checkTurnstile, nowOf, refusalMessage, writeGuard } from './client';
import { reportCommentary, writeCommentary } from './commentaries';
import { progressOf } from './post-actions';

/** 解説の長さの上限 */
export const COMMENTARY_MAX = 2000;

/** 書ける時期：発議から採決の締切まで */
export const commentaryOpen = (progress: string) => progress === 'proposed' || progress === 'deliberation' || progress === 'vote';

async function billOf(event: RequestEvent) {
	const id = parseIssueId(event.params.id ?? '');
	const db = drizzle(env.DB);
	const bill = id === null ? undefined : await billById(db, id);
	if (!bill) error(404);
	return { db, bill };
}

/** 書く・直す。確かめる順：ログイン → 国 → 締め出し → 有識者（立候補した選挙の期間中も断る）→ 時期 → Turnstile → 中身 */
export async function commentaryAction(event: RequestEvent) {
	const { db, bill } = await billOf(event);
	const user = event.locals.user;
	if (!user) redirect(303, `/login?next=${encodeURIComponent(`/houan/${bill.id}`)}`);
	const now = nowOf(event);
	const form = await event.request.formData();
	const raw = String(form.get('body') ?? '');
	const guard = await writeGuard(event, db, user, now, 'expert');
	if (!guard.ok) return fail(guard.failure.status, { ...guard.failure.data, commentaryBody: raw });
	if (bill.status === 'draft' || bill.proposedAt === null || !commentaryOpen(progressOf(bill, now).progress)) return fail(409, { message: ja.commentary.closed, commentaryBody: raw });
	if (!(await checkTurnstile(event, String(form.get('cf-turnstile-response') ?? ''), guard.ip))) return fail(400, { message: ja.guard.turnstileFailed, commentaryBody: raw });
	const [body, bodyError] = checkText(raw, COMMENTARY_MAX, true);
	if (bodyError) return fail(400, { message: bodyError === 'tooLong' ? ja.issue.errors.tooLong(COMMENTARY_MAX) : ja.issue.errors[bodyError === 'required' ? 'required' : 'control'], commentaryBody: raw });
	const id = await writeCommentary(db, { billId: bill.id, userId: user.id, body }, now);
	if (id === null) return fail(409, { message: ja.commentary.cannotEdit, commentaryBody: raw });
	return { commentaryDone: true };
}

/** 通報する（質疑の通報と同じ順） */
export async function reportCommentaryAction(event: RequestEvent) {
	const { db, bill } = await billOf(event);
	const user = event.locals.user;
	if (!user) redirect(303, `/login?next=${encodeURIComponent(`/houan/${bill.id}`)}`);
	const now = nowOf(event);
	const form = await event.request.formData();
	const id = parseIssueId(String(form.get('commentary') ?? ''));
	if (id === null) error(400);
	const guard = await writeGuard(event, db, user, now, 'report');
	if (!guard.ok) return fail(guard.failure.status, { ...guard.failure.data, reportCommentary: id });
	const checked = validateSolutionReport({ reason: form.has('reason') ? String(form.get('reason')) : null, note: form.has('note') ? String(form.get('note')) : null });
	if (!checked.ok) return fail(400, { message: ja.kanri.invalid, reportCommentary: id });
	const result = await reportCommentary(db, guard.actor, { id, billId: bill.id }, checked.value, now);
	if (!result.ok) {
		if (result.reason === 'missing') error(404);
		if (result.reason === 'limit' && 'refusal' in result) return fail(429, { message: refusalMessage(result.refusal), reportCommentary: id });
		return fail(403, { message: ja.commentary.reportAlready, reportCommentary: id });
	}
	return { reportCommentary: id, reportDone: true };
}
