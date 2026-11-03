// 通報と非表示、運営の画面と記録の DB（設計書 docs/spec/28.md）
import { and, count, desc, eq, gt, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { issues, moderationLogs, reports, user, type ROLES } from '../db/schema';
import { PAGE_SIZE } from '../domain/issues';
import { DAY, LIMITS } from '../domain/limits';
import {
	countsTowardHide,
	HIDE_THRESHOLD,
	type HideReason,
	type IssueStatus,
	type ReportReason
} from '../domain/reports';
import { refuse, type Actor } from './issues';
import type { Db } from './law';

export type Role = (typeof ROLES)[number];

/** 役職。Better Auth のセッションには載せず、D1 から読む */
export async function roleOf(db: Db, userId: string): Promise<Role | null> {
	const [row] = await db.select({ role: user.role }).from(user).where(eq(user.id, userId));
	return row?.role ?? null;
}

export async function hasReported(db: Db, issueId: number, userId: string) {
	const [row] = await db
		.select({ n: count() })
		.from(reports)
		.where(and(eq(reports.issueId, issueId), eq(reports.userId, userId)));
	return row.n > 0;
}

/** 通報する。2回目は何もせず already。保存したら自動非表示を確かめる */
export async function reportIssue(
	db: Db,
	actor: Actor,
	issueId: number,
	value: { reason: ReportReason; note: string | null },
	now: number
) {
	if (await hasReported(db, issueId, actor.userId)) return { ok: true as const, already: true };
	const [mine] = await db
		.select({ n: count() })
		.from(reports)
		.where(and(eq(reports.userId, actor.userId), gt(reports.createdAt, now - DAY)));
	if (mine.n >= LIMITS.reportPerDay) return refuse(db, actor, { kind: 'report-day' }, now);

	const inserted = await db
		.insert(reports)
		.values({
			issueId,
			userId: actor.userId,
			reason: value.reason,
			note: value.note,
			counted: countsTowardHide(value.reason, actor.registeredAt, now),
			createdAt: now
		})
		.onConflictDoNothing()
		.returning({ id: reports.id });
	if (inserted.length === 0) return { ok: true as const, already: true };

	// 数に入る通報が3件以上で、表示中（visible）の課題だけを自動で非表示にする。記録はトリガーが書く
	await db
		.update(issues)
		.set({
			status: 'auto_hidden',
			statusActor: 'auto',
			statusActorUserId: null,
			statusReason: 'reports',
			statusNote: null,
			statusChangedAt: now
		})
		.where(
			and(
				eq(issues.id, issueId),
				eq(issues.status, 'visible'),
				sql`(SELECT count(*) FROM ${reports} WHERE ${reports.issueId} = ${issueId} AND ${reports.counted} = 1) >= ${HIDE_THRESHOLD}`
			)
		);
	return { ok: true as const, already: false };
}

/** 運営の操作。from のどれかの状態のときだけ to に変え、変わったら true。記録はトリガーが書く */
export async function changeStatus(
	db: Db,
	issueId: number,
	from: IssueStatus[],
	to: 'hidden' | 'restored',
	staff: { userId: string; role: Role },
	reason: HideReason | null,
	note: string,
	now: number
) {
	const changed = await db
		.update(issues)
		.set({
			status: to,
			statusActor: staff.role,
			statusActorUserId: staff.userId,
			statusReason: reason,
			statusNote: note,
			statusChangedAt: now
		})
		.where(and(eq(issues.id, issueId), inArray(issues.status, from)))
		.returning({ id: issues.id });
	return changed.length > 0;
}

/** 運営の画面の一覧：通報を受けた課題（と focus の課題）。自動で非表示が先、その中は最後の通報が新しい順に100件 */
export async function reportedIssues(db: Db, focus: number | null) {
	const reasonCount = (r: ReportReason) => sql<number>`coalesce(sum(case when ${reports.reason} = ${r} then 1 else 0 end), 0)`;
	const rows = await db
		.select({
			id: issues.id,
			title: issues.title,
			userId: issues.userId,
			status: issues.status,
			total: count(reports.id),
			counted: sql<number>`coalesce(sum(${reports.counted}), 0)`,
			attack: reasonCount('attack'),
			spam: reasonCount('spam'),
			duplicate: reasonCount('duplicate'),
			other: reasonCount('other'),
			none: reasonCount('none'),
			afterRestore: sql<number>`coalesce(sum(case when ${issues.status} = 'restored' and ${reports.createdAt} > ${issues.statusChangedAt} then 1 else 0 end), 0)`,
			lastReport: sql<number | null>`max(${reports.createdAt})`
		})
		.from(issues)
		.leftJoin(reports, eq(reports.issueId, issues.id))
		// 課題の総数ではなく、通報された課題の数だけ読む（D1 は読んだ行の数で課金される）
		.where(
			or(
				inArray(issues.id, db.selectDistinct({ id: reports.issueId }).from(reports)),
				focus === null ? undefined : eq(issues.id, focus)
			)
		)
		.groupBy(issues.id)
		.orderBy(
			desc(sql`${issues.id} = ${focus ?? -1}`),
			desc(sql`${issues.status} = 'auto_hidden'`),
			desc(sql`max(${reports.createdAt})`),
			desc(issues.id)
		)
		.limit(100);
	const ids = rows.map((r) => r.id);
	const notes = ids.length
		? await db
				.select({ issueId: reports.issueId, note: reports.note })
				.from(reports)
				.where(and(inArray(reports.issueId, ids), isNotNull(reports.note)))
				.orderBy(desc(reports.createdAt), desc(reports.id))
		: [];
	return rows.map((r) => ({ ...r, notes: notes.filter((n) => n.issueId === r.id).map((n) => n.note as string) }));
}

/** 公開の記録：新しい順に50件ごと。対応した人の ID は返さない */
export async function moderationLogPage(db: Db, page: number) {
	const rows = await db
		.select({
			id: moderationLogs.id,
			issueId: moderationLogs.issueId,
			action: moderationLogs.action,
			actor: moderationLogs.actor,
			reason: moderationLogs.reason,
			note: moderationLogs.note,
			createdAt: moderationLogs.createdAt
		})
		.from(moderationLogs)
		.orderBy(desc(moderationLogs.id))
		.limit(PAGE_SIZE + 1)
		.offset((page - 1) * PAGE_SIZE);
	return { rows: rows.slice(0, PAGE_SIZE), hasNext: rows.length > PAGE_SIZE };
}
