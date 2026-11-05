// 会期の終わりの処理と結果を読むこと（Issue #71。設計書 docs/spec/71.md）。
// Cron の入口（src/worker/scheduled.ts）からも読むので、cloudflare:workers と import.meta.env に頼らない
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { amendments, billResults, bills } from '../db/schema';
import { referralSession } from '../domain/bills';
import { sessionAt, type Session } from '../domain/session';
import { billOutcome, quorumRequirement, SETTLE_GRACE } from '../domain/votes';
import { settleAmendments } from './amendments';
import { sessionParticipants } from './bills';
import { adjustmentRowOf, applySession, ifPlaceOf } from './if-world';
import type { BatchDb, Db } from './law';
import { inVote, tallyVotes } from './votes';

/** 本案より先に採決した修正案のうち、結果のページに並べる数 */
const AMENDMENT_ROWS = 50;

/**
 * 1本の法案の結果を記録する。修正案を先に処理するので、結果の行があれば修正案は当て終わっている。
 * 修正案の処理が別の実行と重なったら結果を書かない。次の実行が続きから進む（docs/spec/71.md 決めたこと1）
 */
async function settleBill(db: BatchDb, session: Session, billId: number, participants: number, now: number) {
	if (!(await settleAmendments(db, session, billId, participants, now))) {
		console.warn(`法案 ${billId} の修正案の処理が別の実行と重なりました。結果は次の実行で記録します（会期 ${session.key}）`);
		return;
	}
	const { counted, reference } = await tallyVotes(db, session, billId);
	const quorum = quorumRequirement(participants);
	const [bill] = await db.select({ rev: bills.rev }).from(bills).where(eq(bills.id, billId));
	await db
		.insert(billResults)
		.values({
			sessionKey: session.key,
			billId,
			outcome: billOutcome(counted, quorum),
			yes: counted.yes,
			no: counted.no,
			abstain: counted.abstain,
			refYes: reference.yes,
			refNo: reference.no,
			refAbstain: reference.abstain,
			participants,
			quorum,
			rev: bill.rev,
			settledAt: now
		})
		.onConflictDoNothing();
}

/**
 * 会期の処理。結果のない法案を発議の早い順に処理する。何度呼んでも結果は変わらない。
 * 締切から1分は何もしない。1本が失敗しても残りを続け、最後にまとめて投げ直す。
 * すべての結果が入ったら、可決した法案を IF世界に反映する（docs/spec/72.md 決めたこと5）。minutes は開発用の短い会期（Cron は null）
 */
export async function settleSession(db: BatchDb, session: Session, previous: Session, now: number, minutes: number | null = null): Promise<void> {
	if (now < session.endsAt + SETTLE_GRACE) return;
	const unsettled = () =>
		db
			.select({ id: bills.id, committeeId: bills.committeeId })
			.from(bills)
			.where(and(inVote(session, previous), sql`NOT EXISTS (SELECT 1 FROM ${billResults} r WHERE r.session_key = ${session.key} AND r.bill_id = ${bills}.id)`))
			.orderBy(asc(bills.proposedAt), asc(bills.id));
	const pending = await unsettled();
	const participants = new Map<number, number>();
	const failed: number[] = [];
	const causes: unknown[] = [];
	for (const bill of pending) {
		try {
			const n = participants.get(bill.committeeId) ?? (await sessionParticipants(db, bill.committeeId, session, previous, now));
			participants.set(bill.committeeId, n);
			await settleBill(db, session, bill.id, n, now);
		} catch (e) {
			console.error(e);
			failed.push(bill.id);
			causes.push(e);
		}
	}
	if (failed.length) throw new AggregateError(causes, `会期 ${session.key} の法案 ${failed.join(', ')} を処理できませんでした`);
	// 修正案の処理が重なって結果を書かなかった法案があれば、次の実行に任せる
	if (pending.length && (await unsettled()).length) return;
	await applySession(db, session, minutes, now);
}

/** 読むときの処理。失敗してもページは出す。次に読まれたときか次の Cron でやり直す */
export async function settleOnRead(db: BatchDb, session: Session, previous: Session, now: number, minutes: number | null = null): Promise<void> {
	try {
		await settleSession(db, session, previous, now, minutes);
	} catch (e) {
		console.error(e);
	}
}

/** その会期のその法案の結果 */
export async function resultOf(db: Db, sessionKey: string, billId: number) {
	const [row] = await db
		.select()
		.from(billResults)
		.where(and(eq(billResults.sessionKey, sessionKey), eq(billResults.billId, billId)));
	return row;
}

/** 会期が終わった法案の結果。なければ付託先の会期を処理して読み直す。それでもなければ null */
export async function resultOnRead(db: BatchDb, bill: { id: number; proposedAt: number | null }, minutes: number | null, now: number) {
	if (bill.proposedAt === null) return null;
	const session = referralSession(bill.proposedAt, minutes);
	const known = await resultOf(db, session.key, bill.id);
	if (known && known.outcome !== 'passed') return known;
	// 可決で反映済みか要調整なら終わり。どちらでもなければ、反映の前に失敗していたのでやり直す（docs/spec/72.md 決めたこと5）
	if (known && ((await ifPlaceOf(db, bill.id, known.rev)) || (await adjustmentRowOf(db, known.sessionKey, bill.id)))) return known;
	await settleOnRead(db, session, sessionAt(session.startsAt - 1, minutes), now, minutes);
	return (await resultOf(db, session.key, bill.id)) ?? null;
}

/** 一覧の1ページの法案の結果。番号は1ページの件数まで */
export async function resultsFor(db: Db, billIds: number[]) {
	if (!billIds.length) return [];
	return db.select({ billId: billResults.billId, sessionKey: billResults.sessionKey, outcome: billResults.outcome }).from(billResults).where(inArray(billResults.billId, billIds));
}

/** 本案より先に採決した修正案の状態。票の数は記録していない */
export async function priorAmendmentResults(db: Db, billId: number, sessionKey: string) {
	return db
		.select({ id: amendments.id, num: amendments.num, status: amendments.status })
		.from(amendments)
		.where(and(eq(amendments.billId, billId), eq(amendments.sessionKey, sessionKey), inArray(amendments.status, ['passed', 'failed', 'superseded', 'lapsed'])))
		.orderBy(asc(amendments.id))
		.limit(AMENDMENT_ROWS);
}
