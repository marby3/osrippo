// 修正案の通報と非表示（設計書 docs/spec/103.md）。受け取る値の形は呼ぶ側が確かめる
import { and, count, desc, eq, inArray, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import { amendmentReports, amendments, bills } from '../db/schema';
import { autoHideClosesAt } from '../domain/amendments';
import { referralSession } from '../domain/bills';
import { articleLabel, type Paragraph } from '../domain/law';
import { LIMITS } from '../domain/limits';
import { countsTowardHide, HIDE_THRESHOLD, isHidden, POST_HIDDEN, type HideReason, type IssueStatus, type SolutionReportReason } from '../domain/reports';
import { textOf } from './bills';
import { staffRoleOf } from './chairs';
import { refuse, type Actor } from './issues';
import type { Db } from './law';
import { notify } from './notifications';
import { reportsInDay, type Role } from './reports';
import { involvedSql } from './results';

type Staff = { userId: string; role: Role };
type ModerationStatus = (typeof amendments.moderationStatus.enumValues)[number];

/**
 * 修正案を通報しても数に入らない人、運営の権限でも扱えない人（決定B・O）：法案に関わった人、同じ法案に修正案を出した人、
 * 同じ法案のどれかの修正案に賛同している人（対抗案の賛同者が相手を隠せないように）。委員長と理事は投票も見る。
 * user は値でも列でも渡せる。${bills} の行を見る
 */
export const amendmentPartySql = (user: string | SQL, role: Role) =>
	sql<number>`(${involvedSql(user, role)}
		OR EXISTS (SELECT 1 FROM amendments x WHERE x.bill_id = ${bills}.id AND (x.user_id = ${user}
			OR EXISTS (SELECT 1 FROM amendment_supports xs WHERE xs.amendment_id = x.id AND xs.user_id = ${user})${role === 'chair' || role === 'director' ? sql` OR EXISTS (SELECT 1 FROM amendment_votes xv WHERE xv.amendment_id = x.id AND xv.user_id = ${user})` : sql``})))`;

/**
 * 数に入る通報の数。関わりは数えるときに判定する（先に通報してから対抗案を出しても抜けられないように）。
 * 自動の非表示と /kanri の「数に入るもの」で同じ式を使う
 */
const countedReports = (amendmentId: number | SQL) =>
	sql<number>`(SELECT count(*) FROM amendment_reports r JOIN amendments a ON a.id = r.amendment_id JOIN ${bills} ON ${bills}.id = a.bill_id
		WHERE r.amendment_id = ${amendmentId} AND r.counted = 1 AND NOT ${amendmentPartySql(sql`r.user_id`, 'operator')})`;

/** 自動で非表示にしない時期の始まり。今の時計の会期でなく、法案の付託先の会期から求める（締切のあとに次の会期へ進まないように） */
export const amendmentCloseOf = (bill: { proposedAt: number | null }, minutes: number | null) => autoHideClosesAt(referralSession(bill.proposedAt ?? 0, minutes).voteAt);

const amendmentAuthor = (id: number) => sql`SELECT user_id FROM amendments WHERE id = ${id}`;

async function meta(db: Db, id: number) {
	const [row] = await db
		.select({ id: amendments.id, billId: amendments.billId, userId: amendments.userId, moderationStatus: amendments.moderationStatus, revision: amendments.revision })
		.from(amendments)
		.where(eq(amendments.id, id));
	return row ?? null;
}

/**
 * 通報する（決定B〜D）。修正案がその法案のものか → 自分のもの → 状態 → 2回目 → 上限 → 保存。
 * status が open なら closesAt 以降は自動で非表示にしない（期間でなく状態で書く。締切から会期の処理までに非表示になって票が捨てられないように）
 */
export async function reportAmendment(db: Db, actor: Actor, target: { id: number; billId: number; closesAt: number }, value: { reason: SolutionReportReason; note: string | null }, now: number) {
	const row = await meta(db, target.id);
	if (!row || row.billId !== target.billId) return { ok: false as const, reason: 'missing' as const };
	if (row.userId === actor.userId) return { ok: false as const, reason: 'own' as const };
	if (isHidden(row.moderationStatus)) return { ok: false as const, reason: 'hidden' as const };
	const mine = and(eq(amendmentReports.amendmentId, target.id), eq(amendmentReports.userId, actor.userId));
	if ((await db.select({ id: amendmentReports.id }).from(amendmentReports).where(mine)).length > 0) return { ok: true as const, already: true };
	if ((await reportsInDay(db, actor.userId, now)) >= LIMITS.reportPerDay) return { ...(await refuse(db, actor, { kind: 'report-day' }, now)), reason: 'limit' as const };

	const inserted = await db
		.insert(amendmentReports)
		.values({ amendmentId: target.id, userId: actor.userId, reason: value.reason, note: value.note, counted: countsTowardHide(value.reason, actor.registeredAt, now), revision: row.revision, createdAt: now })
		.onConflictDoNothing()
		.returning({ id: amendmentReports.id });
	if (inserted.length === 0) return { ok: true as const, already: true };

	// 記録はトリガーが書く
	const hidden = await db
		.update(amendments)
		.set({ moderationStatus: 'auto_hidden', moderationActor: 'auto', moderationActorUserId: null, moderationReason: 'reports', moderationNote: null, moderationChangedAt: now })
		.where(and(eq(amendments.id, target.id), eq(amendments.moderationStatus, 'visible'), sql`(${amendments}.status <> 'open' OR ${now} < ${target.closesAt})`, sql`${countedReports(target.id)} >= ${HIDE_THRESHOLD}`))
		.returning({ id: amendments.id });
	if (hidden.length) await notify(db, amendmentAuthor(target.id), 'amendment_hidden', target.id, now, now);
	return { ok: true as const, already: false };
}

/** 運営の操作。from のどれかの状態のときだけ to に変え、変わったら true。記録はトリガーが書く */
export async function changeAmendmentModeration(db: Db, id: number, from: IssueStatus[], to: 'hidden' | 'restored', staff: Staff, reason: HideReason | null, note: string, now: number) {
	const changed = await db
		.update(amendments)
		.set({ moderationStatus: to, moderationActor: staff.role, moderationActorUserId: staff.userId, moderationReason: reason, moderationNote: note, moderationChangedAt: now })
		.where(and(eq(amendments.id, id), inArray(amendments.moderationStatus, from as ModerationStatus[])))
		.returning({ id: amendments.id });
	if (!changed.length) return false;
	await notify(db, amendmentAuthor(id), to === 'hidden' ? 'amendment_hidden' : 'amendment_restored', id, now, now);
	return true;
}

async function partyToAmendments(db: Db, billId: number, staff: Staff) {
	const [row] = await db
		.select({ party: amendmentPartySql(staff.userId, staff.role) })
		.from(bills)
		.where(eq(bills.id, billId));
	return Boolean(row?.party);
}

/** その修正案を扱えるか：ない番号、自分のもの、関わり（決定O。どれも法案の単位で決まる） */
export async function amendmentStaffAccess(db: Db, id: number, staff: Staff): Promise<'missing' | 'own' | 'involved' | 'ok'> {
	const row = await meta(db, id);
	if (!row) return 'missing';
	if (row.userId === staff.userId) return 'own';
	return (await partyToAmendments(db, row.billId, staff)) ? 'involved' : 'ok';
}

/** その法案の修正案を運営として見られるか：運営の画面の権限があり、関わっていない（決定H） */
export async function staffOnAmendments(db: Db, billId: number, userId: string, now: number, minutes: number | null) {
	const role = await staffRoleOf(db, userId, now, minutes);
	return role !== null && !(await partyToAmendments(db, billId, { userId, role }));
}

/**
 * 運営の画面の一覧：通報を受けた修正案（と focus の修正案）。自動で非表示が先、その中は最後の通報が新しい順に100件。
 * 扱えないものは100件に絞る前に SQL で除く。書いた人は渡さない
 */
export async function reportedAmendments(db: Db, staff: Staff, focus: number | null) {
	const reasonCount = (r: SolutionReportReason) => sql<number>`coalesce(sum(case when ${amendmentReports.reason} = ${r} then 1 else 0 end), 0)`;
	const rows = await db
		.select({
			id: amendments.id,
			num: amendments.num,
			caption: amendments.caption,
			body: amendments.body,
			reason: amendments.reason,
			moderationStatus: amendments.moderationStatus,
			status: amendments.status,
			billId: amendments.billId,
			billTitle: bills.title,
			total: count(amendmentReports.id),
			counted: countedReports(sql`${amendments}.id`),
			attack: reasonCount('attack'),
			spam: reasonCount('spam'),
			other: reasonCount('other'),
			none: reasonCount('none'),
			afterRestore: sql<number>`coalesce(sum(case when ${amendments.moderationStatus} = 'restored' and ${amendmentReports.createdAt} > ${amendments.moderationChangedAt} then 1 else 0 end), 0)`,
			// 古い本文は持たないので、最後の通報のあとに本文が変わったことだけを出す
			updatedAfterReport: sql<number>`coalesce(max(${amendmentReports.revision}) < ${amendments.revision}, 0)`
		})
		.from(amendments)
		.innerJoin(bills, eq(bills.id, amendments.billId))
		.leftJoin(amendmentReports, eq(amendmentReports.amendmentId, amendments.id))
		.where(
			and(
				or(inArray(amendments.id, db.selectDistinct({ id: amendmentReports.amendmentId }).from(amendmentReports)), focus === null ? undefined : eq(amendments.id, focus)),
				sql`NOT ${amendmentPartySql(staff.userId, staff.role)}`
			)
		)
		.groupBy(amendments.id)
		.orderBy(desc(sql`${amendments.id} = ${focus ?? -1}`), desc(sql`${amendments.moderationStatus} = 'auto_hidden'`), desc(sql`max(${amendmentReports.createdAt})`), desc(amendments.id))
		.limit(100);
	// 番号は JSON の1つの値で渡す（D1 は1文に100個までしか値を結び付けられない）
	const notes = rows.length
		? await db
				.select({ amendmentId: amendmentReports.amendmentId, note: amendmentReports.note })
				.from(amendmentReports)
				.where(and(sql`amendment_id IN (SELECT value FROM json_each(${JSON.stringify(rows.map((r) => r.id))}))`, isNotNull(amendmentReports.note)))
				.orderBy(desc(amendmentReports.createdAt), desc(amendmentReports.id))
		: [];
	return rows.map(({ num, caption, body, updatedAfterReport, ...r }) => ({
		...r,
		location: articleLabel(num),
		body: textOf(caption, JSON.parse(body) as Paragraph[]),
		updatedAfterReport: Boolean(updatedAfterReport),
		notes: notes.filter((n) => n.amendmentId === r.id).map((n) => n.note as string)
	}));
}

/** その人がその法案で通報した修正案の番号（通報済みの表示に使う）。番号を並べず法案で引く */
export async function reportedAmendmentIds(db: Db, userId: string | null, billId: number) {
	if (userId === null) return [];
	const rows = await db
		.select({ id: amendmentReports.amendmentId })
		.from(amendmentReports)
		.innerJoin(amendments, eq(amendments.id, amendmentReports.amendmentId))
		.where(and(eq(amendmentReports.userId, userId), eq(amendments.billId, billId)));
	return rows.map((r) => r.id);
}

/** 修正案のタブの「非表示の修正案」の欄（決定H）。staffHere なら法案の非表示の修正案を全部、そうでなければ自分のもの。新しい順 */
export async function hiddenAmendmentsFor(db: Db, billId: number, userId: string | null, staffHere: boolean) {
	if (userId === null) return [];
	const rows = await db
		.select({ id: amendments.id, num: amendments.num, caption: amendments.caption, body: amendments.body, reason: amendments.reason, status: amendments.moderationStatus, statusReason: amendments.moderationReason, userId: amendments.userId })
		.from(amendments)
		.where(and(eq(amendments.billId, billId), inArray(amendments.moderationStatus, POST_HIDDEN), staffHere ? undefined : eq(amendments.userId, userId)))
		.orderBy(desc(amendments.id));
	return rows.map(({ userId: author, num, caption, body, ...r }) => ({ ...r, location: articleLabel(num), body: textOf(caption, JSON.parse(body) as Paragraph[]), mine: author === userId }));
}
