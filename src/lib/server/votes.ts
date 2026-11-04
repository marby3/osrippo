// 投票資格・割り当て・票を入れる・票を数える（Issue #65。設計書 docs/spec/65.md 決めたこと5〜10）。
// 受け取る値は呼ぶ側（#70）が確かめる。ここでは確かめずに書く
import { and, asc, count, eq, gte, lt, ne, sql } from 'drizzle-orm';
import { actions, bills, user, voteAssignments, votes } from '../db/schema';
import { PARTICIPANT_KINDS } from '../domain/bills';
import type { Session } from '../domain/session';
import { ASSIGNMENT_COUNT, drawAssignments, type VoteChoice, type VoteCounts } from '../domain/votes';
import { savedBill } from './bills';
import type { Db } from './law';

/**
 * 投票資格の条件：会期の始まりより前に登録し、その前に今月の参加者に数える行動がある。user の行を読む問い合わせの中で使う（isEligibleVoter と tallyVotes で共通）。
 * 副問い合わせの中の列と混ざらないよう、列は別名か表の名前を付けて書く（drizzle の ${table.col} は表名なしの列名になる）
 */
const eligible = (session: Session) =>
	sql`(${user}.created_at < ${session.startsAt} AND EXISTS (SELECT 1 FROM ${actions} a WHERE a.user_id = ${user}.id AND a.kind IN (${sql.join(
		PARTICIPANT_KINDS.map((k) => sql`${k}`),
		sql`, `
	)}) AND a.created_at < ${session.startsAt}))`;

/** 投票資格があるか。session は付託先の会期 */
export async function isEligibleVoter(db: Db, userId: string, session: Session): Promise<boolean> {
	const rows = await db
		.select({ id: user.id })
		.from(user)
		.where(and(eq(user.id, userId), eligible(session)));
	return rows.length > 0;
}

/** その会期に採決する法案の条件。付託先の会期（referralSession）が session になる法案と同じ */
const inVote = (session: Session, previous: Session) =>
	and(savedBill, eq(bills.status, 'proposed'), gte(bills.proposedAt, previous.deliberationAt), lt(bills.proposedAt, session.deliberationAt));

/** その会期に採決する法案 */
export async function billsInVote(db: Db, session: Session, previous: Session) {
	return db
		.select({ id: bills.id, userId: bills.userId, proposedAt: bills.proposedAt })
		.from(bills)
		.where(inVote(session, previous))
		.orderBy(asc(bills.id));
}

const inPeriod = (session: Session, now: number) => session.voteAt <= now && now < session.endsAt;

/**
 * その人の割り当て（法案の番号）。行があれば読む。なければ、採決の期間のときだけくじを引いて固定する。
 * 同時に開いても先に入った組だけが残る。主キーが seq なので、後の文は違う組でも全部の行がぶつかる（候補は締切のあとは変わらないので、どちらの文も同じ本数になる）
 */
export async function assignedBills(db: Db, userId: string, session: Session, previous: Session, now: number, random: () => number): Promise<number[]> {
	const mine = and(eq(voteAssignments.sessionKey, session.key), eq(voteAssignments.userId, userId));
	const read = async () =>
		(await db.select({ billId: voteAssignments.billId }).from(voteAssignments).where(mine).orderBy(asc(voteAssignments.seq))).map((r) => r.billId);
	const known = await read();
	if (known.length || !inPeriod(session, now)) return known;

	// 自分が提出した法案と、賛同したことのある法案（どの版の行でも）は除く
	const candidates = await db
		.select({ id: bills.id })
		.from(bills)
		.where(and(inVote(session, previous), ne(bills.userId, userId), sql`NOT EXISTS (SELECT 1 FROM bill_supports s WHERE s.bill_id = ${bills}.id AND s.user_id = ${userId})`));
	const picks = drawAssignments(
		candidates.map((c) => c.id),
		ASSIGNMENT_COUNT,
		random
	);
	if (!picks.length) return [];
	// 行は主キーと UNIQUE のどちらにもぶつかりうるので、対象を指定しない
	await db
		.insert(voteAssignments)
		.values(picks.map((billId, seq) => ({ sessionKey: session.key, userId, seq, billId, createdAt: now })))
		.onConflictDoNothing();
	return read();
}

/**
 * 票を入れる。入れたかを返す。先に割り当てを固定するので、画面を開かずに送っても割り当てを飛ばせない。
 * その会期に採決する法案かは同じ文で確かめる（廃案の status は proposed のまま）
 */
export async function castVote(db: Db, userId: string, session: Session, previous: Session, billId: number, choice: VoteChoice, now: number, random: () => number): Promise<boolean> {
	if (!inPeriod(session, now)) return false;
	await assignedBills(db, userId, session, previous, now, random);
	const done = await db.all<{ bill_id: number }>(sql`
		INSERT INTO ${votes} (session_key, bill_id, user_id, choice, created_at, updated_at)
		SELECT ${session.key}, id, ${userId}, ${choice}, ${now}, ${now} FROM ${bills}
		WHERE ${eq(bills.id, billId)} AND ${inVote(session, previous)}
		ON CONFLICT (session_key, bill_id, user_id) DO UPDATE SET choice = excluded.choice, updated_at = excluded.updated_at
		RETURNING bill_id`);
	return done.length > 0;
}

const emptyCounts = (): VoteCounts => ({ yes: 0, no: 0, abstain: 0 });

/**
 * 法案の票の数。投票資格があり、その会期の割り当てのすべてに票を入れた人の票が有効票で、それ以外は参考票。
 * 割り当ての行がない人は候補が0本の人だけ（castVote が固定する）で、条件を満たす。投票者ごとに問い合わせず、1文で求める
 */
export async function tallyVotes(db: Db, session: Session, billId: number): Promise<{ counted: VoteCounts; reference: VoteCounts }> {
	const counted = sql<number>`(
		${eligible(session)}
		AND NOT EXISTS (
			SELECT 1 FROM ${voteAssignments} va WHERE va.session_key = ${votes}.session_key AND va.user_id = ${votes}.user_id
			AND NOT EXISTS (SELECT 1 FROM ${votes} w WHERE w.session_key = va.session_key AND w.bill_id = va.bill_id AND w.user_id = va.user_id)
		)
	)`.as('counted');
	const rows = await db
		.select({ choice: votes.choice, counted, n: count() })
		.from(votes)
		.innerJoin(user, eq(user.id, votes.userId))
		.where(and(eq(votes.sessionKey, session.key), eq(votes.billId, billId)))
		.groupBy(votes.choice, sql`counted`);
	const result = { counted: emptyCounts(), reference: emptyCounts() };
	for (const row of rows) result[row.counted ? 'counted' : 'reference'][row.choice] += row.n;
	return result;
}
