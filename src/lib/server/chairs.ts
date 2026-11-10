// 委員長選挙と理事、解任動議（Issue #77。設計書 docs/spec/77.md）。
// Cron の入口からも読むので、cloudflare:workers と import.meta.env に頼らない
import { and, asc, count, eq, gte, inArray, isNull, lt, max, ne, or, sql } from 'drizzle-orm';
import { billModerationLogs, bills, chairCandidates, CHAIR_ROLES, chairElections, chairTerms, chairVotes, committees, moderationLogs, posts, recallSignatures, user, voteReviews, type STAFF_ROLES } from '../db/schema';
import { ACTING_AFTER, CHAIR_ACCOUNTS_PER_IP, candidacyOpen, consecutiveLimit, electionOpen, electionResult, recallRequirement } from '../domain/chairs';
import { POST_CANDIDACY, POST_CANDIDACY_ACTORS } from '../domain/reports';
import { sessionAt, type Session } from '../domain/session';
import { drawAssignments, SETTLE_GRACE } from '../domain/votes';
import { sessionParticipants } from './bills';
import { activeBan, refuse, type Actor } from './issues';
import type { BatchDb, Db } from './law';
import { notify, notifyStatement } from './notifications';
import { roleOf } from './reports';
import { isEligibleVoter } from './votes';
import { personOf, verifiedColumns, verifiedJoin, verifiedTable } from './verifications';

const isStaff = async (db: Db, userId: string) => (await roleOf(db, userId)) !== null;

export type StandBlock = 'staff' | 'consecutive' | 'noPost';

/**
 * 立候補できない理由。その会期に、その委員会の法案に質疑か答弁を書いた人だけ。
 * 自動の非表示と、委員長か理事の非表示は数え、運営か運営協力者の非表示は数えない（docs/spec/80.md の決定J）
 */
export async function standBlock(db: Db, userId: string, committeeId: number, session: Session, previous: Session): Promise<StandBlock | null> {
	if (await isStaff(db, userId)) return 'staff';
	const chaired = await db
		.select({ key: chairTerms.sessionKey })
		.from(chairTerms)
		.where(and(eq(chairTerms.committeeId, committeeId), eq(chairTerms.userId, userId), eq(chairTerms.role, 'chair'), inArray(chairTerms.sessionKey, [session.key, previous.key])));
	const was = (s: Session) => chaired.some((r) => r.key === s.key);
	if (consecutiveLimit(was(session), was(previous))) return 'consecutive';
	const written = await db
		.select({ id: posts.id })
		.from(posts)
		.innerJoin(bills, eq(bills.id, posts.billId))
		.where(and(eq(posts.userId, userId), eq(posts.sessionKey, session.key), inArray(posts.kind, ['question', 'answer']), or(inArray(posts.status, POST_CANDIDACY), and(eq(posts.status, 'hidden'), inArray(posts.statusActor, POST_CANDIDACY_ACTORS))), eq(bills.committeeId, committeeId)))
		.limit(1);
	return written.length ? null : 'noPost';
}

/** 立候補する。同じ操作は何もしない */
export async function standForChair(db: Db, actor: Actor, committeeId: number, session: Session, previous: Session, now: number): Promise<{ ok: true } | { ok: false; reason: 'closed' | StandBlock }> {
	if (!candidacyOpen(session, now)) return { ok: false, reason: 'closed' };
	const block = await standBlock(db, actor.userId, committeeId, session, previous);
	if (block) return { ok: false, reason: block };
	await db.insert(chairCandidates).values({ committeeId, sessionKey: session.key, userId: actor.userId, createdAt: now }).onConflictDoNothing();
	return { ok: true };
}

/** 立候補を取り下げる（前半のあいだだけ）。その候補への票も一緒に消す。再び立候補しても古い票は戻らない */
export async function withdrawCandidacy(db: BatchDb, actor: Actor, committeeId: number, session: Session, now: number): Promise<boolean> {
	if (!candidacyOpen(session, now)) return false;
	const [row] = await db
		.select({ id: chairCandidates.id })
		.from(chairCandidates)
		.where(and(eq(chairCandidates.committeeId, committeeId), eq(chairCandidates.sessionKey, session.key), eq(chairCandidates.userId, actor.userId)));
	if (!row) return false;
	await db.batch([
		// 票を消す前に、入れた人を読む。候補を指さない（入れた先の記録を残さない）
		notifyStatement(db, sql`SELECT user_id FROM chair_votes WHERE candidate_id = ${row.id} AND user_id IS NOT ${actor.userId}`, 'chair_vote_removed', committeeId, now, now),
		db.delete(chairVotes).where(eq(chairVotes.candidateId, row.id)),
		db.delete(chairCandidates).where(eq(chairCandidates.id, row.id))
	] as never);
	return true;
}

export type VoteBlock = 'staff' | 'ineligible';

/** 投票できない理由。法案の数えた票と同じ資格 */
export async function voteBlock(db: Db, userId: string, session: Session): Promise<VoteBlock | null> {
	if (await isStaff(db, userId)) return 'staff';
	return (await isEligibleVoter(db, userId, session)) ? null : 'ineligible';
}

/** その回線からすでに出している、ほかのアカウントの数が上限に届いているか */
async function lineIsFull(db: Db, table: typeof chairVotes | typeof recallSignatures, committeeId: number, session: Session, actor: Actor) {
	const [row] = await db
		.select({ n: count() })
		.from(table)
		.where(and(eq(table.committeeId, committeeId), eq(table.sessionKey, session.key), eq(table.ipHash, actor.ipHash), ne(table.userId, actor.userId)));
	return row.n >= CHAIR_ACCOUNTS_PER_IP;
}

/** 票を入れる・変える。候補があることは同じ文で確かめる。回線の上限は新しく入れるときだけ見る */
export async function castChairVote(db: Db, actor: Actor, committeeId: number, session: Session, candidateId: number, now: number) {
	if (!electionOpen(session, now)) return { ok: false as const, reason: 'closed' as const };
	const block = await voteBlock(db, actor.userId, session);
	if (block) return { ok: false as const, reason: block };
	if ((await myChairVote(db, committeeId, session, actor.userId)) === null && (await lineIsFull(db, chairVotes, committeeId, session, actor))) {
		return refuse(db, actor, { kind: 'chair-vote-ip' }, now);
	}
	const done = await db
		.insert(chairVotes)
		.select(
			sql`SELECT ${committeeId}, ${session.key}, ${actor.userId}, c.id, ${actor.ipHash}, ${now}, ${now} FROM chair_candidates c WHERE c.id = ${candidateId} AND c.committee_id = ${committeeId} AND c.session_key = ${session.key}`
		)
		.onConflictDoUpdate({ target: [chairVotes.committeeId, chairVotes.sessionKey, chairVotes.userId], set: { candidateId: sql`excluded.candidate_id`, updatedAt: sql`excluded.updated_at` } })
		.returning({ userId: chairVotes.userId });
	return done.length ? { ok: true as const } : { ok: false as const, reason: 'noCandidate' as const };
}

async function myChairVote(db: Db, committeeId: number, session: Session, userId: string) {
	const [row] = await db
		.select({ id: chairVotes.candidateId })
		.from(chairVotes)
		.where(and(eq(chairVotes.committeeId, committeeId), eq(chairVotes.sessionKey, session.key), eq(chairVotes.userId, userId)));
	return row?.id ?? null;
}

/** 選挙の区画のデータ。名前と候補の行の番号だけで、得票、user_id、回線は渡さない。候補の順は読むたびに混ぜる */
export async function electionPage(db: Db, committeeId: number, session: Session, userId: string | null, random: () => number, now: number) {
	const rows = await db
		.select({ id: chairCandidates.id, name: user.name, userId: chairCandidates.userId, ...verifiedColumns })
		.from(chairCandidates)
		.innerJoin(user, eq(user.id, chairCandidates.userId))
		.leftJoin(verifiedTable, verifiedJoin(now))
		.where(and(eq(chairCandidates.committeeId, committeeId), eq(chairCandidates.sessionKey, session.key)))
		.orderBy(asc(chairCandidates.id));
	return {
		candidates: drawAssignments(rows, rows.length, random).map((r) => ({ id: r.id, person: personOf(r) })),
		isCandidate: userId !== null && rows.some((r) => r.userId === userId),
		myVote: userId === null ? null : await myChairVote(db, committeeId, session, userId)
	};
}

/**
 * 確定（docs/spec/77.md 決めたこと3）。確定の印の主キーで、何度走っても最初の結果だけが残る。
 * 同時に走って違うくじを引いても、委員長と理事の行は「この実行が印を入れた」ときだけ入る（同じ時刻の実行は順位の UNIQUE に当たる）。
 * 確定のあとで役職が付いた人のことは見ない。締め出されている候補は除かない（権限は chairPowerOf が止める）
 */
export async function settleElection(db: BatchDb, committeeId: number, session: Session, now: number, random: () => number, minutes: number | null): Promise<void> {
	if (now < session.endsAt + SETTLE_GRACE) return;
	const [known] = await db
		.select({ at: chairElections.settledAt })
		.from(chairElections)
		.where(and(eq(chairElections.committeeId, committeeId), eq(chairElections.sessionKey, session.key)));
	if (known) return;
	const rows = await db
		.select({ userId: chairCandidates.userId, votes: count(chairVotes.userId) })
		.from(chairCandidates)
		.innerJoin(user, eq(user.id, chairCandidates.userId))
		.leftJoin(chairVotes, eq(chairVotes.candidateId, chairCandidates.id))
		.where(and(eq(chairCandidates.committeeId, committeeId), eq(chairCandidates.sessionKey, session.key), isNull(user.role)))
		.groupBy(chairCandidates.id)
		.orderBy(asc(chairCandidates.id));
	const term = sessionAt(session.endsAt, minutes);
	const elected = electionResult(rows, random);
	await db.batch([
		db.insert(chairElections).values({ committeeId, sessionKey: session.key, totalVotes: rows.reduce((sum, r) => sum + r.votes, 0), settledAt: now }).onConflictDoNothing(),
		...elected.map((r) =>
			db
				.insert(chairTerms)
				.select(
					sql`SELECT ${committeeId}, ${term.key}, ${r.userId}, ${r.role}, ${r.rank}, ${r.votes}, NULL, ${now} WHERE EXISTS (SELECT 1 FROM chair_elections e WHERE e.committee_id = ${committeeId} AND e.session_key = ${session.key} AND e.settled_at = ${now})`
				)
				.onConflictDoNothing()
		),
		// 入った行の人に届ける。同時の実行でも、残った結果の人にだけ届く
		...CHAIR_ROLES.map((role) =>
			notifyStatement(db, sql`SELECT user_id FROM chair_terms WHERE committee_id = ${committeeId} AND session_key = ${term.key} AND role = ${role}`, role === 'chair' ? 'chair_elected' : 'director_elected', committeeId, term.startsAt, now)
		)
	] as never);
}

/** 委員長の最後の操作の時刻。委員長の役職で行ったものだけ（課題と解決策と投稿の操作と統合、結果の確認） */
export async function lastChairAction(db: Db, userId: string, term: Session): Promise<number | null> {
	const [[log], [postLog], [review]] = await Promise.all([
		db
			.select({ at: max(moderationLogs.createdAt) })
			.from(moderationLogs)
			.where(and(eq(moderationLogs.actorUserId, userId), eq(moderationLogs.actor, 'chair'), gte(moderationLogs.createdAt, term.startsAt), lt(moderationLogs.createdAt, term.endsAt))),
		db
			.select({ at: max(billModerationLogs.createdAt) })
			.from(billModerationLogs)
			.where(and(eq(billModerationLogs.actorUserId, userId), eq(billModerationLogs.actor, 'chair'), gte(billModerationLogs.createdAt, term.startsAt), lt(billModerationLogs.createdAt, term.endsAt))),
		db
			.select({ at: max(voteReviews.decidedAt) })
			.from(voteReviews)
			.where(and(eq(voteReviews.decidedBy, userId), eq(voteReviews.decidedRole, 'chair'), gte(voteReviews.decidedAt, term.startsAt), lt(voteReviews.decidedAt, term.endsAt)))
	]);
	const latest = Math.max(log?.at ?? -1, postLog?.at ?? -1, review?.at ?? -1);
	return latest < 0 ? null : latest;
}

/** 委員長が7日何もしていないか。時刻から求めるので、委員長が操作すると止まる */
async function chairIdle(db: Db, chairId: string, term: Session, now: number) {
	return now - ((await lastChairAction(db, chairId, term)) ?? term.startsAt) >= ACTING_AFTER;
}

/**
 * 委員長と理事の権限（決めたこと4）。締め出されている人には権限がない。
 * 理事は、委員長が解任された、締め出されている、7日何もしていない、のどれかのときだけ代行できる
 */
export async function chairPowerOf(db: Db, userId: string, now: number, minutes: number | null): Promise<'chair' | 'director' | null> {
	const term = sessionAt(now, minutes);
	const mine = await db
		.select({ committeeId: chairTerms.committeeId, role: chairTerms.role, recalledAt: chairTerms.recalledAt })
		.from(chairTerms)
		.where(and(eq(chairTerms.userId, userId), eq(chairTerms.sessionKey, term.key)));
	if (!mine.length || (await activeBan(db, userId, now)) !== null) return null;
	if (mine.some((r) => r.role === 'chair' && r.recalledAt === null)) return 'chair';
	for (const row of mine.filter((r) => r.role === 'director')) {
		const [chair] = await db
			.select({ userId: chairTerms.userId, recalledAt: chairTerms.recalledAt })
			.from(chairTerms)
			.where(and(eq(chairTerms.committeeId, row.committeeId), eq(chairTerms.sessionKey, term.key), eq(chairTerms.role, 'chair')));
		if (!chair) continue;
		if (chair.recalledAt !== null || (await activeBan(db, chair.userId, now)) !== null || (await chairIdle(db, chair.userId, term, now))) return 'director';
	}
	return null;
}

export type StaffRole = (typeof STAFF_ROLES)[number];

/** 運営の画面の役職。運営と運営協力者が先（委員長がいても運営は操作でき、運営の役職の操作は委員長の操作に数えない） */
export async function staffRoleOf(db: Db, userId: string, now: number, minutes: number | null): Promise<StaffRole | null> {
	return (await roleOf(db, userId)) ?? (await chairPowerOf(db, userId, now, minutes));
}

/** 委員長と理事の区画。名前だけで、順位と得票は渡さない。締め出しのあいだの代行は出さない（締め出しを推測させないため） */
export async function chairPanelOf(db: Db, committeeId: number, session: Session, now: number) {
	const rows = await db
		.select({ name: user.name, userId: chairTerms.userId, role: chairTerms.role, recalledAt: chairTerms.recalledAt, ...verifiedColumns })
		.from(chairTerms)
		.innerJoin(user, eq(user.id, chairTerms.userId))
		.leftJoin(verifiedTable, verifiedJoin(now))
		.where(and(eq(chairTerms.committeeId, committeeId), eq(chairTerms.sessionKey, session.key)))
		.orderBy(asc(user.name));
	const chair = rows.find((r) => r.role === 'chair');
	const directors = rows.filter((r) => r.role === 'director').map(personOf);
	const recalled = chair !== undefined && chair.recalledAt !== null;
	const acting = chair !== undefined && directors.length > 0 && (recalled || (await chairIdle(db, chair.userId, session, now)));
	return { chair: chair ? personOf(chair) : null, directors, recalled, acting, settling: rows.length === 0 && now < session.startsAt + SETTLE_GRACE };
}

export const committeeNameOf = async (db: Db, committeeId: number) => (await db.select({ name: committees.name }).from(committees).where(eq(committees.id, committeeId)))[0]?.name ?? '';

export type RecallBlock = 'closed' | 'forbidden' | 'staff' | 'ineligible';

/** 署名できない理由。委員長がいない・解任のあとは closed。委員長本人と理事は forbidden */
export async function recallBlock(db: Db, userId: string, committeeId: number, session: Session): Promise<RecallBlock | null> {
	const rows = await db
		.select({ userId: chairTerms.userId, role: chairTerms.role, recalledAt: chairTerms.recalledAt })
		.from(chairTerms)
		.where(and(eq(chairTerms.committeeId, committeeId), eq(chairTerms.sessionKey, session.key)));
	const chair = rows.find((r) => r.role === 'chair');
	if (!chair || chair.recalledAt !== null) return 'closed';
	if (rows.some((r) => r.userId === userId)) return 'forbidden';
	if (await isStaff(db, userId)) return 'staff';
	return (await isEligibleVoter(db, userId, session)) ? null : 'ineligible';
}

/** 解任されていない委員長の行があること（署名と取り消しの文の条件） */
const chairInOffice = (committeeId: number, session: Session) =>
	sql`EXISTS (SELECT 1 FROM chair_terms t WHERE t.committee_id = ${committeeId} AND t.session_key = ${session.key} AND t.role = 'chair' AND t.recalled_at IS NULL)`;

/**
 * 署名する。必要な人数に届くと、同じ batch の確定の文で解任する（動議のあとの投票はしない）。
 * 必要な人数は今月の参加者から求める（会期ごとに固定）。押し直しでも確定の文が走る
 */
export async function signRecall(db: BatchDb, actor: Actor, committeeId: number, session: Session, previous: Session, now: number) {
	const block = await recallBlock(db, actor.userId, committeeId, session);
	if (block) return { ok: false as const, reason: block };
	const here = and(eq(recallSignatures.committeeId, committeeId), eq(recallSignatures.sessionKey, session.key));
	const signed = await db.select({ userId: recallSignatures.userId }).from(recallSignatures).where(and(here, eq(recallSignatures.userId, actor.userId)));
	if (!signed.length && (await lineIsFull(db, recallSignatures, committeeId, session, actor))) return refuse(db, actor, { kind: 'recall-ip' }, now);
	const required = recallRequirement(await sessionParticipants(db, committeeId, session, previous, now));
	await db.batch([
		db
			.insert(recallSignatures)
			.select(sql`SELECT ${committeeId}, ${session.key}, ${actor.userId}, ${actor.ipHash}, ${now} WHERE ${chairInOffice(committeeId, session)}`)
			.onConflictDoNothing(),
		db
			.update(chairTerms)
			.set({ recalledAt: now })
			.where(
				sql`${eq(chairTerms.committeeId, committeeId)} AND ${eq(chairTerms.sessionKey, session.key)} AND role = 'chair' AND recalled_at IS NULL
				AND (SELECT count(*) FROM recall_signatures r WHERE r.committee_id = ${committeeId} AND r.session_key = ${session.key}) >= ${required}`
			)
	] as never);
	const recalled = (await recallBlock(db, actor.userId, committeeId, session)) === 'closed';
	if (recalled) await notify(db, sql`SELECT user_id FROM chair_terms WHERE committee_id = ${committeeId} AND session_key = ${session.key}`, 'chair_recalled', committeeId, session.startsAt, now);
	return { ok: true as const, recalled };
}

/** 署名を取り消す。解任のあとは取り消せない */
export async function cancelRecallSignature(db: Db, actor: Actor, committeeId: number, session: Session): Promise<boolean> {
	const done = await db
		.delete(recallSignatures)
		.where(and(eq(recallSignatures.committeeId, committeeId), eq(recallSignatures.sessionKey, session.key), eq(recallSignatures.userId, actor.userId), chairInOffice(committeeId, session)))
		.returning({ userId: recallSignatures.userId });
	return done.length > 0;
}

/** 解任動議の区画：人数と必要な人数だけ。だれが署名したかは渡さない */
export async function recallStateOf(db: Db, committeeId: number, session: Session, previous: Session, userId: string | null, now: number) {
	const here = and(eq(recallSignatures.committeeId, committeeId), eq(recallSignatures.sessionKey, session.key));
	const [[total], mine, terms] = await Promise.all([
		db.select({ n: count() }).from(recallSignatures).where(here),
		userId === null ? Promise.resolve([]) : db.select({ userId: recallSignatures.userId }).from(recallSignatures).where(and(here, eq(recallSignatures.userId, userId))),
		db
			.select({ recalledAt: chairTerms.recalledAt })
			.from(chairTerms)
			.where(and(eq(chairTerms.committeeId, committeeId), eq(chairTerms.sessionKey, session.key), eq(chairTerms.role, 'chair')))
	]);
	return {
		required: recallRequirement(await sessionParticipants(db, committeeId, session, previous, now)),
		signatures: total.n,
		signed: mine.length > 0,
		open: terms[0]?.recalledAt === null
	};
}
