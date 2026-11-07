// 通知の一覧と未読の数（Issue #78。設計書 docs/spec/78.md 決めたこと7〜9）
import { and, count, desc, eq, gt, gte, inArray, isNull, lte, max, ne, sql } from 'drizzle-orm';
import { amendments, billAdjustments, bills, chairTerms, issues, notificationReads, notifications, posts, solutions } from '../db/schema';
import { ACTING_AFTER } from '../domain/chairs';
import { PAGE_SIZE } from '../domain/issues';
import { hrefOf, targetOf, type NoticeKind, type NotificationKind, type TimedKind } from '../domain/notifications';
import { sessionAt } from '../domain/session';
import { lastChairAction } from './chairs';
import { activeBan } from './issues';
import type { Db } from './law';
import { roleOf } from './reports';
import { inVote } from './votes';

export type TimedNotice = { kind: TimedKind; at: number; billId?: number; title?: string };

/** 時刻から求める項目。いまの会期の分だけ。全員向け、法案の番号の順、代行の順に返す */
export async function timedNotices(db: Db, userId: string, now: number, minutes: number | null): Promise<TimedNotice[]> {
	const session = sessionAt(now, minutes);
	const previous = sessionAt(session.startsAt - 1, minutes);
	const items: TimedNotice[] = [];
	if (now >= session.voteAt) {
		const anyBill = await db.select({ id: bills.id }).from(bills).where(inVote(session, previous)).limit(1);
		if (anyBill.length) items.push({ kind: 'vote_open', at: session.voteAt });
		if ((await roleOf(db, userId)) === null) items.push({ kind: 'election_open', at: session.voteAt });
	}
	if (now >= session.deliberationAt) {
		const mine = await db
			.select({ id: bills.id, title: bills.title })
			.from(bills)
			.where(and(inVote(session, previous), sql`(${bills}.user_id = ${userId} OR EXISTS (SELECT 1 FROM bill_cosponsors c WHERE c.bill_id = ${bills}.id AND c.user_id = ${userId} AND c.status = 'accepted'))`))
			.orderBy(bills.id);
		for (const bill of mine) {
			items.push({ kind: 'my_bill_deliberation', at: session.deliberationAt, billId: bill.id, title: bill.title });
			if (now >= session.voteAt) items.push({ kind: 'my_bill_vote', at: session.voteAt, billId: bill.id, title: bill.title });
		}
	}
	// 期限までに直されなかった要調整の法案（いまの会期に期限が来たもの）。法令が廃止された法案は直せないので入らない
	const expired = await db
		.select({ id: bills.id, title: bills.title, dueAt: billAdjustments.dueAt })
		.from(billAdjustments)
		.innerJoin(bills, eq(bills.id, billAdjustments.billId))
		.where(
			and(
				isNull(billAdjustments.resolvedAt),
				ne(billAdjustments.reason, 'repealed'),
				gte(billAdjustments.dueAt, session.startsAt),
				lte(billAdjustments.dueAt, now),
				sql`(${bills}.user_id = ${userId} OR EXISTS (SELECT 1 FROM bill_cosponsors c WHERE c.bill_id = ${bills}.id AND c.user_id = ${userId} AND c.status = 'accepted'))`
			)
		)
		.orderBy(bills.id);
	for (const bill of expired) items.push({ kind: 'my_bill_expired', at: bill.dueAt, billId: bill.id, title: bill.title });
	// 代行：委員長の7日の不在だけ。締め出しによる代行は知らせない（締め出しを推測させないため）。解任は行で届く
	const directing = await db
		.select({ committeeId: chairTerms.committeeId })
		.from(chairTerms)
		.where(and(eq(chairTerms.userId, userId), eq(chairTerms.sessionKey, session.key), eq(chairTerms.role, 'director')));
	if (directing.length && (await activeBan(db, userId, now)) === null) {
		const [chair] = await db
			.select({ userId: chairTerms.userId, recalledAt: chairTerms.recalledAt })
			.from(chairTerms)
			.where(and(eq(chairTerms.committeeId, directing[0].committeeId), eq(chairTerms.sessionKey, session.key), eq(chairTerms.role, 'chair')));
		if (chair && chair.recalledAt === null) {
			const at = ((await lastChairAction(db, chair.userId, session)) ?? session.startsAt) + ACTING_AFTER;
			if (at <= now) items.push({ kind: 'acting', at });
		}
	}
	return items;
}

const readStateOf = async (db: Db, userId: string) => {
	const [row] = await db.select({ readAt: notificationReads.readAt, readId: notificationReads.readId }).from(notificationReads).where(eq(notificationReads.userId, userId));
	return { readAt: row?.readAt ?? -Infinity, readId: row?.readId ?? 0 };
};

/** 未読の数：行は read_id、時刻から求める項目は read_at より後のもの */
export async function unreadCount(db: Db, userId: string, now: number, minutes: number | null): Promise<number> {
	const { readAt, readId } = await readStateOf(db, userId);
	const [[rows], timed] = await Promise.all([
		db
			.select({ n: count() })
			.from(notifications)
			.where(and(eq(notifications.userId, userId), gt(notifications.id, readId))),
		timedNotices(db, userId, now, minutes)
	]);
	return rows.n + timed.filter((t) => t.at > readAt).length;
}

export type NoticeItem = { kind: NoticeKind; at: number; title: string | null; href: string; unread: boolean };

type Row = { id: number; kind: NotificationKind; targetId: number; createdAt: number };

/** 行の対象の題名とリンク先の番号を引く。対象の行がない項目は null */
async function resolveTargets(db: Db, rows: Row[]) {
	const idsOf = (target: ReturnType<typeof targetOf>) => [...new Set(rows.filter((r) => targetOf(r.kind) === target).map((r) => r.targetId))];
	const billIds = idsOf('bill');
	const issueIds = idsOf('issue');
	const solutionIds = idsOf('solution');
	const postIds = idsOf('post');
	const amendmentIds = idsOf('amendment');
	const [billRows, issueRows, solutionRows, postRows, amendmentRows] = await Promise.all([
		billIds.length ? db.select({ id: bills.id, title: bills.title }).from(bills).where(inArray(bills.id, billIds)) : [],
		issueIds.length ? db.select({ id: issues.id, title: issues.title }).from(issues).where(inArray(issues.id, issueIds)) : [],
		solutionIds.length
			? db.select({ id: solutions.id, issueId: solutions.issueId, title: issues.title }).from(solutions).innerJoin(issues, eq(issues.id, solutions.issueId)).where(inArray(solutions.id, solutionIds))
			: [],
		postIds.length ? db.select({ id: posts.id, billId: posts.billId, title: bills.title }).from(posts).innerJoin(bills, eq(bills.id, posts.billId)).where(inArray(posts.id, postIds)) : [],
		amendmentIds.length ? db.select({ id: amendments.id, billId: amendments.billId, title: bills.title }).from(amendments).innerJoin(bills, eq(bills.id, amendments.billId)).where(inArray(amendments.id, amendmentIds)) : []
	]);
	return (row: Row): { title: string | null; ids: { billId?: number; issueId?: number } } | null => {
		const target = targetOf(row.kind);
		if (target === 'committee') return { title: null, ids: {} };
		if (target === 'bill') {
			const bill = billRows.find((b) => b.id === row.targetId);
			return bill ? { title: bill.title, ids: { billId: bill.id } } : null;
		}
		if (target === 'issue') {
			const issue = issueRows.find((i) => i.id === row.targetId);
			return issue ? { title: issue.title, ids: { issueId: issue.id } } : null;
		}
		if (target === 'solution') {
			const solution = solutionRows.find((s) => s.id === row.targetId);
			return solution ? { title: solution.title, ids: { issueId: solution.issueId } } : null;
		}
		if (target === 'amendment') {
			const amendment = amendmentRows.find((a) => a.id === row.targetId);
			return amendment ? { title: amendment.title, ids: { billId: amendment.billId } } : null;
		}
		const post = postRows.find((p) => p.id === row.targetId);
		return post ? { title: post.title, ids: { billId: post.billId } } : null;
	};
}

/**
 * 一覧の1ページ。行と時刻から求める項目を合わせて新しい順に並べてから分ける。同じ時刻は時刻から求める項目が先、行は id の大きい順。
 * 1ページ目に項目があれば既読にする。未読の印は1ページ目に、開く前の状態で出す。read_id は読む前に求める（読んでいるあいだに入った行を未読に残す）
 */
export async function notificationPage(db: Db, userId: string, now: number, minutes: number | null, page: number) {
	const { readAt, readId } = await readStateOf(db, userId);
	const [{ latest }] = await db.select({ latest: max(notifications.id) }).from(notifications).where(eq(notifications.userId, userId));
	const end = page * PAGE_SIZE;
	const [timed, rows] = await Promise.all([
		timedNotices(db, userId, now, minutes),
		db
			.select({ id: notifications.id, kind: notifications.kind, targetId: notifications.targetId, createdAt: notifications.createdAt })
			.from(notifications)
			.where(eq(notifications.userId, userId))
			.orderBy(desc(notifications.createdAt), desc(notifications.id))
			.limit(end + 1)
	]);
	const merged: ({ source: 'timed'; at: number; notice: TimedNotice } | { source: 'row'; at: number; row: Row })[] = [
		...timed.map((notice) => ({ source: 'timed' as const, at: notice.at, notice })),
		...rows.map((row) => ({ source: 'row' as const, at: row.createdAt, row }))
	];
	// 配列の sort は安定なので、同じ時刻は上の順のまま
	merged.sort((a, b) => b.at - a.at);
	const shown = merged.slice(end - PAGE_SIZE, end);
	const resolve = await resolveTargets(db, shown.flatMap((m) => (m.source === 'row' ? [m.row] : [])));
	const items = shown.flatMap((m): NoticeItem[] => {
		if (m.source === 'timed') {
			const { kind, at, billId, title } = m.notice;
			return [{ kind, at, title: title ?? null, href: hrefOf(kind, { billId }), unread: page === 1 && at > readAt }];
		}
		const found = resolve(m.row);
		return found ? [{ kind: m.row.kind, at: m.at, title: found.title, href: hrefOf(m.row.kind, found.ids), unread: page === 1 && m.row.id > readId }] : [];
	});
	if (page === 1 && shown.length) {
		await db
			.insert(notificationReads)
			.values({ userId, readAt: now, readId: latest ?? 0 })
			.onConflictDoUpdate({ target: notificationReads.userId, set: { readAt: sql`max(read_at, excluded.read_at)`, readId: sql`max(read_id, excluded.read_id)` } });
	}
	return { items, hasNext: merged.length > end };
}
