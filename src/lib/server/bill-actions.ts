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
import { requireUser } from './require-user';

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
	return result.reason === 'author'
		? fail(403, { message: ja.bill.support.author })
		: fail(409, { message: result.reason === 'stale' ? (op === 'add' ? ja.bill.support.stale : ja.bill.support.staleRemove) : ja.bill.support.closed });
}

export async function proposeAction(event: RequestEvent) {
	const { db, bill } = await billOf(event);
	const now = nowOf(event);
	const checked = await billGuard(event, db, now, true);
	if (checked.failure) return checked.failure;
	// 可決しても必ず要調整か廃案になる下書きは断る（docs/spec/72.md の E と B4）
	if (bill.status === 'draft' && bill.userId === checked.actor.userId) {
		const block = await proposeBlock(db, bill);
		if (block) return fail(409, { message: ja.ifLaw.proposeBlocked[block] });
	}
	const { session, previous } = sessionsAt(now);
	const required = proposalRequirement(await sessionParticipants(db, FIRST_COMMITTEE, session, previous, now));
	const result = await proposeBill(db, checked.actor, bill.id, required, now);
	if (result.ok) return { proposed: true };
	return result.reason === 'notAuthor'
		? fail(403, { message: ja.bill.support.notAuthor })
		: fail(409, { message: result.reason === 'short' ? ja.bill.support.short : ja.bill.support.closed });
}
