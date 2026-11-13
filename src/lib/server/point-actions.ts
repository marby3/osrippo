// 質疑の論点を立てる・閉じる（Issue #168）。委員長・代行中の理事・運営・運営協力者だけの操作なので、Turnstile とレート制限は使わない（docs/safety.md）
import { fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { ja } from '../copy/ja';
import { checkPointTitle, parsePointNo, pointWindowOpen } from '../domain/points';
import { nowOf, sessionsAt, writeGuard } from './client';
import type { BatchDb } from './law';
import { postableBill, progressOf, questionsPath } from './post-actions';
import { closePoint, openPoint, pointStaffOf } from './points';

/**
 * 法案の番号と存在（下書きは 404）→ ログイン → 国 → 締め出し → 役職（その委員会の委員長・代行中の理事・運営・運営協力者で、関わっていない）→ 時期。
 * 失敗は論点の欄に出す（pointMessage で返す）
 */
async function pointStaff(event: RequestEvent, keep: Record<string, unknown> = {}) {
	const { db, bill } = await postableBill(event);
	const user = event.locals.user;
	if (!user) redirect(303, `/login?next=${encodeURIComponent(questionsPath(bill.id))}`);
	const now = nowOf(event);
	const guard = await writeGuard(event, db, user, now, 'staff');
	if (!guard.ok) return { failure: fail(guard.failure.status, { pointMessage: guard.failure.data.message, ...keep }) };
	const role = await pointStaffOf(db, bill, user.id, now, sessionsAt(now).minutes);
	if (role === null) return { failure: fail(403, { pointMessage: ja.post.points.forbidden, ...keep }) };
	if (!pointWindowOpen(progressOf(bill, now).progress)) return { failure: fail(409, { pointMessage: ja.post.points.windowClosed, ...keep }) };
	return { db: db as unknown as BatchDb, bill, now, staff: { userId: user.id, role } };
}

/** 論点を立てる */
export async function openPointAction(event: RequestEvent) {
	const form = await event.request.formData();
	const raw = form.has('title') ? String(form.get('title')) : null;
	const checked = await pointStaff(event, { pointTitle: raw ?? '' });
	if ('failure' in checked) return checked.failure;
	const title = checkPointTitle(raw);
	if (!title.ok) return fail(400, { pointMessage: ja.post.points.errors[title.error], pointTitle: raw ?? '' });
	await openPoint(checked.db, checked.bill.id, title.title, checked.staff, checked.now);
	return { pointDone: ja.post.points.opened };
}

/** 論点を閉じる。番号は法案の中の番号（論点1 なら 1） */
export async function closePointAction(event: RequestEvent) {
	const form = await event.request.formData();
	const checked = await pointStaff(event);
	if ('failure' in checked) return checked.failure;
	const no = parsePointNo(form.has('point') ? String(form.get('point')) : null);
	if (no === null) return fail(400, { pointMessage: ja.post.points.missing });
	const result = await closePoint(checked.db, checked.bill.id, no, checked.staff, checked.now);
	if (result === 'missing') return fail(404, { pointMessage: ja.post.points.missing });
	if (result === 'closed') return fail(409, { pointMessage: ja.post.points.alreadyClosed });
	return { pointDone: ja.post.points.closed };
}
