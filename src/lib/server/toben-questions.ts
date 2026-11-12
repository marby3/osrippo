// 答弁イベントの質問と答弁（Issue #181。#147 の決めること14）。
// 通報で見えなくなる条件は質疑・専門家の解説と同じ（HIDE_THRESHOLD、countsTowardHide）。答弁イベントには「関わった人」がないので、数えない人は登録から24時間の人だけ
import { and, asc, count, countDistinct, desc, eq, gt, inArray, isNotNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { tobenAnswers, tobenEvents, tobenModerationLogs, tobenQuestions, tobenReports, tobenWantLogs, tobenWants, user } from '../db/schema';
import { checkWant, DAY, LIMITS } from '../domain/limits';
import { countsTowardHide, HIDE_THRESHOLD, isHidden, type HideReason, type IssueStatus, type SolutionReportReason } from '../domain/reports';
import { tobenState, type TobenState } from '../domain/toben';
import { refuse, type Actor } from './issues';
import type { BatchDb, Db } from './law';
import { notify } from './notifications';
import { reportsInDay, type Role } from './reports';
import { personOf, verifiedColumns, verifiedJoin, verifiedTable } from './verifications';

export type TobenTarget = 'question' | 'answer';
type Staff = { userId: string; role: Role };
type Status = (typeof tobenQuestions.moderationStatus.enumValues)[number];
const SHOWN: Status[] = ['visible', 'restored'];

/** 質問の長さの上限（質疑の質問と同じ） */
export const TOBEN_QUESTION_MAX = 400;
/** 答弁の長さの上限（質疑の答弁と同じ） */
export const TOBEN_ANSWER_MAX = 800;

/** 書き込みの前に、イベントの告知した議員といまの状態を読む。なければ null */
export async function tobenEventFor(db: Db, id: number, now: number): Promise<{ userId: string; state: TobenState } | null> {
	const [row] = await db
		.select({
			userId: tobenEvents.userId,
			startsAt: tobenEvents.startsAt,
			endsAt: tobenEvents.endsAt,
			cancelledAt: tobenEvents.cancelledAt,
			// 外の表の列は表の名前を付けて書く（付けないと、選挙の表の同じ名前の列と読まれる）
			stopped: sql<number>`EXISTS (SELECT 1 FROM elections e WHERE e.starts_at < toben_events.ends_at AND e.ends_at > toben_events.starts_at)`
		})
		.from(tobenEvents)
		.where(eq(tobenEvents.id, id));
	if (!row) return null;
	return { userId: row.userId, state: tobenState({ startsAt: row.startsAt, endsAt: row.endsAt, cancelledAt: row.cancelledAt, stopped: Boolean(row.stopped) }, now) };
}

/** 質問を書く。1つの回に1人1件（2件目は already）。時期と書く人の確かめは呼ぶ側でする */
export async function askQuestion(db: Db, input: { eventId: number; userId: string; body: string }, now: number) {
	const rows = await db
		.insert(tobenQuestions)
		.values({ eventId: input.eventId, userId: input.userId, body: input.body, createdAt: now })
		.onConflictDoNothing()
		.returning({ id: tobenQuestions.id });
	return rows.length ? { ok: true as const, id: rows[0].id } : { ok: false as const, reason: 'already' as const };
}

/** その人がその回に質問を書いたか */
export async function hasAsked(db: Db, eventId: number, userId: string) {
	return (await db.select({ id: tobenQuestions.id }).from(tobenQuestions).where(and(eq(tobenQuestions.eventId, eventId), eq(tobenQuestions.userId, userId)))).length > 0;
}

/**
 * 「わたしも聞きたい」を付ける・外す。確かめる順：質問がその回のもので見えている → 自分の質問 → 開始の前 → 回数の上限 → 保存。
 * いまと同じ状態への操作は何もせず、数えない（「わかる」と同じ）
 */
export async function wantQuestion(db: Db, actor: Actor, target: { eventId: number; questionId: number }, op: 'add' | 'remove', now: number) {
	const [row] = await db
		.select({ eventId: tobenQuestions.eventId, userId: tobenQuestions.userId, status: tobenQuestions.moderationStatus })
		.from(tobenQuestions)
		.where(eq(tobenQuestions.id, target.questionId));
	if (!row || row.eventId !== target.eventId || isHidden(row.status)) return { ok: false as const, reason: 'missing' as const };
	if (row.userId === actor.userId) return { ok: false as const, reason: 'own' as const };
	if ((await tobenEventFor(db, target.eventId, now))?.state !== 'upcoming') return { ok: false as const, reason: 'closed' as const };
	const mineHere = and(eq(tobenWants.questionId, target.questionId), eq(tobenWants.userId, actor.userId));
	const [current] = await db.select({ n: count() }).from(tobenWants).where(mineHere);
	if ((op === 'add') === current.n > 0) return { ok: true as const };

	const mine = eq(tobenWantLogs.userId, actor.userId);
	const [day] = await db.select({ n: count() }).from(tobenWantLogs).where(and(mine, gt(tobenWantLogs.createdAt, now - DAY)));
	const [burst] = await db.select({ n: count() }).from(tobenWantLogs).where(and(mine, gt(tobenWantLogs.createdAt, now - LIMITS.burstWindow)));
	const addedHere = and(eq(tobenWantLogs.questionId, target.questionId), eq(tobenWantLogs.op, 'add'), gt(tobenWantLogs.createdAt, now - DAY));
	const [others] = await db
		.select({ n: countDistinct(tobenWantLogs.userId) })
		.from(tobenWantLogs)
		.where(and(addedHere, eq(tobenWantLogs.ipHash, actor.ipHash), ne(tobenWantLogs.userId, actor.userId)));
	const [self] = await db.select({ n: count() }).from(tobenWantLogs).where(and(addedHere, mine));
	const refusal = checkWant({ op, accountDay: day.n, accountBurst: burst.n, otherAccountsOnIp: others.n, selfAddedRecently: self.n > 0 });
	if (refusal) return refuse(db, actor, refusal, now);

	const change = op === 'add' ? db.insert(tobenWants).values({ questionId: target.questionId, userId: actor.userId, createdAt: now }).onConflictDoNothing() : db.delete(tobenWants).where(mineHere);
	await (db as BatchDb).batch([change, db.insert(tobenWantLogs).values({ questionId: target.questionId, userId: actor.userId, ipHash: actor.ipHash, op, createdAt: now })] as never);
	return { ok: true as const };
}

/**
 * 答弁を書く・直す。質問ごとに1件。質問がその回のもので見えていること、見えなくなっている答弁は直せないこと（運営の判断を待つ）を確かめる。
 * 告知した議員か・開催中かは呼ぶ側で確かめる。初めて書いたときだけ、質問を書いた人に知らせる
 */
export async function writeAnswer(db: Db, input: { eventId: number; questionId: number; userId: string; body: string }, now: number): Promise<'missing' | 'hidden' | null> {
	const [question] = await db.select({ eventId: tobenQuestions.eventId, status: tobenQuestions.moderationStatus }).from(tobenQuestions).where(eq(tobenQuestions.id, input.questionId));
	if (!question || question.eventId !== input.eventId || isHidden(question.status)) return 'missing';
	const rows = await db
		.insert(tobenAnswers)
		.values({ questionId: input.questionId, userId: input.userId, body: input.body, createdAt: now })
		.onConflictDoUpdate({ target: tobenAnswers.questionId, set: { body: input.body, editedAt: now }, where: inArray(tobenAnswers.moderationStatus, SHOWN) })
		.returning({ createdAt: tobenAnswers.createdAt });
	if (!rows.length) return 'hidden';
	// 直したとき（作った時刻が今回でない）は知らせない。同じ質問への通知は1回だけ（ref は質問の番号）
	if (rows[0].createdAt === now) await notify(db, sql`SELECT user_id FROM toben_questions WHERE id = ${input.questionId}`, 'toben_answered', input.eventId, input.questionId, now);
	return null;
}

export type TobenAnswerView = { id: number; body: string; createdAt: number; editedAt: number | null; hidden: boolean; mine: boolean; person: ReturnType<typeof personOf> };
export type TobenQuestionView = {
	id: number;
	body: string;
	createdAt: number;
	hidden: boolean;
	mine: boolean;
	wants: number;
	wanted: boolean;
	person: ReturnType<typeof personOf>;
	answer: TobenAnswerView | null;
};

/**
 * イベントのページの質問：見えている質問を「わたしも聞きたい」の多い順（同じなら古い順）に。
 * 見えなくなっている質問と答弁は、書いた本人にだけ出す。名前は認証の表示する名前とバッジ（選挙期間中は出さない。#151）。user_id は渡さない
 */
export async function questionsOf(db: Db, eventId: number, viewerId: string | null, now: number): Promise<TobenQuestionView[]> {
	const wants = sql<number>`(SELECT count(*) FROM toben_wants w WHERE w.question_id = toben_questions.id)`;
	const questions = await db
		.select({
			id: tobenQuestions.id,
			body: tobenQuestions.body,
			createdAt: tobenQuestions.createdAt,
			status: tobenQuestions.moderationStatus,
			userId: tobenQuestions.userId,
			wants,
			wanted: viewerId === null ? sql<number>`0` : sql<number>`EXISTS (SELECT 1 FROM toben_wants w WHERE w.question_id = toben_questions.id AND w.user_id = ${viewerId})`,
			name: user.name,
			...verifiedColumns(now)
		})
		.from(tobenQuestions)
		.innerJoin(user, eq(user.id, tobenQuestions.userId))
		.leftJoin(verifiedTable, verifiedJoin(now))
		.where(and(eq(tobenQuestions.eventId, eventId), viewerId === null ? inArray(tobenQuestions.moderationStatus, SHOWN) : or(inArray(tobenQuestions.moderationStatus, SHOWN), eq(tobenQuestions.userId, viewerId))))
		.orderBy(desc(wants), asc(tobenQuestions.createdAt), asc(tobenQuestions.id));
	const answers = questions.length
		? await db
				.select({
					id: tobenAnswers.id,
					questionId: tobenAnswers.questionId,
					body: tobenAnswers.body,
					createdAt: tobenAnswers.createdAt,
					editedAt: tobenAnswers.editedAt,
					status: tobenAnswers.moderationStatus,
					userId: tobenAnswers.userId,
					name: user.name,
					...verifiedColumns(now)
				})
				.from(tobenAnswers)
				.innerJoin(user, eq(user.id, tobenAnswers.userId))
				.leftJoin(verifiedTable, verifiedJoin(now))
				.where(
					and(
						inArray(
							tobenAnswers.questionId,
							questions.map((q) => q.id)
						),
						viewerId === null ? inArray(tobenAnswers.moderationStatus, SHOWN) : or(inArray(tobenAnswers.moderationStatus, SHOWN), eq(tobenAnswers.userId, viewerId))
					)
				)
		: [];
	return questions.map((q) => {
		const a = answers.find((x) => x.questionId === q.id);
		return {
			id: q.id,
			body: q.body,
			createdAt: q.createdAt,
			hidden: isHidden(q.status),
			mine: q.userId === viewerId,
			wants: q.wants,
			wanted: Boolean(q.wanted),
			person: personOf(q),
			answer: a ? { id: a.id, body: a.body, createdAt: a.createdAt, editedAt: a.editedAt, hidden: isHidden(a.status), mine: a.userId === viewerId, person: personOf(a) } : null
		};
	});
}

// 通報と運営の対応

const tableOf = (kind: TobenTarget) => (kind === 'question' ? tobenQuestions : tobenAnswers);

/** 数に入る通報の数 */
const countedReports = (kind: TobenTarget, id: number | SQL) => sql<number>`(SELECT count(*) FROM toben_reports r WHERE r.target_kind = ${kind} AND r.target_id = ${id} AND r.counted = 1)`;

const authorOf = (kind: TobenTarget, id: number) => (kind === 'question' ? sql`SELECT user_id FROM toben_questions WHERE id = ${id}` : sql`SELECT user_id FROM toben_answers WHERE id = ${id}`);

/** 対象の書いた人・状態・回の番号。なければ null */
async function targetRow(db: Db, kind: TobenTarget, id: number) {
	if (kind === 'question') {
		const [row] = await db.select({ userId: tobenQuestions.userId, status: tobenQuestions.moderationStatus, eventId: tobenQuestions.eventId }).from(tobenQuestions).where(eq(tobenQuestions.id, id));
		return row ?? null;
	}
	const [row] = await db
		.select({ userId: tobenAnswers.userId, status: tobenAnswers.moderationStatus, eventId: tobenQuestions.eventId })
		.from(tobenAnswers)
		.innerJoin(tobenQuestions, eq(tobenQuestions.id, tobenAnswers.questionId))
		.where(eq(tobenAnswers.id, id));
	return row ?? null;
}

/**
 * 運営の記録の行を、いま書いた状態の質問・答弁から作る（insert … select。D1 の batch に db.run を入れない）。
 * 状態と時刻が今回のものでなければ（書けなかったら）行は入らない
 */
function logFrom(db: Db, kind: TobenTarget, id: number, action: string, actor: string, actorUserId: string | null, reason: string | null, note: string | null, now: number, status: Status) {
	const from =
		kind === 'question'
			? sql`FROM toben_questions t WHERE t.id = ${id} AND t.moderation_status = ${status} AND t.moderation_changed_at = ${now}`
			: sql`FROM toben_answers t JOIN toben_questions q ON q.id = t.question_id WHERE t.id = ${id} AND t.moderation_status = ${status} AND t.moderation_changed_at = ${now}`;
	return db
		.insert(tobenModerationLogs)
		.select(sql`SELECT NULL, ${kind === 'question' ? sql`t.event_id` : sql`q.event_id`}, ${kind}, t.id, ${action}, ${actor}, ${actorUserId}, ${reason}, ${note}, ${now} ${from}`);
}

const NOTICE = {
	question: { hidden: 'toben_question_hidden', restored: 'toben_question_restored' },
	answer: { hidden: 'toben_answer_hidden', restored: 'toben_answer_restored' }
} as const;

/** 通報する（質疑と同じ順）。対象がその回のもの → 自分のもの → 状態 → 2回目 → 上限 → 保存。3件で自動で非表示にする */
export async function reportToben(db: Db, actor: Actor, target: { kind: TobenTarget; id: number; eventId: number }, value: { reason: SolutionReportReason; note: string | null }, now: number) {
	const row = await targetRow(db, target.kind, target.id);
	if (!row || row.eventId !== target.eventId) return { ok: false as const, reason: 'missing' as const };
	if (row.userId === actor.userId) return { ok: false as const, reason: 'own' as const };
	if (isHidden(row.status)) return { ok: false as const, reason: 'hidden' as const };
	const mine = and(eq(tobenReports.targetKind, target.kind), eq(tobenReports.targetId, target.id), eq(tobenReports.userId, actor.userId));
	if ((await db.select({ id: tobenReports.id }).from(tobenReports).where(mine)).length > 0) return { ok: true as const, already: true };
	if ((await reportsInDay(db, actor.userId, now)) >= LIMITS.reportPerDay) return { ...(await refuse(db, actor, { kind: 'report-day' }, now)), reason: 'limit' as const };
	const inserted = await db
		.insert(tobenReports)
		.values({ targetKind: target.kind, targetId: target.id, userId: actor.userId, reason: value.reason, note: value.note, counted: countsTowardHide(value.reason, actor.registeredAt, now), createdAt: now })
		.onConflictDoNothing()
		.returning({ id: tobenReports.id });
	if (!inserted.length) return { ok: true as const, already: true };
	const table = tableOf(target.kind);
	// 非表示にする文と記録を1つの batch に（片方だけ書かれないように）
	const results = (await (db as BatchDb).batch([
		db
			.update(table)
			.set({ moderationStatus: 'auto_hidden', moderationChangedAt: now })
			.where(and(eq(table.id, target.id), eq(table.moderationStatus, 'visible'), sql`${countedReports(target.kind, target.id)} >= ${HIDE_THRESHOLD}`))
			.returning({ id: table.id }),
		logFrom(db, target.kind, target.id, 'auto_hide', 'auto', null, 'reports', null, now, 'auto_hidden')
	] as never)) as unknown[][];
	if ((results[0] ?? []).length) await notify(db, authorOf(target.kind, target.id), NOTICE[target.kind].hidden, target.eventId, now, now);
	return { ok: true as const, already: false };
}

/** 運営の操作。from のどれかの状態のときだけ to に変え、記録を書く。変わったら true */
export async function changeTobenModeration(db: Db, kind: TobenTarget, id: number, from: IssueStatus[], to: 'hidden' | 'restored', staff: Staff, reason: HideReason | null, note: string, now: number) {
	const table = tableOf(kind);
	const results = (await (db as BatchDb).batch([
		db
			.update(table)
			.set({ moderationStatus: to, moderationChangedAt: now })
			.where(and(eq(table.id, id), inArray(table.moderationStatus, from as Status[])))
			.returning({ id: table.id }),
		logFrom(db, kind, id, to === 'hidden' ? 'hide' : 'restore', staff.role, staff.userId, reason, note, now, to)
	] as never)) as unknown[][];
	if (!(results[0] ?? []).length) return false;
	const row = await targetRow(db, kind, id);
	if (row) await notify(db, authorOf(kind, id), NOTICE[kind][to], row.eventId, now, now);
	return true;
}

/** その質問・答弁を運営として扱えるか：ない番号、自分のもの */
export async function tobenStaffAccess(db: Db, kind: TobenTarget, id: number, staff: Staff): Promise<'missing' | 'own' | 'ok'> {
	const row = await targetRow(db, kind, id);
	if (!row) return 'missing';
	return row.userId === staff.userId ? 'own' : 'ok';
}

/** 運営の画面の一覧：通報を受けた質問と答弁。自動で非表示が先、その中は最後の通報が新しい順に100件。自分のものは除く */
export async function reportedToben(db: Db, staff: Staff) {
	const reasonCount = (r: SolutionReportReason) => sql<number>`coalesce(sum(case when ${tobenReports.reason} = ${r} then 1 else 0 end), 0)`;
	const columns = (kind: TobenTarget) => ({
		total: count(tobenReports.id),
		attack: reasonCount('attack'),
		spam: reasonCount('spam'),
		other: reasonCount('other'),
		none: reasonCount('none'),
		last: sql<number>`max(${tobenReports.createdAt})`,
		kind: sql<TobenTarget>`${kind}`
	});
	const [questionRows, answerRows] = await Promise.all([
		db
			.select({
				id: tobenQuestions.id,
				body: tobenQuestions.body,
				status: tobenQuestions.moderationStatus,
				eventId: tobenQuestions.eventId,
				eventTitle: tobenEvents.title,
				counted: countedReports('question', sql`${tobenQuestions}.id`),
				...columns('question')
			})
			.from(tobenQuestions)
			.innerJoin(tobenEvents, eq(tobenEvents.id, tobenQuestions.eventId))
			.innerJoin(tobenReports, and(eq(tobenReports.targetKind, 'question'), eq(tobenReports.targetId, tobenQuestions.id)))
			.where(ne(tobenQuestions.userId, staff.userId))
			.groupBy(tobenQuestions.id)
			.orderBy(desc(sql`max(${tobenReports.createdAt})`))
			.limit(100),
		db
			.select({
				id: tobenAnswers.id,
				body: tobenAnswers.body,
				status: tobenAnswers.moderationStatus,
				eventId: tobenQuestions.eventId,
				eventTitle: tobenEvents.title,
				counted: countedReports('answer', sql`${tobenAnswers}.id`),
				...columns('answer')
			})
			.from(tobenAnswers)
			.innerJoin(tobenQuestions, eq(tobenQuestions.id, tobenAnswers.questionId))
			.innerJoin(tobenEvents, eq(tobenEvents.id, tobenQuestions.eventId))
			.innerJoin(tobenReports, and(eq(tobenReports.targetKind, 'answer'), eq(tobenReports.targetId, tobenAnswers.id)))
			.where(ne(tobenAnswers.userId, staff.userId))
			.groupBy(tobenAnswers.id)
			.orderBy(desc(sql`max(${tobenReports.createdAt})`))
			.limit(100)
	]);
	const rows = [...questionRows, ...answerRows]
		.sort((a, b) => Number(b.status === 'auto_hidden') - Number(a.status === 'auto_hidden') || b.last - a.last || b.id - a.id)
		.slice(0, 100);
	const notes = rows.length
		? await db
				.select({ kind: tobenReports.targetKind, targetId: tobenReports.targetId, note: tobenReports.note })
				.from(tobenReports)
				.where(and(inArray(tobenReports.targetId, [...new Set(rows.map((r) => r.id))]), isNotNull(tobenReports.note)))
				.orderBy(desc(tobenReports.createdAt))
		: [];
	return rows.map((r) => ({ ...r, notes: notes.filter((n) => n.kind === r.kind && n.targetId === r.id).map((n) => n.note as string) }));
}

/** その人がその回で通報した質問と答弁の番号（通報済みの表示に使う） */
export async function reportedTobenIds(db: Db, userId: string | null, eventId: number) {
	if (userId === null) return { question: [] as number[], answer: [] as number[] };
	const rows = await db
		.select({ kind: tobenReports.targetKind, id: tobenReports.targetId })
		.from(tobenReports)
		.where(
			and(
				eq(tobenReports.userId, userId),
				or(
					and(eq(tobenReports.targetKind, 'question'), sql`${tobenReports.targetId} IN (SELECT id FROM toben_questions WHERE event_id = ${eventId})`),
					and(eq(tobenReports.targetKind, 'answer'), sql`${tobenReports.targetId} IN (SELECT a.id FROM toben_answers a JOIN toben_questions q ON q.id = a.question_id WHERE q.event_id = ${eventId})`)
				)
			)
		);
	return { question: rows.filter((r) => r.kind === 'question').map((r) => r.id), answer: rows.filter((r) => r.kind === 'answer').map((r) => r.id) };
}

const LOG_PAGE_SIZE = 20;

/** 運営の記録の「答弁イベントへの対応」。新しい順 */
export async function tobenModerationLogPage(db: Db, page: number) {
	const rows = await db
		.select({
			id: tobenModerationLogs.id,
			eventId: tobenModerationLogs.eventId,
			title: tobenEvents.title,
			kind: tobenModerationLogs.targetKind,
			action: tobenModerationLogs.action,
			actor: tobenModerationLogs.actor,
			reason: tobenModerationLogs.reason,
			note: tobenModerationLogs.note,
			createdAt: tobenModerationLogs.createdAt
		})
		.from(tobenModerationLogs)
		.innerJoin(tobenEvents, eq(tobenEvents.id, tobenModerationLogs.eventId))
		.orderBy(desc(tobenModerationLogs.createdAt), desc(tobenModerationLogs.id))
		.limit(LOG_PAGE_SIZE + 1)
		.offset((page - 1) * LOG_PAGE_SIZE);
	return { rows: rows.slice(0, LOG_PAGE_SIZE), hasNext: rows.length > LOG_PAGE_SIZE };
}
