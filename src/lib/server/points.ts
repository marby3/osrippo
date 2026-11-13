// 質疑の論点（Issue #168）。受け取る値の形と時期は呼ぶ側が確かめる
import { asc, eq, sql, type SQL } from 'drizzle-orm';
import { billModerationLogs, billPoints } from '../db/schema';
import { chairPowerOf, type StaffRole } from './chairs';
import type { BatchDb, Db } from './law';
import { roleOf } from './reports';
import { involvedInBill } from './results';

type Staff = { userId: string; role: StaffRole };

/**
 * 論点を扱える役職。運営と運営協力者が先（運営の役職の操作は委員長の操作に数えない）。委員長と代行中の理事は、その法案の委員会のものだけ。
 * 関わった法案（提出者・賛同者・共同提出者。委員長と理事は投票も）では null
 */
export async function pointStaffOf(db: Db, bill: { id: number; committeeId: number }, userId: string, now: number, minutes: number | null): Promise<StaffRole | null> {
	const role = (await roleOf(db, userId)) ?? (await chairPowerOf(db, userId, now, minutes, bill.committeeId));
	if (role === null) return null;
	return (await involvedInBill(db, bill.id, userId, role)) ? null : role;
}

/** 法案の論点を立てた順に。番号（論点1、論点2）は立てた順で、閉じても変わらない */
export async function pointsOf(db: Db, billId: number) {
	const rows = await db
		.select({ id: billPoints.id, title: billPoints.title, closedAt: billPoints.closedAt })
		.from(billPoints)
		.where(eq(billPoints.billId, billId))
		.orderBy(asc(billPoints.id));
	return rows.map((r, i) => ({ no: i + 1, id: r.id, title: r.title, closed: r.closedAt !== null }));
}

/**
 * 記録の行を、いま書いた論点の行から作る（insert … select。D1 の batch に db.run を入れない）。
 * 見出しを note に入れ、対応した人の ID は actor_user_id に入れる（公開しない。理事の代行の判定 lastChairAction が読む）
 */
const logFrom = (db: Db, action: 'point_open' | 'point_close', staff: Staff, now: number, where: SQL) =>
	db
		.insert(billModerationLogs)
		.select(sql`SELECT NULL, bill_id, NULL, ${action}, ${staff.role}, ${staff.userId}, NULL, title, ${now}, NULL, NULL, NULL FROM bill_points WHERE ${where}`);

/** 論点を立てる。記録は同じ batch で書く */
export async function openPoint(db: BatchDb, billId: number, title: string, staff: Staff, now: number) {
	await db.batch([
		db.insert(billPoints).values({ billId, title, createdAt: now }),
		// batch は1つのトランザクションなので、その法案のいちばん新しい行がいま入れた行
		// 立てるたびに新しい行なので、同じ時刻に2回立てても、論点と記録が1つずつ入る
		logFrom(db, 'point_open', staff, now, sql`id = (SELECT max(id) FROM bill_points WHERE bill_id = ${billId})`)
	] as never);
}

/** 論点を閉じる。ない番号は missing、もう閉じていれば closed */
export async function closePoint(db: BatchDb, billId: number, no: number, staff: Staff, now: number): Promise<'ok' | 'missing' | 'closed'> {
	const point = (await pointsOf(db, billId)).find((p) => p.no === no);
	if (!point) return 'missing';
	if (point.closed) return 'closed';
	// 記録を先に、まだ開いているときだけ書く。batch は1つのトランザクションで順に流れるので、同じ論点を同時に（同じ時刻にも）2回閉じても、
	// 2回目は記録の文も UPDATE も当たらない（閉じた時刻で記録を引くと、同じ時刻の2回目にも当たってしまう）
	const [, closed] = (await db.batch([
		logFrom(db, 'point_close', staff, now, sql`id = ${point.id} AND closed_at IS NULL`),
		db
			.update(billPoints)
			.set({ closedAt: now })
			.where(sql`${billPoints.id} = ${point.id} AND ${billPoints.closedAt} IS NULL`)
			.returning({ id: billPoints.id })
	] as never)) as unknown as unknown[][];
	return closed.length ? 'ok' : 'closed';
}
