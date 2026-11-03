// 通報と非表示、運営の画面と記録の DB（設計書 docs/spec/28.md）
import { and, count, countDistinct, desc, eq, gt, inArray, isNotNull, ne, or, sql } from 'drizzle-orm';
import { issueSupports, issues, moderationLogs, reports, user, type ROLES } from '../db/schema';
import { PAGE_SIZE } from '../domain/issues';
import { preselectSimilar, rankSimilar } from '../domain/similar';
import { DAY, LIMITS } from '../domain/limits';
import {
	countsTowardHide,
	HIDE_THRESHOLD,
	LISTED,
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
			mergedInto: issues.mergedInto,
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
			mergedInto: moderationLogs.mergedInto,
			createdAt: moderationLogs.createdAt
		})
		.from(moderationLogs)
		.orderBy(desc(moderationLogs.id))
		.limit(PAGE_SIZE + 1)
		.offset((page - 1) * PAGE_SIZE);
	return { rows: rows.slice(0, PAGE_SIZE), hasNext: rows.length > PAGE_SIZE };
}

// 統合（設計書 docs/spec/30.md 決めたこと3〜5・9）

/** 統合の確認の欄に出すもの：両方の題名と状態と書いた人、合算したあとの「わかる」の数（両方に付けた人は1人） */
export async function mergePreview(db: Db, sourceId: number, targetId: number) {
	const rows = await db
		.select({ id: issues.id, title: issues.title, status: issues.status, userId: issues.userId })
		.from(issues)
		.where(inArray(issues.id, [sourceId, targetId]));
	const [union] = await db
		.select({ n: countDistinct(issueSupports.userId) })
		.from(issueSupports)
		.where(inArray(issueSupports.issueId, [sourceId, targetId]));
	return {
		source: rows.find((r) => r.id === sourceId) ?? null,
		target: rows.find((r) => r.id === targetId) ?? null,
		supports: union.n
	};
}

/**
 * 統合する。元も統合先も一覧に出る状態で、別の課題のときだけ、1文で元を merged にする。変わったら true。
 * 記録・「わかる」を写す・付け替えは、トリガー（drizzle/0005_merge.sql）が同じ文の中で行う
 */
export async function mergeIssue(
	db: Db,
	sourceId: number,
	targetId: number,
	staff: { userId: string; role: Role },
	note: string,
	now: number
) {
	const changed = await db
		.update(issues)
		.set({
			status: 'merged',
			mergedInto: targetId,
			statusActor: staff.role,
			statusActorUserId: staff.userId,
			statusReason: null,
			statusNote: note,
			statusChangedAt: now
		})
		.where(
			and(
				eq(issues.id, sourceId),
				ne(issues.id, targetId),
				inArray(issues.status, LISTED),
				// 統合先も一覧に出る状態のときだけ（同じ文の中で確かめる）
				sql`EXISTS (SELECT 1 FROM issues AS t WHERE t.id = ${targetId} AND t.status IN (${sql.join(
					LISTED.map((s) => sql`${s}`),
					sql`, `
				)}))`
			)
		)
		.returning({ id: issues.id });
	return changed.length > 0;
}

/** 統合先のページの「この課題にまとめた課題」：統合した時刻の新しい順 */
export async function mergedSources(db: Db, targetId: number) {
	return db
		.select({ id: issues.id, title: issues.title })
		.from(issues)
		.where(and(eq(issues.mergedInto, targetId), eq(issues.status, 'merged')))
		.orderBy(desc(issues.statusChangedAt), desc(issues.id));
}

/** 似た課題（設計書 docs/spec/30.md 決めたこと1）：一覧に出る課題のタイトルだけを読んで絞り、残った候補だけ「わかる」を数える */
export async function findSimilar(db: Db, query: string) {
	const titles = await db.select({ id: issues.id, title: issues.title }).from(issues).where(inArray(issues.status, LISTED));
	const picked = preselectSimilar(query, titles);
	if (picked.length === 0) return [];
	const counts = await db
		.select({ id: issueSupports.issueId, n: count() })
		.from(issueSupports)
		.where(inArray(issueSupports.issueId, picked.map((p) => p.id)))
		.groupBy(issueSupports.issueId);
	return rankSimilar(
		query,
		picked.map((p) => ({ ...p, supports: counts.find((c) => c.id === p.id)?.n ?? 0 }))
	);
}
