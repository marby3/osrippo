// 運営の画面（設計書 docs/spec/28.md 決めたこと5、docs/spec/30.md 決めたこと3〜5）。運営と運営協力者と、権限のある委員長と理事（docs/spec/77.md）だけ。ほかの人には表示も操作も 404
import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { ja } from '#lib/copy/ja.ts';
import { checkText, parseIssueId } from '#lib/domain/issues.ts';
import { REVIEW_NOTE_MAX } from '#lib/domain/anomalies.ts';
import { HIDEABLE, LISTED, RESTORABLE, validateAmendmentAction, validatePostAction, validateSolutionAction, validateStaffAction } from '#lib/domain/reports.ts';
import { amendmentStaffAccess, changeAmendmentModeration, reportedAmendments } from '#lib/server/amendment-moderation.ts';
import { staffRoleOf } from '#lib/server/chairs.ts';
import { allowedCountry, clientOf, nowOf, sessionsAt } from '#lib/server/client.ts';
import type { BatchDb, Db } from '#lib/server/law.ts';
import { decideReview, involvedInBill, pendingReviews } from '#lib/server/results.ts';
import { issueMeta } from '#lib/server/issues.ts';
import { changePostStatus, checkMerge as checkQuestionMerge, mergeCandidates, mergeQuestion, mergeWindowOpen, postStaffAccess, reportedPosts } from '#lib/server/post-moderation.ts';
import { changeStatus, mergeIssue, mergePreview, reportedIssues, staffRows } from '#lib/server/reports.ts';
import { changeSolutionStatus, reportedSolutions, solutionMeta } from '#lib/server/solutions.ts';
import { canVerify, parseVerification, verificationLastDay } from '#lib/domain/verification.ts';
import { activeVerificationList, changeVerification, grantVerification } from '#lib/server/verifications.ts';
import type { Actions, PageServerLoad } from './$types';

/** 役職を最初に確かめる（権限のない人に /kanri があることを漏らさない） */
async function staffOf(event: Pick<RequestEvent, 'locals' | 'url' | 'request'>) {
	const db = drizzle(env.DB);
	const user = event.locals.user;
	if (!user) error(404);
	const now = nowOf(event);
	const role = await staffRoleOf(db, user.id, now, sessionsAt(now).minutes);
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
	// 通報を受けた投稿（?post=[番号] で、その投稿を上に。自分のものと関わった法案は 404。設計書 docs/spec/80.md の決定N）
	let focusPost: number | null = null;
	if (params.has('post')) {
		focusPost = parseIssueId(params.get('post') ?? '');
		if (focusPost === null || (await postStaffAccess(db, focusPost, staff)) !== 'ok') error(404);
	}
	// 通報を受けた修正案（?amendment=[番号] で、それを上に。扱えないものは 404。設計書 docs/spec/103.md の決定N）
	let focusAmendment: number | null = null;
	if (params.has('amendment')) {
		focusAmendment = parseIssueId(params.get('amendment') ?? '');
		if (focusAmendment === null || (await amendmentStaffAccess(db, focusAmendment, staff)) !== 'ok') error(404);
	}
	const now = nowOf(event);
	const mergeOpen = focusPost !== null && (await mergeWindowOpen(db, focusPost, now, sessionsAt(now).minutes));
	const rows = await reportedIssues(db, focus);
	const solutionRows = await reportedSolutions(db, focusSolution);
	return {
		rows: staffRows(rows, staff.userId),
		focus,
		merge,
		solutions: staffRows(solutionRows, staff.userId),
		focusSolution,
		posts: await reportedPosts(db, staff, focusPost),
		// まとめる先の候補（docs/spec/104.md の決定V）。時期の外と、質疑でないものには出さない
		mergeOpen,
		mergeCandidates: mergeOpen && focusPost !== null ? await mergeCandidates(db, focusPost, staff) : [],
		justMerged: params.get('matome') === '1',
		focusPost,
		amendments: await reportedAmendments(db, staff, focusAmendment),
		reviews: await pendingReviews(db, staff.userId, staff.role),
		// 議員・有識者の認証（設計書 docs/spec/157.md の 3）。運営でなければ一覧も返さない
		verifications: canVerify(staff.role)
			? (await activeVerificationList(db, now)).map(({ expiresAt, ...v }) => ({ ...v, lastDay: verificationLastDay(expiresAt) }))
			: null
	};
};

/** 認証の操作の前に、運営かを確かめる。ほかの人には 404（欄があることを漏らさない） */
async function verifierOf(event: RequestEvent) {
	const { db, staff } = await staffOf(event);
	if (!canVerify(staff.role)) error(404);
	return { db, staff };
}

const verifyFail = (status: number, message: string) => fail(status, { message, verification: true as const });

/** 認証を付ける（設計書 docs/spec/157.md の 3） */
async function verifyGrant(event: RequestEvent) {
	const { db, staff } = await verifierOf(event);
	if (!allowedCountry(clientOf(event).country)) return verifyFail(403, ja.guard.outsideJapan);
	const form = await event.request.formData();
	const field = (name: string) => (form.has(name) ? String(form.get(name)) : null);
	const parsed = parseVerification({ kind: field('kind'), name: field('name'), field: field('field') });
	if (!parsed.ok) return verifyFail(400, ja.verification.errors[parsed.error]);
	const target = (field('target') ?? '').trim();
	const result = await grantVerification(db as BatchDb, { ...parsed.value, target }, staff.userId, nowOf(event));
	if (!result.ok) return verifyFail(400, ja.verification.errors[result.error]);
	return { verification: true as const, done: true };
}

/** 1年延ばす・取り消す */
const verifyChange = (action: 'renew' | 'revoke') => async (event: RequestEvent) => {
	const { db, staff } = await verifierOf(event);
	if (!allowedCountry(clientOf(event).country)) return verifyFail(403, ja.guard.outsideJapan);
	const form = await event.request.formData();
	const userId = String(form.get('user') ?? '');
	if (!userId || !(await changeVerification(db as BatchDb, action, userId, staff.userId, nowOf(event)))) return verifyFail(400, ja.verification.errors.inactive);
	return { verification: true as const, done: true };
};

const act = (action: 'hide' | 'restore' | 'merge') => async (event: RequestEvent) => {
	const { db, staff } = await staffOf(event);
	if (!allowedCountry(clientOf(event).country)) return fail(403, { message: ja.guard.outsideJapan, issueId: null });
	const form = await event.request.formData();
	const field = (name: string) => (form.has(name) ? String(form.get(name)) : null);
	const checked = validateStaffAction({ issue: field('issue'), reason: field('reason'), target: field('target'), note: field('note') }, action);
	if (!checked.ok) return fail(400, { message: ja.kanri.invalid, issueId: null });
	const { issueId, targetId, reason, note } = checked.value;
	const now = nowOf(event);

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
	const now = nowOf(event);
	const changed =
		action === 'hide'
			? await changeSolutionStatus(db, solutionId, HIDEABLE, 'hidden', staff, reason, note, now)
			: await changeSolutionStatus(db, solutionId, RESTORABLE, 'restored', staff, null, note, now);
	if (!changed) {
		return fail(400, { message: action === 'hide' ? ja.kanri.alreadyHidden : ja.kanri.alreadyShown, solutionId });
	}
	return { doneSolution: solutionId };
};

/** 投稿を非表示にする・表示に戻す（設計書 docs/spec/80.md の決定P）。役職 → 国 → 入力 → 存在 → 自分のもの → 関わり → 状態 */
const actOnPost = (action: 'hide' | 'restore') => async (event: RequestEvent) => {
	const { db, staff } = await staffOf(event);
	if (!allowedCountry(clientOf(event).country)) return fail(403, { message: ja.guard.outsideJapan, postId: null });
	const form = await event.request.formData();
	const field = (name: string) => (form.has(name) ? String(form.get(name)) : null);
	const checked = validatePostAction({ post: field('post'), reason: field('reason'), note: field('note') }, action);
	if (!checked.ok) return fail(400, { message: ja.kanri.invalid, postId: null });
	const { postId, reason, note } = checked.value;
	const access = await postStaffAccess(db, postId, staff);
	if (access === 'missing') return fail(404, { message: ja.kanri.invalid, postId: null });
	if (access === 'own') return fail(403, { message: ja.kanri.ownPost, postId });
	if (access === 'involved') return fail(403, { message: ja.kanri.involvedPost, postId });
	const now = nowOf(event);
	const changed =
		action === 'hide'
			? await changePostStatus(db, postId, HIDEABLE, 'hidden', staff, reason, note, now)
			: await changePostStatus(db, postId, RESTORABLE, 'restored', staff, null, note, now);
	if (!changed) return fail(400, { message: action === 'hide' ? ja.kanri.alreadyHidden : ja.kanri.alreadyShown, postId });
	return { donePost: postId };
};

/** 似た質疑をまとめる（設計書 docs/spec/104.md）。元は消えるので、まとめたら統合先を開く */
const mergePost = async (event: RequestEvent) => {
	const { db, staff } = await staffOf(event);
	if (!allowedCountry(clientOf(event).country)) return fail(403, { message: ja.guard.outsideJapan, postId: null });
	const form = await event.request.formData();
	const field = (name: string) => (form.has(name) ? String(form.get(name)) : null);
	const checked = validateStaffAction({ issue: field('post'), target: field('target'), note: field('note') }, 'merge');
	if (!checked.ok || checked.value.targetId === undefined) return fail(400, { message: ja.kanri.invalid, postId: null });
	const { issueId: postId, targetId, note } = checked.value;
	const now = nowOf(event);
	const can = await checkQuestionMerge(db, postId, targetId, staff, now, sessionsAt(now).minutes);
	if (can === 'missing') return fail(404, { message: ja.kanri.invalid, postId: null });
	if (can === 'own' || can === 'ownTarget') return fail(403, { message: ja.kanri.ownPost, postId });
	if (can === 'involved') return fail(403, { message: ja.kanri.involvedPost, postId });
	if (can === 'closed') return fail(409, { message: ja.kanri.mergeClosed, postId });
	if (can === 'invalid' || !(await mergeQuestion(db as unknown as BatchDb, postId, targetId, staff, note, now))) return fail(400, { message: ja.kanri.mergeInvalid, postId });
	redirect(303, `/kanri?post=${targetId}&matome=1`);
};

/** 修正案を非表示にする・表示に戻す（設計書 docs/spec/103.md の決定P）。役職 → 国 → 入力 → 存在 → 自分のもの → 関わり → 状態 */
const actOnAmendment = (action: 'hide' | 'restore') => async (event: RequestEvent) => {
	const { db, staff } = await staffOf(event);
	if (!allowedCountry(clientOf(event).country)) return fail(403, { message: ja.guard.outsideJapan, amendmentId: null });
	const form = await event.request.formData();
	const field = (name: string) => (form.has(name) ? String(form.get(name)) : null);
	const checked = validateAmendmentAction({ amendment: field('amendment'), reason: field('reason'), note: field('note') }, action);
	if (!checked.ok) return fail(400, { message: ja.kanri.invalid, amendmentId: null });
	const { amendmentId, reason, note } = checked.value;
	const access = await amendmentStaffAccess(db, amendmentId, staff);
	if (access === 'missing') return fail(404, { message: ja.kanri.invalid, amendmentId: null });
	if (access === 'own') return fail(403, { message: ja.kanri.ownAmendment, amendmentId });
	if (access === 'involved') return fail(403, { message: ja.kanri.involvedAmendment, amendmentId });
	const now = nowOf(event);
	const changed =
		action === 'hide'
			? await changeAmendmentModeration(db, amendmentId, HIDEABLE, 'hidden', staff, reason, note, now)
			: await changeAmendmentModeration(db, amendmentId, RESTORABLE, 'restored', staff, null, note, now);
	if (!changed) return fail(400, { message: action === 'hide' ? ja.kanri.alreadyHidden : ja.kanri.alreadyShown, amendmentId });
	return { doneAmendment: amendmentId };
};

/** 結果の確認（docs/spec/73.md 決めたこと7）。確かめの順：役職 → 国 → 入力 → 自分の関わり → 状態 */
const decide = (decision: 'confirm' | 'void') => async (event: RequestEvent) => {
	const { db, staff } = await staffOf(event);
	if (!allowedCountry(clientOf(event).country)) return fail(403, { message: ja.guard.outsideJapan, reviewBill: null });
	const form = await event.request.formData();
	const billId = parseIssueId(String(form.get('bill') ?? ''));
	const sessionKey = String(form.get('session') ?? '');
	const [note, noteError] = checkText(String(form.get('note') ?? ''), REVIEW_NOTE_MAX, true);
	if (billId === null || !sessionKey || (decision === 'void' && noteError)) return fail(400, { message: ja.review.invalid, reviewBill: billId });
	if (await involvedInBill(db, billId, staff.userId, staff.role)) return fail(403, { message: ja.review.involved, reviewBill: billId });
	const now = nowOf(event);
	const done = await decideReview(db as unknown as BatchDb, staff, sessionKey, billId, decision, decision === 'void' ? note : null, now, sessionsAt(now).minutes);
	if (!done) return fail(409, { message: ja.review.closed, reviewBill: billId });
	return { decided: billId };
};

export const actions: Actions = {
	confirmReview: decide('confirm'),
	voidReview: decide('void'),
	hide: act('hide'),
	restore: act('restore'),
	merge: act('merge'),
	hideSolution: actOnSolution('hide'),
	restoreSolution: actOnSolution('restore'),
	hidePost: actOnPost('hide'),
	restorePost: actOnPost('restore'),
	mergeQuestion: mergePost,
	hideAmendment: actOnAmendment('hide'),
	restoreAmendment: actOnAmendment('restore'),
	verifyGrant,
	verifyRenew: verifyChange('renew'),
	verifyRevoke: verifyChange('revoke')
};
