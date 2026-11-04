// 法案の下書きを作る・直すフォームの受け付け（Issue #46）。確かめる順は課題を書くときと同じ：
// ログイン → 日本から → 締め出し → 登録から7日 → Turnstile → 欄 → 基にした版 → 上限 → 書く
import { fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { ja } from '../copy/ja';
import { billWaitUntil } from '../domain/limits';
import { parseIssueId } from '../domain/issues';
import { checkBillForm, readBillForm, type BillFormErrors, type BillFormValues } from './bill-form';
import { createDraftLimited, saveDraftLimited } from './bills';
import { checkTurnstile, nowOf, refusalMessage, writeGuard } from './client';

export type BillFormFailure = { values: BillFormValues; errors?: BillFormErrors; message?: string };

/** edit は直す法案（呼ぶ側が、提出者で下書きであることを確かめたもの）。null なら新しく作る */
export async function submitBill(event: RequestEvent, user: { id: string; createdAt: Date }, edit: { id: number; kind: string } | null) {
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
	const result = await saveDraftLimited(db, guard.actor, edit.id, rev, checked.input, now);
	if (!result.ok) return refuse(429, { message: refusalMessage(result.refusal) });
	if (!result.saved) return refuse(409, { message: ja.bill.stale });
	redirect(303, `/houan/${edit.id}`);
}
