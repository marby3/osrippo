// 専門家の解説（Issue #152。#147 の決めること19）。通報で見えなくなる条件は質疑・修正案と同じ（HIDE_THRESHOLD、countsTowardHide、関わった人を数えない）
import { and, asc, count, desc, eq, inArray, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import { billModerationLogs, bills, commentaryReports, expertCommentaries, user } from '../db/schema';
import { LIMITS } from '../domain/limits';
import { countsTowardHide, HIDE_THRESHOLD, isHidden, type HideReason, type IssueStatus, type SolutionReportReason } from '../domain/reports';
import { refuse, type Actor } from './issues';
import type { BatchDb, Db } from './law';
import { notify } from './notifications';
import { reportsInDay, type Role } from './reports';
import { involvedSql } from './results';
import { personOf, verifiedColumns, verifiedJoin, verifiedTable } from './verifications';

type Staff = { userId: string; role: Role };
type Status = (typeof expertCommentaries.moderationStatus.enumValues)[number];

/** 数に入る通報の数。法案の提出者・賛同者・共同提出者の通報は数えない（数えるときに判定する。質疑と同じ） */
const countedReports = (commentaryId: number | SQL) =>
	sql<number>`(SELECT count(*) FROM commentary_reports r JOIN expert_commentaries c ON c.id = r.commentary_id JOIN ${bills} ON ${bills}.id = c.bill_id
		WHERE r.commentary_id = ${commentaryId} AND r.counted = 1 AND NOT ${involvedSql(sql`r.user_id`, 'operator')})`;

const commentaryAuthor = (id: number) => sql`SELECT user_id FROM expert_commentaries WHERE id = ${id}`;

/**
 * 運営の記録の行を、いま書いた状態の解説から作る（insert … select。D1 の batch に db.run を入れない）。
 * 状態と時刻が今回のものでなければ（書けなかったら）行は入らない
 */
function logFrom(db: Db, id: number, action: SQL, actor: SQL, actorUserId: string | null, reason: SQL | null, note: string | null, now: number, status: Status) {
	return db
		.insert(billModerationLogs)
		.select(
			sql`SELECT NULL, bill_id, NULL, ${action}, ${actor}, ${actorUserId}, ${reason ?? sql`NULL`}, ${note}, ${now}, NULL, NULL, id FROM expert_commentaries WHERE id = ${id} AND moderation_status = ${status} AND moderation_changed_at = ${now}`
		);
}

/**
 * 書く・直す。1つの法案に1人1件。見えなくなっている解説は直せない（書いた人にも直させず、運営の判断を待つ）。
 * 書いた（直した）解説の番号を返す。直せなければ null
 */
export async function writeCommentary(db: Db, input: { billId: number; userId: string; body: string }, now: number): Promise<number | null> {
	const rows = await db
		.insert(expertCommentaries)
		.values({ billId: input.billId, userId: input.userId, body: input.body, createdAt: now })
		.onConflictDoUpdate({
			target: [expertCommentaries.billId, expertCommentaries.userId],
			set: { body: input.body, editedAt: now },
			where: inArray(expertCommentaries.moderationStatus, ['visible', 'restored'])
		})
		.returning({ id: expertCommentaries.id });
	return rows[0]?.id ?? null;
}

/** 自分がその法案に書いた解説（直す欄のため） */
export async function myCommentary(db: Db, billId: number, userId: string) {
	const [row] = await db
		.select({ id: expertCommentaries.id, body: expertCommentaries.body, status: expertCommentaries.moderationStatus })
		.from(expertCommentaries)
		.where(and(eq(expertCommentaries.billId, billId), eq(expertCommentaries.userId, userId)));
	return row ?? null;
}

/**
 * 法案のページの「専門家の解説」：見えている解説を書いた順に。見えなくなっている解説は、書いた本人にだけ出す。
 * 名前は認証の表示する名前とバッジ（選挙期間中は出さない。#151）。user_id は渡さない
 */
export async function commentariesOf(db: Db, billId: number, viewerId: string | null, now: number) {
	const rows = await db
		.select({
			id: expertCommentaries.id,
			body: expertCommentaries.body,
			createdAt: expertCommentaries.createdAt,
			editedAt: expertCommentaries.editedAt,
			status: expertCommentaries.moderationStatus,
			userId: expertCommentaries.userId,
			name: user.name,
			...verifiedColumns(now)
		})
		.from(expertCommentaries)
		.innerJoin(user, eq(user.id, expertCommentaries.userId))
		.leftJoin(verifiedTable, verifiedJoin(now))
		.where(and(eq(expertCommentaries.billId, billId), or(inArray(expertCommentaries.moderationStatus, ['visible', 'restored']), viewerId === null ? sql`0` : eq(expertCommentaries.userId, viewerId))))
		.orderBy(asc(expertCommentaries.createdAt), asc(expertCommentaries.id));
	return rows.map((r) => ({
		id: r.id,
		body: r.body,
		createdAt: r.createdAt,
		editedAt: r.editedAt,
		hidden: isHidden(r.status),
		mine: r.userId === viewerId,
		person: personOf(r)
	}));
}

/** 通報する（質疑と同じ順）。解説がその法案のものか → 自分のもの → 状態 → 2回目 → 上限 → 保存。3件で自動で非表示にする */
export async function reportCommentary(db: Db, actor: Actor, target: { id: number; billId: number }, value: { reason: SolutionReportReason; note: string | null }, now: number) {
	const [row] = await db
		.select({ billId: expertCommentaries.billId, userId: expertCommentaries.userId, status: expertCommentaries.moderationStatus })
		.from(expertCommentaries)
		.where(eq(expertCommentaries.id, target.id));
	if (!row || row.billId !== target.billId) return { ok: false as const, reason: 'missing' as const };
	if (row.userId === actor.userId) return { ok: false as const, reason: 'own' as const };
	if (isHidden(row.status)) return { ok: false as const, reason: 'hidden' as const };
	const mine = and(eq(commentaryReports.commentaryId, target.id), eq(commentaryReports.userId, actor.userId));
	if ((await db.select({ id: commentaryReports.id }).from(commentaryReports).where(mine)).length > 0) return { ok: true as const, already: true };
	if ((await reportsInDay(db, actor.userId, now)) >= LIMITS.reportPerDay) return { ...(await refuse(db, actor, { kind: 'report-day' }, now)), reason: 'limit' as const };
	const inserted = await db
		.insert(commentaryReports)
		.values({ commentaryId: target.id, userId: actor.userId, reason: value.reason, note: value.note, counted: countsTowardHide(value.reason, actor.registeredAt, now), createdAt: now })
		.onConflictDoNothing()
		.returning({ id: commentaryReports.id });
	if (!inserted.length) return { ok: true as const, already: true };
	// 非表示にする文と記録を1つの batch に（片方だけ書かれないように）。記録は今回の非表示が書いた行（状態と時刻）からだけ作る
	const results = (await (db as BatchDb).batch([
		db
			.update(expertCommentaries)
			.set({ moderationStatus: 'auto_hidden', moderationChangedAt: now })
			.where(and(eq(expertCommentaries.id, target.id), eq(expertCommentaries.moderationStatus, 'visible'), sql`${countedReports(target.id)} >= ${HIDE_THRESHOLD}`))
			.returning({ id: expertCommentaries.id }),
		logFrom(db, target.id, sql`'auto_hide'`, sql`'auto'`, null, sql`'reports'`, null, now, 'auto_hidden')
	] as never)) as unknown[][];
	if ((results[0] ?? []).length) await notify(db, commentaryAuthor(target.id), 'commentary_hidden', target.billId, now, now);
	return { ok: true as const, already: false };
}

/** 運営の操作。from のどれかの状態のときだけ to に変え、記録を書く。変わったら true */
export async function changeCommentaryModeration(db: Db, id: number, from: IssueStatus[], to: 'hidden' | 'restored', staff: Staff, reason: HideReason | null, note: string, now: number) {
	const results = (await (db as BatchDb).batch([
		db
			.update(expertCommentaries)
			.set({ moderationStatus: to, moderationChangedAt: now })
			.where(and(eq(expertCommentaries.id, id), inArray(expertCommentaries.moderationStatus, from as Status[])))
			.returning({ billId: expertCommentaries.billId }),
		logFrom(db, id, sql`${to === 'hidden' ? 'hide' : 'restore'}`, sql`${staff.role}`, staff.userId, reason === null ? null : sql`${reason}`, note, now, to)
	] as never)) as { billId: number }[][];
	const changed = results[0] ?? [];
	if (!changed.length) return false;
	await notify(db, commentaryAuthor(id), to === 'hidden' ? 'commentary_hidden' : 'commentary_restored', changed[0].billId, now, now);
	return true;
}

/** その解説を運営として扱えるか：ない番号、自分のもの、法案に関わっている */
export async function commentaryStaffAccess(db: Db, id: number, staff: Staff): Promise<'missing' | 'own' | 'involved' | 'ok'> {
	const [row] = await db
		.select({ userId: expertCommentaries.userId, involved: involvedSql(staff.userId, staff.role) })
		.from(expertCommentaries)
		.innerJoin(bills, eq(bills.id, expertCommentaries.billId))
		.where(eq(expertCommentaries.id, id));
	if (!row) return 'missing';
	if (row.userId === staff.userId) return 'own';
	return row.involved ? 'involved' : 'ok';
}

/** 運営の画面の一覧：通報を受けた解説。自動で非表示が先、その中は最後の通報が新しい順に100件。扱えないもの（自分のもの、関わった法案）は除く */
export async function reportedCommentaries(db: Db, staff: Staff) {
	const reasonCount = (r: SolutionReportReason) => sql<number>`coalesce(sum(case when ${commentaryReports.reason} = ${r} then 1 else 0 end), 0)`;
	const rows = await db
		.select({
			id: expertCommentaries.id,
			body: expertCommentaries.body,
			status: expertCommentaries.moderationStatus,
			billId: expertCommentaries.billId,
			billTitle: bills.title,
			total: count(commentaryReports.id),
			counted: countedReports(sql`${expertCommentaries}.id`),
			attack: reasonCount('attack'),
			spam: reasonCount('spam'),
			other: reasonCount('other'),
			none: reasonCount('none')
		})
		.from(expertCommentaries)
		.innerJoin(bills, eq(bills.id, expertCommentaries.billId))
		.innerJoin(commentaryReports, eq(commentaryReports.commentaryId, expertCommentaries.id))
		.where(and(sql`${expertCommentaries.userId} <> ${staff.userId}`, sql`NOT ${involvedSql(staff.userId, staff.role)}`))
		.groupBy(expertCommentaries.id)
		.orderBy(desc(sql`${expertCommentaries.moderationStatus} = 'auto_hidden'`), desc(sql`max(${commentaryReports.createdAt})`), desc(expertCommentaries.id))
		.limit(100);
	const notes = rows.length
		? await db
				.select({ commentaryId: commentaryReports.commentaryId, note: commentaryReports.note })
				.from(commentaryReports)
				.where(and(sql`commentary_id IN (SELECT value FROM json_each(${JSON.stringify(rows.map((r) => r.id))}))`, isNotNull(commentaryReports.note)))
				.orderBy(desc(commentaryReports.createdAt))
		: [];
	return rows.map((r) => ({ ...r, notes: notes.filter((n) => n.commentaryId === r.id).map((n) => n.note as string) }));
}

/** その人がその法案で通報した解説の番号（通報済みの表示に使う） */
export async function reportedCommentaryIds(db: Db, userId: string | null, billId: number) {
	if (userId === null) return [];
	const rows = await db
		.select({ id: commentaryReports.commentaryId })
		.from(commentaryReports)
		.innerJoin(expertCommentaries, eq(expertCommentaries.id, commentaryReports.commentaryId))
		.where(and(eq(commentaryReports.userId, userId), eq(expertCommentaries.billId, billId)));
	return rows.map((r) => r.id);
}

