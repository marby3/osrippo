// 選挙期間（Issue #151。#147 の決めること16〜18）
import { and, asc, eq, gt, lte, sql, type SQL } from 'drizzle-orm';
import { electionCandidates, elections, user, userVerifications } from '../db/schema';
import { electionPeriod } from '../domain/election';
import type { BatchDb, Db } from './law';
import { activeVerification } from './verifications';

/** いま選挙期間か（どれか1つの選挙の期間に入っている） */
const inPeriod = (now: number) => and(lte(elections.startsAt, now), gt(elections.endsAt, now));

/** いま選挙期間か。期間のあいだは、すべての議員の機能を止める（国政選挙として扱う） */
export async function electionActive(db: Db, now: number): Promise<boolean> {
	const [row] = await db.select({ id: elections.id }).from(elections).where(inPeriod(now)).limit(1);
	return Boolean(row);
}

/**
 * 名前を出さない人の条件（user_verifications の行に対して）。選挙期間中の議員と、その選挙に立候補した有識者。
 * 名前を返す関数は、すべてこの式を通す（docs/spec/157.md の 5 の名前の出し方と同じ1か所）
 */
export function hiddenDuringElection(now: number): SQL<number> {
	return sql<number>`EXISTS (SELECT 1 FROM ${elections} e WHERE e.starts_at <= ${now} AND e.ends_at > ${now} AND (${userVerifications.kind} = 'legislator' OR EXISTS (SELECT 1 FROM ${electionCandidates} c WHERE c.election_id = e.id AND c.user_id = ${userVerifications.userId})))`;
}

/** 運営の画面の一覧：新しい公示日の順。立候補した有識者の表示する名前も */
export async function electionList(db: Db) {
	const rows = await db.select().from(elections).orderBy(asc(elections.startsAt), asc(elections.id));
	const candidates = rows.length
		? await db
				.select({ electionId: electionCandidates.electionId, name: userVerifications.displayName, userName: user.name })
				.from(electionCandidates)
				.innerJoin(user, eq(user.id, electionCandidates.userId))
				.leftJoin(userVerifications, eq(userVerifications.userId, electionCandidates.userId))
		: [];
	return rows.map((e) => ({
		id: e.id,
		name: e.name,
		notice: e.noticeDate,
		vote: e.voteDate,
		startsAt: e.startsAt,
		candidates: candidates.filter((c) => c.electionId === e.id).map((c) => c.name ?? c.userName)
	}));
}

/** 登録する */
export async function addElection(db: Db, input: { name: string; notice: string; vote: string }, actorId: string, now: number): Promise<void> {
	const { startsAt, endsAt } = electionPeriod(input.notice, input.vote);
	await db.insert(elections).values({ name: input.name, noticeDate: input.notice, voteDate: input.vote, startsAt, endsAt, createdBy: actorId, createdAt: now });
}

/** 始まる前の選挙だけ取り消せる。消せたかを返す */
export async function removeElection(db: BatchDb, id: number, now: number): Promise<boolean> {
	const [row] = await db.select({ startsAt: elections.startsAt }).from(elections).where(eq(elections.id, id));
	if (!row || row.startsAt <= now) return false;
	await db.batch([db.delete(electionCandidates).where(eq(electionCandidates.electionId, id)), db.delete(elections).where(and(eq(elections.id, id), gt(elections.startsAt, now)))] as never);
	return true;
}

export type CandidateError = 'noElection' | 'noExpert';

/** 立候補した有識者に印を付ける。表示名で選び、いま有効な有識者の認証がある人だけ */
export async function markCandidate(db: Db, electionId: number, target: string, now: number): Promise<{ ok: true } | { ok: false; error: CandidateError }> {
	const [election] = await db.select({ id: elections.id }).from(elections).where(eq(elections.id, electionId));
	if (!election) return { ok: false, error: 'noElection' };
	const [expert] = await db
		.select({ id: user.id })
		.from(user)
		.innerJoin(userVerifications, and(eq(userVerifications.userId, user.id), eq(userVerifications.kind, 'expert'), activeVerification(now)))
		.where(eq(user.name, target));
	if (!expert) return { ok: false, error: 'noExpert' };
	await db.insert(electionCandidates).values({ electionId, userId: expert.id, createdAt: now }).onConflictDoNothing();
	return { ok: true };
}
