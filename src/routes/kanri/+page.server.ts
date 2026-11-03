// 運営の画面（設計書 docs/spec/28.md 決めたこと5、docs/spec/30.md 決めたこと3〜5）。運営と運営協力者だけ。ほかの人には表示も操作も 404
import { error, fail, type RequestEvent } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { ja } from '#lib/copy/ja.ts';
import { parseIssueId } from '#lib/domain/issues.ts';
import { HIDEABLE, LISTED, RESTORABLE, validateSolutionAction, validateStaffAction } from '#lib/domain/reports.ts';
import { allowedCountry, clientOf } from '#lib/server/client.ts';
import type { Db } from '#lib/server/law.ts';
import { issueMeta } from '#lib/server/issues.ts';
import { changeStatus, mergeIssue, mergePreview, reportedIssues, roleOf } from '#lib/server/reports.ts';
import { changeSolutionStatus, reportedSolutions, solutionMeta } from '#lib/server/solutions.ts';
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

/** 統合できるかを確かめ、できなければ状態コードと理由を返す（確認の欄と統合の操作で同じ判定を使う） */
async function checkMerge(db: Db, sourceId: number, targetId: number, me: string) {
	const preview = await mergePreview(db, sourceId, targetId);
	const { source, target } = preview;
	if (!source) return { ok: false as const, status: 400, message: ja.kanri.invalid };
	// 元でも統合先でも、自分が書いた課題は扱えない
	if (source.userId === me || target?.userId === me) return { ok: false as const, status: 403, message: ja.kanri.ownIssue };
	if (source.status === 'merged') return { ok: false as const, status: 400, message: ja.merge.mergedOp };
	if (sourceId === targetId) return { ok: false as const, status: 400, message: ja.merge.self };
	if (!LISTED.includes(source.status)) return { ok: false as const, status: 400, message: ja.merge.sourceNotListed };
	if (!target || !LISTED.includes(target.status)) return { ok: false as const, status: 400, message: ja.merge.targetInvalid };
	return { ok: true as const, source, target, supports: preview.supports };
}

export const load: PageServerLoad = async (event) => {
	const { db, staff } = await staffOf(event);
	const params = event.url.searchParams;
	let focus: number | null = null;
	if (params.has('issue')) {
		focus = parseIssueId(params.get('issue') ?? '');
		if (focus === null || !(await issueMeta(db, focus))) error(404);
	}
	// 統合の確認の欄（?issue=[id]&merge=[統合先]）
	let merge = null;
	if (params.has('merge')) {
		const targetId = parseIssueId(params.get('merge') ?? '');
		if (focus === null || targetId === null) error(404);
		const checked = await checkMerge(db, focus, targetId, staff.userId);
		merge = checked.ok
			? { ok: true as const, targetId, source: checked.source.title, target: checked.target.title, supports: checked.supports }
			: { ok: false as const, targetId, error: checked.message };
	}
	// 通報を受けた解決策（?solution=[番号] で、その解決策を上に。設計書 docs/spec/36.md 決めたこと5）
	let focusSolution: number | null = null;
	if (params.has('solution')) {
		focusSolution = parseIssueId(params.get('solution') ?? '');
		if (focusSolution === null || !(await solutionMeta(db, focusSolution))) error(404);
	}
	const rows = await reportedIssues(db, focus);
	const solutionRows = await reportedSolutions(db, focusSolution);
	// 書いた人は渡さず、自分の課題・解決策かどうかだけを渡す
	return {
		rows: rows.map(({ userId, ...r }) => ({ ...r, mine: userId === staff.userId })),
		focus,
		merge,
		solutions: solutionRows.map(({ userId, ...r }) => ({ ...r, mine: userId === staff.userId })),
		focusSolution
	};
};

const act = (action: 'hide' | 'restore' | 'merge') => async (event: RequestEvent) => {
	const { db, staff } = await staffOf(event);
	if (!allowedCountry(clientOf(event).country)) return fail(403, { message: ja.guard.outsideJapan, issueId: null });
	const form = await event.request.formData();
	const field = (name: string) => (form.has(name) ? String(form.get(name)) : null);
	const checked = validateStaffAction({ issue: field('issue'), reason: field('reason'), target: field('target'), note: field('note') }, action);
	if (!checked.ok) return fail(400, { message: ja.kanri.invalid, issueId: null });
	const { issueId, targetId, reason, note } = checked.value;
	const now = Date.now();

	if (action === 'merge') {
		if (targetId === undefined) return fail(400, { message: ja.kanri.invalid, issueId: null });
		const can = await checkMerge(db, issueId, targetId, staff.userId);
		if (!can.ok) return fail(can.status, { message: can.message, issueId });
		// 確かめたあとに状態が変わっていたら（同時の操作）、統合しない
		if (!(await mergeIssue(db, issueId, targetId, staff, note, now))) return fail(400, { message: ja.merge.targetInvalid, issueId });
		return { done: issueId };
	}

	const meta = await issueMeta(db, issueId);
	if (!meta) return fail(400, { message: ja.kanri.invalid, issueId: null });
	if (meta.userId === staff.userId) return fail(403, { message: ja.kanri.ownIssue, issueId });
	if (meta.status === 'merged') return fail(400, { message: ja.merge.mergedOp, issueId });
	const changed =
		action === 'hide'
			? await changeStatus(db, issueId, HIDEABLE, 'hidden', staff, reason, note, now)
			: await changeStatus(db, issueId, RESTORABLE, 'restored', staff, null, note, now);
	if (!changed) {
		return fail(400, { message: action === 'hide' ? ja.kanri.alreadyHidden : ja.kanri.alreadyShown, issueId });
	}
	return { done: issueId };
};

/** 解決策を非表示にする・表示に戻す（設計書 docs/spec/36.md 決めたこと5）。確かめる順は課題と同じ */
const actOnSolution = (action: 'hide' | 'restore') => async (event: RequestEvent) => {
	const { db, staff } = await staffOf(event);
	if (!allowedCountry(clientOf(event).country)) return fail(403, { message: ja.guard.outsideJapan, solutionId: null });
	const form = await event.request.formData();
	const field = (name: string) => (form.has(name) ? String(form.get(name)) : null);
	const checked = validateSolutionAction({ solution: field('solution'), reason: field('reason'), note: field('note') }, action);
	if (!checked.ok) return fail(400, { message: ja.kanri.invalid, solutionId: null });
	const { solutionId, reason, note } = checked.value;
	const meta = await solutionMeta(db, solutionId);
	if (!meta) return fail(400, { message: ja.kanri.invalid, solutionId: null });
	if (meta.userId === staff.userId) return fail(403, { message: ja.kanri.ownSolution, solutionId });
	// 課題が非表示でも、解決策の非表示と表示に戻すはできる
	const changed =
		action === 'hide'
			? await changeSolutionStatus(db, solutionId, HIDEABLE, 'hidden', staff, reason, note, Date.now())
			: await changeSolutionStatus(db, solutionId, RESTORABLE, 'restored', staff, null, note, Date.now());
	if (!changed) {
		return fail(400, { message: action === 'hide' ? ja.kanri.alreadyHidden : ja.kanri.alreadyShown, solutionId });
	}
	return { doneSolution: solutionId };
};

export const actions: Actions = {
	hide: act('hide'),
	restore: act('restore'),
	merge: act('merge'),
	hideSolution: actOnSolution('hide'),
	restoreSolution: actOnSolution('restore')
};
