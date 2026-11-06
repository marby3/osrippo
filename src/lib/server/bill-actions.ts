// 法案の下書きを作る・直すフォームの受け付け（Issue #46）。確かめる順は課題を書くときと同じ：
// ログイン → 日本から → 締め出し → 登録から7日 → Turnstile → 欄 → 基にした版 → 上限 → 書く
import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { ja } from '../copy/ja';
import { proposalRequirement } from '../domain/bills';
import { billWaitUntil } from '../domain/limits';
import { parseIssueId } from '../domain/issues';
import { checkBillForm, FIRST_COMMITTEE, readBillForm, type BillFormErrors, type BillFormValues } from './bill-form';
import { billById, createDraftLimited, proposeBill, saveDraftLimited, sessionParticipants, setBillSupport, type Bill } from './bills';
import { checkTurnstile, nowOf, refusalMessage, sessionsAt, writeGuard } from './client';
import { proposeBlock, saveAdjustedBill, staleArticles } from './if-world';
import type { BatchDb, Db } from './law';
import { cancelCosponsorRequest, decideCosponsor, leaveCosponsor, requestCosponsor } from './cosponsors';
import { cancelMerge, consentMerge, createMerge, mergeBlock, revokeMerge } from './merge';
import { requireUser } from './require-user';
import { cancelWithdraw, consentWithdraw } from './withdraw';
import { billStageNow } from './results';
import { resubmitBill, resubmitStateOf } from './resubmit';

export type BillFormFailure = { values: BillFormValues; errors?: BillFormErrors; message?: string; conflicts?: Awaited<ReturnType<typeof staleArticles>> };

/** edit は直す法案（呼ぶ側が、提出者で下書きか要調整であることを確かめたもの）。null なら新しく作る */
export async function submitBill(event: RequestEvent, user: { id: string; createdAt: Date }, edit: (NonNullable<Bill> & { adjusting: boolean }) | null) {
	const db = drizzle(env.DB);
	const now = nowOf(event);
	const form = await event.request.formData();
	const values = readBillForm(form);
	const refuse = (status: number, data: Omit<BillFormFailure, 'values'>) => fail(status, { values, ...data } satisfies BillFormFailure);

	const guard = await writeGuard(event, db, user, now);
	if (!guard.ok) return refuse(guard.failure.status, guard.failure.data);
	const wait = billWaitUntil(guard.actor.registeredAt, now);
	if (wait !== null) return refuse(403, { message: ja.bill.tooNew(wait) });
	if (!(await checkTurnstile(event, String(form.get('cf-turnstile-response') ?? ''), guard.ip))) {
		return refuse(400, { message: ja.guard.turnstileFailed });
	}
	// 種類は作ったあとは変えない（docs/spec/45.md 決めたこと1）
	if (edit && values.kind !== edit.kind) return refuse(400, { message: ja.bill.formInvalid });
	const checked = await checkBillForm(db, values);
	if (!checked.ok) return refuse(checked.status, { errors: checked.errors, message: checked.errors.message });

	if (!edit) {
		const result = await createDraftLimited(db, guard.actor, checked.input, now);
		if (!result.ok) return refuse(429, { message: refusalMessage(result.refusal) });
		redirect(303, `/houan/${result.id}`);
	}
	const rev = parseIssueId(String(form.get('rev') ?? ''));
	if (rev === null) return refuse(400, { message: ja.bill.formInvalid });
	// 基にしたあとで変わった条に触れるなら、いまの条文を確かめてもらう（docs/spec/72.md の B2）
	const [saved] = edit.laws;
	const [next] = checked.input.laws;
	if (saved && next && saved.lawId === next.lawId) {
		const conflicts = await staleArticles(db, { ...saved, changes: next.changes });
		if (conflicts.length && form.get('confirmConflicts') !== 'on') return refuse(400, { conflicts, message: ja.ifLaw.confirmRequired });
	}
	if (edit.adjusting) {
		const result = await saveAdjustedBill(db as unknown as BatchDb, guard.actor, edit, rev, checked.input, now);
		if (!result.ok) return 'refusal' in result ? refuse(429, { message: refusalMessage(result.refusal) }) : refuse(400, { message: ja.ifLaw.locked });
		if (!result.saved) return refuse(409, { message: ja.bill.stale });
		redirect(303, `/houan/${edit.id}`);
	}
	const result = await saveDraftLimited(db, guard.actor, edit.id, rev, checked.input, now);
	if (!result.ok) return refuse(429, { message: refusalMessage(result.refusal) });
	if (!result.saved) return refuse(409, { message: ja.bill.stale });
	redirect(303, `/houan/${edit.id}`);
}

// ---- 賛同と発議（Issue #49。設計書 docs/spec/49.md） ----

/** 送り先の法案。形が違う番号、ない番号、作りかけは 404（ログインより先に） */
async function billOf(event: RequestEvent) {
	const id = parseIssueId(event.params.id ?? '');
	const db = drizzle(env.DB);
	const bill = id === null ? undefined : await billById(db, id);
	if (!bill) error(404);
	return { db, bill };
}

/** 確かめる順：ログイン → 日本から → 締め出し → 登録から7日 */
async function billGuard(event: RequestEvent, db: Db, now: number, checkAge: boolean) {
	const user = requireUser(event);
	const guard = await writeGuard(event, db, user, now);
	if (!guard.ok) return { failure: fail(guard.failure.status, guard.failure.data) };
	const wait = checkAge ? billWaitUntil(guard.actor.registeredAt, now) : null;
	if (wait !== null) return { failure: fail(403, { message: ja.bill.support.tooNew(wait) }) };
	return { actor: guard.actor };
}

export async function supportAction(event: RequestEvent) {
	const { db, bill } = await billOf(event);
	const now = nowOf(event);
	const form = await event.request.formData();
	const op = form.get('op');
	const checked = await billGuard(event, db, now, op !== 'remove');
	if (checked.failure) return checked.failure;
	const rev = parseIssueId(String(form.get('rev') ?? ''));
	if ((op !== 'add' && op !== 'remove') || rev === null) return fail(400, { message: ja.bill.formInvalid });
	const result = await setBillSupport(db, checked.actor, bill.id, rev, op, now);
	if (result.ok) return { supported: op === 'add' };
	if ('refusal' in result) return fail(429, { message: refusalMessage(result.refusal) });
	if (result.reason === 'cosponsor' || result.reason === 'formerCosponsor') return fail(403, { message: ja.bill.cosponsor[result.reason] });
	return result.reason === 'author'
		? fail(403, { message: ja.bill.support.author })
		: fail(409, { message: result.reason === 'stale' ? (op === 'add' ? ja.bill.support.stale : ja.bill.support.staleRemove) : ja.bill.support.closed });
}

const COSPONSOR_OPS = ['request', 'cancel', 'accept', 'decline', 'leave', 'remove'] as const;
type CosponsorOp = (typeof COSPONSOR_OPS)[number];

/** 共同提出者の操作（docs/spec/76.md 決めたこと7）。相手は行の番号で指し、他人の内部IDをページに載せない */
export async function cosponsorAction(event: RequestEvent) {
	const { db, bill } = await billOf(event);
	const now = nowOf(event);
	const form = await event.request.formData();
	const op = String(form.get('op') ?? '');
	const checked = await billGuard(event, db, now, op === 'request');
	if (checked.failure) return checked.failure;
	if (!(COSPONSOR_OPS as readonly string[]).includes(op)) return fail(400, { message: ja.bill.formInvalid });
	const id = parseIssueId(String(form.get('id') ?? ''));
	const needsId = op === 'accept' || op === 'decline' || op === 'remove';
	const needsConfirm = op === 'leave' || op === 'remove';
	if ((needsId && id === null) || (needsConfirm && form.get('confirm') !== 'on')) return fail(400, { message: ja.bill.formInvalid });
	const refused = (reason: Exclude<import('./cosponsors').CosponsorRefused, never>) =>
		fail(reason === 'forbidden' || reason === 'author' ? 403 : 409, { message: ja.bill.cosponsor.refused[reason] });
	const actor = checked.actor;
	switch (op as CosponsorOp) {
		case 'request': {
			const result = await requestCosponsor(db, actor, bill, now);
			if (result.ok) return { cosponsor: true };
			return 'refusal' in result ? fail(429, { message: refusalMessage(result.refusal) }) : refused(result.reason);
		}
		case 'cancel':
			return (await cancelCosponsorRequest(db, actor, bill)) ? { cosponsor: true } : refused('closed');
		case 'accept':
		case 'decline': {
			const result = await decideCosponsor(db as unknown as BatchDb, actor, bill, id as number, op as 'accept' | 'decline', now);
			return result.ok ? { cosponsor: true } : refused(result.reason);
		}
		case 'leave':
		case 'remove': {
			const result = await leaveCosponsor(db, actor, bill, op === 'remove' ? id : null);
			return result.ok ? { cosponsor: true } : refused(result.reason);
		}
	}
}

/** 撤回の同意と取り消し（docs/spec/76.md 決めたこと12） */
export async function withdrawAction(event: RequestEvent) {
	const { db, bill } = await billOf(event);
	const now = nowOf(event);
	const form = await event.request.formData();
	const checked = await billGuard(event, db, now, false);
	if (checked.failure) return checked.failure;
	const op = form.get('op');
	if ((op !== 'consent' && op !== 'cancel') || (op === 'consent' && form.get('confirm') !== 'on')) return fail(400, { message: ja.bill.formInvalid });
	if (op === 'cancel') return (await cancelWithdraw(db, checked.actor, bill)) ? { withdraw: true } : fail(409, { message: ja.bill.withdraw.closed });
	const result = await consentWithdraw(db as unknown as BatchDb, checked.actor, bill, now, sessionsAt(now).minutes);
	if (result.ok) return { withdraw: true };
	return result.reason === 'forbidden' ? fail(403, { message: ja.bill.withdraw.forbidden }) : fail(409, { message: ja.bill.withdraw.closed });
}

/** 統合案の操作（docs/spec/76.md 決めたこと13）。どの法案かは URL の番号で決まる */
export async function mergeAction(event: RequestEvent) {
	const { db, bill } = await billOf(event);
	const now = nowOf(event);
	const form = await event.request.formData();
	const op = form.get('op');
	const checked = await billGuard(event, db, now, op === 'create');
	if (checked.failure) return checked.failure;
	const refused = (reason: 'forbidden' | 'closed' | 'stale' | 'full') => fail(reason === 'forbidden' ? 403 : 409, { message: ja.bill.merge.refused[reason] });
	if (op === 'create') {
		const withId = parseIssueId(String(form.get('with') ?? ''));
		if (withId === null) return fail(400, { message: ja.bill.formInvalid });
		const result = await createMerge(db, checked.actor, bill, withId, now, sessionsAt(now).minutes);
		if (!result.ok) return 'refusal' in result ? fail(429, { message: refusalMessage(result.refusal) }) : refused(result.reason);
		redirect(303, `/houan/${result.id}`);
	}
	if (op === 'consent') {
		const rev = parseIssueId(String(form.get('rev') ?? ''));
		if (rev === null || form.get('confirm') !== 'on') return fail(400, { message: ja.bill.formInvalid });
		const result = await consentMerge(db as unknown as BatchDb, checked.actor, bill, rev, now);
		return result.ok ? { merge: true } : refused(result.reason);
	}
	if (op === 'revoke') return (await revokeMerge(db, checked.actor, bill)) ? { merge: true } : refused('closed');
	if (op === 'cancel') return (await cancelMerge(db as unknown as BatchDb, checked.actor, bill)) ? { merge: true } : bill.userId !== checked.actor.userId ? refused('forbidden') : refused('closed');
	return fail(400, { message: ja.bill.formInvalid });
}

/** 出し直し（docs/spec/75.md 決めたこと4）。作れたら新しい下書きへ、すでに出し直した法案があればそこへ移る */
export async function resubmitAction(event: RequestEvent) {
	const { db, bill } = await billOf(event);
	const now = nowOf(event);
	const checked = await billGuard(event, db, now, true);
	if (checked.failure) return checked.failure;
	if (bill.userId !== checked.actor.userId) return fail(403, { message: ja.bill.resubmit.notAuthor });
	// 受け付けが最初の読み手でも、結果を確定して修正案を当てたあとの中身を複製する
	const view = await billStageNow(db as unknown as BatchDb, bill, now, sessionsAt(now).minutes);
	const { can } = await resubmitStateOf(db, view.bill, view.stage);
	if (!can) return fail(409, { message: ja.bill.resubmit.closed });
	const result = await resubmitBill(db, checked.actor, view.bill, now);
	if (!result.ok) return fail(429, { message: refusalMessage(result.refusal) });
	redirect(303, `/houan/${result.id}`);
}

export async function proposeAction(event: RequestEvent) {
	const { db, bill } = await billOf(event);
	const now = nowOf(event);
	const checked = await billGuard(event, db, now, true);
	if (checked.failure) return checked.failure;
	// 読んだ版（docs/spec/76.md 決めたこと9）。編集する人が複数なので、提出者が読んでいない版を発議しない
	const rev = parseIssueId(String((await event.request.formData()).get('rev') ?? ''));
	if (rev === null) return fail(400, { message: ja.bill.formInvalid });
	const { session, previous, minutes } = sessionsAt(now);
	// 可決しても必ず要調整か廃案になる下書きは断る（docs/spec/72.md の E と B4）
	if (bill.status === 'draft' && bill.userId === checked.actor.userId) {
		if (bill.rev !== rev) return fail(409, { message: ja.bill.staleRead });
		const block = await proposeBlock(db, bill);
		if (block) return fail(409, { message: ja.ifLaw.proposeBlocked[block] });
		const mergeRefused = await mergeBlock(db, bill, now, minutes);
		if (mergeRefused) return fail(409, { message: ja.bill.merge[mergeRefused] });
	}
	const required = proposalRequirement(await sessionParticipants(db, FIRST_COMMITTEE, session, previous, now));
	const result = await proposeBill(db, checked.actor, bill.id, rev, required, now, minutes);
	if (result.ok) return { proposed: true };
	if (result.reason === 'stale') return fail(409, { message: ja.bill.staleRead });
	if (result.reason === 'merge' || result.reason === 'mergeClosed') return fail(409, { message: ja.bill.merge[result.reason] });
	return result.reason === 'notAuthor'
		? fail(403, { message: ja.bill.support.notAuthor })
		: fail(409, { message: result.reason === 'short' ? ja.bill.support.short : ja.bill.support.closed });
}
