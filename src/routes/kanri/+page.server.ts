// 運営の画面（設計書 docs/spec/28.md 決めたこと5）。運営と運営協力者だけ。ほかの人には表示も操作も 404
import { error, fail, type RequestEvent } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { ja } from '#lib/copy/ja.ts';
import { parseIssueId } from '#lib/domain/issues.ts';
import { HIDEABLE, RESTORABLE, validateStaffAction } from '#lib/domain/reports.ts';
import { allowedCountry, clientOf } from '#lib/server/client.ts';
import { issueMeta } from '#lib/server/issues.ts';
import { changeStatus, reportedIssues, roleOf } from '#lib/server/reports.ts';
import type { Actions, PageServerLoad } from './$types';

/** 役職を最初に確かめる（権限のない人に /kanri があることを漏らさない） */
async function staffOf(event: Pick<RequestEvent, 'locals'>) {
	const db = drizzle(env.DB);
	const user = event.locals.user;
	if (!user) error(404);
	const role = await roleOf(db, user.id);
	if (!role) error(404);
	return { db, staff: { userId: user.id, role } };
}

export const load: PageServerLoad = async (event) => {
	const { db, staff } = await staffOf(event);
	const raw = event.url.searchParams.get('issue');
	let focus: number | null = null;
	if (raw !== null) {
		focus = parseIssueId(raw);
		if (focus === null || !(await issueMeta(db, focus))) error(404);
	}
	const rows = await reportedIssues(db, focus);
	// 書いた人は渡さず、自分の課題かどうかだけを渡す
	return { rows: rows.map(({ userId, ...r }) => ({ ...r, mine: userId === staff.userId })), focus };
};

const act = (action: 'hide' | 'restore') => async (event: RequestEvent) => {
	const { db, staff } = await staffOf(event);
	if (!allowedCountry(clientOf(event).country)) return fail(403, { message: ja.guard.outsideJapan, issueId: null });
	const form = await event.request.formData();
	const checked = validateStaffAction(
		{
			issue: form.has('issue') ? String(form.get('issue')) : null,
			reason: form.has('reason') ? String(form.get('reason')) : null,
			note: form.has('note') ? String(form.get('note')) : null
		},
		action
	);
	if (!checked.ok) return fail(400, { message: ja.kanri.invalid, issueId: null });
	const { issueId, reason, note } = checked.value;
	const meta = await issueMeta(db, issueId);
	if (!meta) return fail(400, { message: ja.kanri.invalid, issueId: null });
	if (meta.userId === staff.userId) return fail(403, { message: ja.kanri.ownIssue, issueId });
	const changed =
		action === 'hide'
			? await changeStatus(db, issueId, HIDEABLE, 'hidden', staff, reason, note, Date.now())
			: await changeStatus(db, issueId, RESTORABLE, 'restored', staff, null, note, Date.now());
	if (!changed) {
		return fail(400, { message: action === 'hide' ? ja.kanri.alreadyHidden : ja.kanri.alreadyShown, issueId });
	}
	return { done: issueId };
};

export const actions: Actions = { hide: act('hide'), restore: act('restore') };
