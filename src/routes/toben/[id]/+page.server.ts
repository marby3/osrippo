// 答弁イベントのページ（Issue #153）と、質問・「わたしも聞きたい」・答弁・通報（Issue #181）
import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { ja } from '#lib/copy/ja.ts';
import { checkText, parseIssueId } from '#lib/domain/issues.ts';
import { billWaitUntil } from '#lib/domain/limits.ts';
import { validateSolutionReport } from '#lib/domain/reports.ts';
import { checkTurnstile, nowOf, refusalMessage, writeGuard } from '#lib/server/client.ts';
import { cancelToben, tobenOf } from '#lib/server/toben.ts';
import {
	askQuestion,
	hasAsked,
	questionsOf,
	reportedTobenIds,
	reportToben,
	TOBEN_ANSWER_MAX,
	TOBEN_QUESTION_MAX,
	tobenEventFor,
	wantQuestion,
	writeAnswer,
	type TobenTarget
} from '#lib/server/toben-questions.ts';
import { legislatorAt } from '#lib/server/verifications.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const id = parseIssueId(event.params.id);
	if (id === null) error(404);
	const db = drizzle(env.DB);
	const now = nowOf(event);
	const user = event.locals.user;
	const e = await tobenOf(db, id, now, user?.id ?? null);
	if (!e) error(404);
	return {
		e,
		questions: await questionsOf(db, id, user?.id ?? null, now),
		// 書く欄を出すかの判断に使う（送ったときの確かめは actions でする）
		me: user
			? {
					asked: await hasAsked(db, id, user.id),
					legislator: await legislatorAt(db, user.id, now),
					waitUntil: billWaitUntil(user.createdAt.getTime(), now),
					reported: await reportedTobenIds(db, user.id, id)
				}
			: null,
		questionMax: TOBEN_QUESTION_MAX,
		answerMax: TOBEN_ANSWER_MAX,
		siteKey: env.TURNSTILE_SITE_KEY
	};
};

function eventId(event: RequestEvent) {
	const id = parseIssueId(event.params.id ?? '');
	if (id === null) error(404);
	return id;
}

function loginFirst(event: RequestEvent, id: number) {
	const user = event.locals.user;
	if (!user) redirect(303, `/login?next=${encodeURIComponent(`/toben/${id}`)}`);
	return user;
}

/** 本文の確かめ。失敗なら画面の文言 */
function bodyError(raw: string, max: number): { body: string; message?: undefined } | { body?: undefined; message: string } {
	const [body, err] = checkText(raw, max, true);
	if (!err) return { body };
	return { message: err === 'tooLong' ? ja.issue.errors.tooLong(max) : ja.issue.errors[err === 'required' ? 'required' : 'control'] };
}

export const actions: Actions = {
	/** 取り消す。告知した議員だけ（選挙期間中の議員は writeGuard の legislator で断る） */
	cancel: async (event) => {
		const id = eventId(event);
		const user = event.locals.user;
		if (!user) error(403);
		const db = drizzle(env.DB);
		const now = nowOf(event);
		const guard = await writeGuard(event, db, user, now, 'legislator');
		if (!guard.ok) return guard.failure;
		const refused = await cancelToben(db, id, user.id, now);
		if (refused === 'missing') error(404);
		if (refused === 'forbidden') return fail(403, { message: ja.toben.errors.forbidden });
		if (refused === 'started' || refused === 'cancelled') return fail(409, { message: ja.toben.errors[refused] });
		return { cancelled: true };
	},

	/** 質問を書く。確かめる順：ログイン → 国 → 締め出し → 議員でない → 登録から7日 → 時期 → 1人1件 → Turnstile → 中身 */
	ask: async (event) => {
		const id = eventId(event);
		const user = loginFirst(event, id);
		const db = drizzle(env.DB);
		const now = nowOf(event);
		const form = await event.request.formData();
		const raw = String(form.get('body') ?? '');
		const keep = { ask: true, questionBody: raw };
		const target = await tobenEventFor(db, id, now);
		if (!target) error(404);
		const guard = await writeGuard(event, db, user, now, 'participate');
		if (!guard.ok) return fail(guard.failure.status, { ...guard.failure.data, ...keep });
		const wait = billWaitUntil(guard.actor.registeredAt, now);
		if (wait !== null) return fail(403, { message: ja.toben.questions.tooNew(wait), ...keep });
		if (target.state !== 'upcoming') return fail(409, { message: target.state === 'cancelled' || target.state === 'stopped' ? ja.toben.questions.errors.notOpen : ja.toben.questions.errors.closed, ...keep });
		if (await hasAsked(db, id, user.id)) return fail(409, { message: ja.toben.questions.errors.already, ...keep });
		if (!(await checkTurnstile(event, String(form.get('cf-turnstile-response') ?? ''), guard.ip))) return fail(400, { message: ja.guard.turnstileFailed, ...keep });
		const checked = bodyError(raw, TOBEN_QUESTION_MAX);
		if (checked.body === undefined) return fail(400, { message: checked.message, ...keep });
		const result = await askQuestion(db, { eventId: id, userId: user.id, body: checked.body }, now);
		if (!result.ok) return fail(409, { message: ja.toben.questions.errors.already, ...keep });
		return { asked: true };
	},

	/** 「わたしも聞きたい」を付ける・外す。外すのは、付けたあとで議員になった人もできる */
	want: async (event) => {
		const id = eventId(event);
		const user = loginFirst(event, id);
		const db = drizzle(env.DB);
		const now = nowOf(event);
		const form = await event.request.formData();
		const questionId = parseIssueId(String(form.get('question') ?? ''));
		const op = form.get('op') === 'remove' ? 'remove' : 'add';
		if (questionId === null) error(400);
		const keep = { wantQuestion: questionId };
		const guard = await writeGuard(event, db, user, now, op === 'remove' ? 'settle' : 'participate');
		if (!guard.ok) return fail(guard.failure.status, { ...guard.failure.data, ...keep });
		const result = await wantQuestion(db, guard.actor, { eventId: id, questionId }, op, now);
		if (result.ok) return { wanted: questionId };
		if ('refusal' in result) return fail(429, { message: refusalMessage(result.refusal), ...keep });
		if (result.reason === 'missing') error(404);
		if (result.reason === 'own') return fail(403, { message: ja.toben.questions.errors.wantOwn, ...keep });
		return fail(409, { message: ja.toben.questions.errors.wantClosed, ...keep });
	},

	/** 答弁を書く・直す。確かめる順：ログイン → 国 → 締め出し → 議員（選挙期間中は断る）→ 告知した議員 → 開催中 → 中身 */
	answer: async (event) => {
		const id = eventId(event);
		const user = loginFirst(event, id);
		const db = drizzle(env.DB);
		const now = nowOf(event);
		const form = await event.request.formData();
		const questionId = parseIssueId(String(form.get('question') ?? ''));
		if (questionId === null) error(400);
		const raw = String(form.get('body') ?? '');
		const keep = { answerQuestion: questionId, answerBody: raw };
		const target = await tobenEventFor(db, id, now);
		if (!target) error(404);
		const guard = await writeGuard(event, db, user, now, 'legislator');
		if (!guard.ok) return fail(guard.failure.status, { ...guard.failure.data, ...keep });
		if (target.userId !== user.id) return fail(403, { message: ja.toben.questions.errors.answerForbidden, ...keep });
		if (target.state !== 'live') return fail(409, { message: ja.toben.questions.errors.answerClosed, ...keep });
		const checked = bodyError(raw, TOBEN_ANSWER_MAX);
		if (checked.body === undefined) return fail(400, { message: checked.message, ...keep });
		const refused = await writeAnswer(db, { eventId: id, questionId, userId: user.id, body: checked.body }, now);
		if (refused === 'missing') error(404);
		if (refused === 'hidden') return fail(409, { message: ja.toben.questions.errors.answerHidden, ...keep });
		return { answered: questionId };
	},

	/** 通報する（質疑の通報と同じ順） */
	report: async (event) => {
		const id = eventId(event);
		const user = loginFirst(event, id);
		const db = drizzle(env.DB);
		const now = nowOf(event);
		const form = await event.request.formData();
		const kind: TobenTarget | null = form.get('kind') === 'question' ? 'question' : form.get('kind') === 'answer' ? 'answer' : null;
		const targetId = parseIssueId(String(form.get('target') ?? ''));
		if (kind === null || targetId === null) error(400);
		const keep = { reportKind: kind, reportTarget: targetId };
		const guard = await writeGuard(event, db, user, now, 'report');
		if (!guard.ok) return fail(guard.failure.status, { ...guard.failure.data, ...keep });
		const checked = validateSolutionReport({ reason: form.has('reason') ? String(form.get('reason')) : null, note: form.has('note') ? String(form.get('note')) : null });
		if (!checked.ok) return fail(400, { message: ja.kanri.invalid, ...keep });
		const result = await reportToben(db, guard.actor, { kind, id: targetId, eventId: id }, checked.value, now);
		if (!result.ok) {
			if (result.reason === 'missing') error(404);
			if (result.reason === 'limit' && 'refusal' in result) return fail(429, { message: refusalMessage(result.refusal), ...keep });
			return fail(403, { message: result.reason === 'own' ? ja.toben.questions.errors.reportOwn : ja.toben.questions.errors.reportHidden, ...keep });
		}
		return { ...keep, reportDone: true };
	}
};
