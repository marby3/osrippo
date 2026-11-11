// 答弁イベントの告知と一覧（Issue #153。#147 の決めること13・15）
import { and, asc, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm';
import { bills, elections, issues, tobenEvents, user } from '../db/schema';
import { LISTED } from '../domain/reports';
import { tobenState, type TobenState, type TobenTargetKind } from '../domain/toben';
import type { Person } from '../domain/verification';
import type { Db } from './law';
import { personOf, verifiedColumns, verifiedJoin, verifiedTable } from './verifications';

/** 開催の時間が選挙の期間にかかっているか（告知のあとで登録された選挙で中止になる。#151） */
const stoppedSql = sql<number>`EXISTS (SELECT 1 FROM ${elections} e WHERE e.starts_at < ${tobenEvents.endsAt} AND e.ends_at > ${tobenEvents.startsAt})`;

/** 対象の題名（課題は表示中のもの、法案は発議されたもの）。なければ null */
const targetTitleSql = sql<string | null>`CASE ${tobenEvents.targetKind}
	WHEN 'issue' THEN (SELECT i.title FROM ${issues} i WHERE i.id = ${tobenEvents.targetId} AND i.status IN ('visible', 'restored'))
	ELSE (SELECT b.title FROM ${bills} b WHERE b.id = ${tobenEvents.targetId}) END`;

export type TobenView = {
	id: number;
	title: string;
	targetKind: TobenTargetKind;
	targetId: number;
	targetTitle: string | null;
	startsAt: number;
	endsAt: number;
	state: TobenState;
	person: Person;
	mine: boolean;
};

function select(db: Db, now: number) {
	return db
		.select({
			id: tobenEvents.id,
			userId: tobenEvents.userId,
			title: tobenEvents.title,
			targetKind: tobenEvents.targetKind,
			targetId: tobenEvents.targetId,
			targetTitle: targetTitleSql,
			startsAt: tobenEvents.startsAt,
			endsAt: tobenEvents.endsAt,
			cancelledAt: tobenEvents.cancelledAt,
			stopped: stoppedSql,
			name: user.name,
			...verifiedColumns(now)
		})
		.from(tobenEvents)
		.innerJoin(user, eq(user.id, tobenEvents.userId))
		.leftJoin(verifiedTable, verifiedJoin(now))
		.$dynamic();
}

type Row = Awaited<ReturnType<ReturnType<typeof select>['execute']>>[number];

function view(r: Row, now: number, viewerId: string | null): TobenView {
	return {
		id: r.id,
		title: r.title,
		targetKind: r.targetKind,
		targetId: r.targetId,
		targetTitle: r.targetTitle,
		startsAt: r.startsAt,
		endsAt: r.endsAt,
		state: tobenState({ startsAt: r.startsAt, endsAt: r.endsAt, cancelledAt: r.cancelledAt, stopped: Boolean(r.stopped) }, now),
		person: personOf(r),
		mine: r.userId === viewerId
	};
}

/** 対象があるか：課題は表示中、法案は発議されたもの */
export async function tobenTargetExists(db: Db, kind: TobenTargetKind, id: number): Promise<boolean> {
	if (kind === 'issue') return (await db.select({ id: issues.id }).from(issues).where(and(eq(issues.id, id), inArray(issues.status, [...LISTED])))).length > 0;
	const [bill] = await db.select({ status: bills.status, proposedAt: bills.proposedAt }).from(bills).where(eq(bills.id, id));
	return Boolean(bill && bill.status !== 'draft' && bill.proposedAt !== null);
}

/** 開催の時間が、登録された選挙の期間にかかるか */
export async function overlapsElection(db: Db, startsAt: number, endsAt: number): Promise<boolean> {
	return (await db.select({ id: elections.id }).from(elections).where(and(lt(elections.startsAt, endsAt), gt(elections.endsAt, startsAt))).limit(1)).length > 0;
}

/** 告知する。番号を返す */
export async function createToben(db: Db, input: { userId: string; kind: TobenTargetKind; targetId: number; title: string; startsAt: number; endsAt: number }, now: number): Promise<number> {
	const [row] = await db
		.insert(tobenEvents)
		.values({ userId: input.userId, targetKind: input.kind, targetId: input.targetId, title: input.title, startsAt: input.startsAt, endsAt: input.endsAt, createdAt: now })
		.returning({ id: tobenEvents.id });
	return row.id;
}

/** 取り消す。告知した本人が、開始の前に、まだ取り消していないときだけ。断る理由を返す（取り消せたら null） */
export async function cancelToben(db: Db, id: number, userId: string, now: number): Promise<'missing' | 'forbidden' | 'started' | null> {
	const [row] = await db.select({ userId: tobenEvents.userId, startsAt: tobenEvents.startsAt, cancelledAt: tobenEvents.cancelledAt }).from(tobenEvents).where(eq(tobenEvents.id, id));
	if (!row) return 'missing';
	if (row.userId !== userId) return 'forbidden';
	if (row.cancelledAt !== null || row.startsAt <= now) return 'started';
	const done = await db
		.update(tobenEvents)
		.set({ cancelledAt: now })
		.where(and(eq(tobenEvents.id, id), isNull(tobenEvents.cancelledAt), gt(tobenEvents.startsAt, now)))
		.returning({ id: tobenEvents.id });
	return done.length ? null : 'started';
}

/** イベントのページ */
export async function tobenOf(db: Db, id: number, now: number, viewerId: string | null): Promise<TobenView | null> {
	const [row] = await select(db, now).where(eq(tobenEvents.id, id));
	return row ? view(row, now, viewerId) : null;
}

/** 一覧：これから（開始が近い順）・開催中・終わった（新しい順。取り消しと中止を含む）。終わったは新しい50件 */
export async function tobenList(db: Db, now: number) {
	const rows = await select(db, now).orderBy(asc(tobenEvents.startsAt), asc(tobenEvents.id));
	const all = rows.map((r) => view(r, now, null));
	const ended = all.filter((e) => e.state === 'ended' || e.state === 'cancelled' || e.state === 'stopped').sort((a, b) => b.startsAt - a.startsAt || b.id - a.id);
	return { upcoming: all.filter((e) => e.state === 'upcoming'), live: all.filter((e) => e.state === 'live'), ended: ended.slice(0, 50) };
}

/** 課題・法案のページの告知：これからと開催中のもの（取り消しと中止は出さない） */
export async function tobenFor(db: Db, kind: TobenTargetKind, targetId: number, now: number) {
	const rows = await select(db, now)
		.where(and(eq(tobenEvents.targetKind, kind), eq(tobenEvents.targetId, targetId), isNull(tobenEvents.cancelledAt), gt(tobenEvents.endsAt, now)))
		.orderBy(asc(tobenEvents.startsAt));
	return rows.map((r) => view(r, now, null)).filter((e) => e.state === 'upcoming' || e.state === 'live');
}


