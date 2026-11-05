// 質疑・答弁・補足・立場の受け付け（Issue #66。設計書 docs/spec/66.md 決めたこと4・6）
import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { ja } from '../copy/ja';
import { billProgress, referralSession } from '../domain/bills';
import { evaluationOpen, parseEvaluationKind, parseEvaluationOp, READ_BATCH } from '../domain/evaluations';
import { parseIssueId } from '../domain/issues';
import { billWaitUntil } from '../domain/limits';
import { answererRole, parseStance, postWindowOpen, stanceOpen, validatePost, type PostKind } from '../domain/posts';
import { billById } from './bills';
import { checkTurnstile, nowOf, refusalMessage, sessionsAt, writeGuard } from './client';
import { evaluationTarget, recordViews, setEvaluation } from './evaluations';
import { createPost, isSupporter, questionOf, setStance } from './posts';

/** 送り先の法案。ない番号と下書きは 404（ログインより先に。下書きの有無が他人に分からないように） */
export async function postableBill(event: Pick<RequestEvent, 'params'>) {
	const id = parseIssueId(event.params.id ?? '');
	const db = drizzle(env.DB);
	const bill = id === null ? undefined : await billById(db, id);
	if (!bill || bill.status === 'draft') error(404);
	return { db, bill };
}

/** 質疑のタブの URL。ログインへ送るときの戻り先（?/answer を含めない） */
export const questionsPath = (billId: number) => `/houan/${billId}/shitsugi`;

/** 法案の進みと付託先の会期 */
export function progressOf(bill: { status: 'draft' | 'proposed'; proposedAt: number | null }, now: number) {
	const { minutes } = sessionsAt(now);
	return { progress: billProgress(bill, now, minutes), session: referralSession(bill.proposedAt ?? now, minutes) };
}

/** 書く人の確かめ：ログイン → 国 → 締め出し → 登録から7日 → Turnstile */
async function writer(event: RequestEvent, db: Parameters<typeof writeGuard>[1], billId: number, now: number, form: FormData, keep: Record<string, unknown>) {
	const user = event.locals.user;
	if (!user) redirect(303, `/login?next=${encodeURIComponent(questionsPath(billId))}`);
	const guard = await writeGuard(event, db, user, now);
	if (!guard.ok) return { failure: fail(guard.failure.status, { ...guard.failure.data, ...keep }) };
	const wait = billWaitUntil(guard.actor.registeredAt, now);
	if (wait !== null) return { failure: fail(403, { message: ja.post.tooNew(wait), ...keep }) };
	if (!(await checkTurnstile(event, String(form.get('cf-turnstile-response') ?? ''), guard.ip))) {
		return { failure: fail(400, { message: ja.guard.turnstileFailed, ...keep }) };
	}
	return { actor: guard.actor };
}

/** 質疑を書く。書けたら質疑のタブへ */
export async function questionAction(event: RequestEvent) {
	const { db, bill } = await postableBill(event);
	const now = nowOf(event);
	const form = await event.request.formData();
	const body = String(form.get('body') ?? '');
	const checked = await writer(event, db, bill.id, now, form, { body });
	if (checked.failure) return checked.failure;
	const input = validatePost('question', body);
	if (!input.ok) return fail(400, { error: input.error, body });
	const { progress, session } = progressOf(bill, now);
	if (!postWindowOpen('question', progress)) return fail(409, { message: ja.post.closed, body });
	const { userId } = checked.actor;
	const writerRole = answererRole(bill, userId, await isSupporter(db, bill, userId));
	const result = await createPost(db, checked.actor, { billId: bill.id, sessionKey: session.key, kind: 'question', parentId: null, role: null, body: input.body }, now, writerRole);
	if (!result.ok) return fail(429, { message: refusalMessage(result.refusal), body });
	redirect(303, questionsPath(bill.id));
}

/** 答弁か補足を書く。失敗したら、どの質疑の欄かと入力を返す（そのカードの欄に出す） */
async function replyAction(event: RequestEvent, kind: Extract<PostKind, 'answer' | 'supplement'>) {
	const { db, bill } = await postableBill(event);
	const now = nowOf(event);
	const form = await event.request.formData();
	const body = String(form.get('body') ?? '');
	const questionId = parseIssueId(String(form.get('question') ?? ''));
	const keep = { question: questionId, body };
	const checked = await writer(event, db, bill.id, now, form, keep);
	if (checked.failure) return checked.failure;
	if (questionId === null) error(400);
	const input = validatePost(kind, body);
	if (!input.ok) return fail(400, { error: input.error, ...keep });
	const { progress, session } = progressOf(bill, now);
	if (!postWindowOpen(kind, progress)) return fail(409, { message: ja.post.closed, ...keep });
	const question = await questionOf(db, questionId, bill.id, session.key);
	if (!question) error(404);
	const { userId } = checked.actor;
	const role = answererRole(bill, userId, await isSupporter(db, bill, userId));
	if (kind === 'answer' && role === null) return fail(403, { message: ja.post.notAnswerer, ...keep });
	if (kind === 'answer' && question.userId === userId) return fail(403, { message: ja.post.ownQuestion, ...keep });
	if (kind === 'supplement' && role !== null) return fail(403, { message: ja.post.answererSupplement, ...keep });
	const result = await createPost(db, checked.actor, { billId: bill.id, sessionKey: session.key, kind, parentId: questionId, role: kind === 'answer' ? role : null, body: input.body }, now, role);
	if (!result.ok) return fail(429, { message: refusalMessage(result.refusal), ...keep });
	return { posted: questionId };
}

export const answerAction = (event: RequestEvent) => replyAction(event, 'answer');
export const supplementAction = (event: RequestEvent) => replyAction(event, 'supplement');

/** 立場を変える。登録から7日と Turnstile は要らない（非公開で、回数の上限がある。決めたこと6） */
export async function stanceAction(event: RequestEvent) {
	const { db, bill } = await postableBill(event);
	const user = event.locals.user;
	if (!user) redirect(303, `/login?next=${encodeURIComponent(questionsPath(bill.id))}`);
	const now = nowOf(event);
	const form = await event.request.formData();
	const guard = await writeGuard(event, db, user, now);
	if (!guard.ok) return fail(guard.failure.status, { stanceMessage: guard.failure.data.message });
	const stance = parseStance(form.has('stance') ? String(form.get('stance')) : null);
	if (!stance) error(400);
	const { progress, session } = progressOf(bill, now);
	if (!stanceOpen(progress)) return fail(409, { stanceMessage: ja.post.closed });
	const result = await setStance(db, guard.actor, bill, session, stance, now);
	return result.ok ? { stanceSet: true } : fail(409, { stanceMessage: ja.post.stanceLimit });
}

/** 評価を押す・取り消す。登録から7日は要るが、Turnstile は要らない（docs/spec/67.md 決めたこと2）。失敗したら、どの投稿のボタンかを返す */
export async function evaluationAction(event: RequestEvent) {
	const { db, bill } = await postableBill(event);
	const user = event.locals.user;
	if (!user) redirect(303, `/login?next=${encodeURIComponent(questionsPath(bill.id))}`);
	const now = nowOf(event);
	const form = await event.request.formData();
	const postId = parseIssueId(String(form.get('post') ?? ''));
	const keep = { evaluationPost: postId };
	const guard = await writeGuard(event, db, user, now);
	if (!guard.ok) return fail(guard.failure.status, { ...guard.failure.data, ...keep });
	const wait = billWaitUntil(guard.actor.registeredAt, now);
	if (wait !== null) return fail(403, { message: ja.post.tooNew(wait), ...keep });
	const kind = parseEvaluationKind(form.has('kind') ? String(form.get('kind')) : null);
	const op = parseEvaluationOp(form.has('op') ? String(form.get('op')) : null);
	if (postId === null || kind === null || op === null) error(400);
	const { progress, session } = progressOf(bill, now);
	if (!evaluationOpen(progress)) return fail(409, { message: ja.post.evaluationClosed, ...keep });
	const target = await evaluationTarget(db, postId, { id: bill.id, sessionKey: session.key });
	// 開いたあとで非表示になることもあるので、画面全体をエラーにせず、ボタンの下に理由を出す
	if (!target) return fail(404, { message: ja.post.evaluationGone, ...keep });
	if (target.userId === user.id) return fail(403, { message: ja.post.ownPost, ...keep });
	const role = answererRole(bill, user.id, await isSupporter(db, bill, user.id));
	const result = await setEvaluation(db, guard.actor, { id: postId, billId: bill.id, sessionKey: session.key }, kind, op, role, now);
	if (!result.ok) return fail(429, { message: refusalMessage(result.refusal), ...keep });
	return { evaluated: postId };
}

/** 読んだ記録。応答は画面に出さず、失敗しても画面は黙って捨てる（docs/spec/67.md 決めたこと4）。記録にもレート制限にも数えない */
export async function readAction(event: RequestEvent) {
	const { db, bill } = await postableBill(event);
	const user = event.locals.user;
	if (!user) return fail(401);
	const now = nowOf(event);
	const form = await event.request.formData();
	const guard = await writeGuard(event, db, user, now);
	if (!guard.ok) return fail(guard.failure.status);
	if (billWaitUntil(guard.actor.registeredAt, now) !== null) return fail(403);
	const raw = form.getAll('post');
	if (raw.length === 0 || raw.length > READ_BATCH) error(400);
	const ids = raw.map((v) => parseIssueId(String(v)));
	if (ids.some((id) => id === null)) error(400);
	const { progress, session } = progressOf(bill, now);
	if (!evaluationOpen(progress)) return fail(409);
	const role = answererRole(bill, user.id, await isSupporter(db, bill, user.id));
	await recordViews(db, user.id, { id: bill.id, sessionKey: session.key }, ids as number[], role, now);
	return { read: true };
}
