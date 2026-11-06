// 会期の終わりの処理と結果を読むこと（Issue #71。設計書 docs/spec/71.md）。
// Cron の入口（src/worker/scheduled.ts）からも読むので、cloudflare:workers と import.meta.env に頼らない
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { actions, amendments, billResults, bills, billSupports, user, voteReviews, votes, type ROLES } from '../db/schema';
import { newAccountSince, voteAnomalies, type AnomalyDetail, type AnomalySignal, type AnomalyVote } from '../domain/anomalies';
import { billProgress, referralSession } from '../domain/bills';
import { PAGE_SIZE } from '../domain/issues';
import { sessionAt, type Session } from '../domain/session';
import { billOutcome, billStage, quorumRequirement, SETTLE_GRACE } from '../domain/votes';
import { settleAmendments } from './amendments';
import { billById, sessionParticipants, type Bill } from './bills';
import { adjustmentOf, adjustmentRowOf, applySession, ifPlaceOf, importReal } from './if-world';
import type { BatchDb, Db } from './law';
import { countedCondition, inVote, tallyVotes } from './votes';

/** 本案より先に採決した修正案のうち、結果のページに並べる数 */
const AMENDMENT_ROWS = 50;

/** 判定の材料：数えた票の行。回線はその会期の採決の期間の記録の最後（記録がなければ null で、分母に残す） */
async function countedVoteRows(db: Db, session: Session, billId: number): Promise<AnomalyVote[]> {
	const rows = await db
		.select({
			userId: votes.userId,
			registeredAt: sql<number>`${user}.created_at`,
			line: sql<string | null>`(SELECT a.ip_hash FROM ${actions} a WHERE a.kind = 'vote_cast' AND a.user_id = ${votes}.user_id AND a.target_id = ${votes}.bill_id AND a.created_at >= ${session.voteAt} AND a.created_at < ${session.endsAt} ORDER BY a.created_at DESC, a.id DESC LIMIT 1)`,
			choice: votes.choice,
			at: votes.updatedAt
		})
		.from(votes)
		.innerJoin(user, eq(user.id, votes.userId))
		.where(and(eq(votes.sessionKey, session.key), eq(votes.billId, billId), countedCondition(session, votes)));
	return rows;
}

/** 新しいアカウントの基準：前の会期の数えた票のうち、新しいアカウントの票の数。確認中と無効の法案の票は入れない */
async function baselineOf(db: Db, previous: Session) {
	const since = newAccountSince(previous.startsAt);
	const [row] = await db
		.select({ total: count(), newVotes: sql<number>`COALESCE(SUM(CASE WHEN ${user}.created_at >= ${since} THEN 1 ELSE 0 END), 0)` })
		.from(votes)
		.innerJoin(user, eq(user.id, votes.userId))
		.where(
			and(
				eq(votes.sessionKey, previous.key),
				countedCondition(previous, votes),
				sql`NOT EXISTS (SELECT 1 FROM ${voteReviews} r WHERE r.session_key = ${votes}.session_key AND r.bill_id = ${votes}.bill_id AND r.status IN ('open', 'voided'))`
			)
		);
	return { total: row.total, newVotes: row.newVotes };
}

/**
 * 1本の法案の結果を記録する。修正案を先に処理するので、結果の行があれば修正案は当て終わっている。
 * 修正案の処理が別の実行と重なったら結果を書かない。次の実行が続きから進む（docs/spec/71.md 決めたこと1）。
 * 可決と否決は票の偏りを判定し、結果の行より先に確認の行を入れる（docs/spec/73.md 決めたこと3）
 */
async function settleBill(db: BatchDb, session: Session, billId: number, participants: number, baseline: () => Promise<{ total: number; newVotes: number }>, now: number) {
	if (!(await settleAmendments(db, session, billId, participants, now))) {
		console.warn(`法案 ${billId} の修正案の処理が別の実行と重なりました。結果は次の実行で記録します（会期 ${session.key}）`);
		return;
	}
	const { counted, reference } = await tallyVotes(db, session, billId);
	const quorum = quorumRequirement(participants);
	const outcome = billOutcome(counted, quorum);
	if (outcome !== 'lapsed') {
		const found = voteAnomalies(await countedVoteRows(db, session, billId), await baseline(), session.startsAt, quorum, outcome);
		if (found.signals.length) {
			await db
				.insert(voteReviews)
				.values({ sessionKey: session.key, billId, signals: JSON.stringify(found.signals), detail: JSON.stringify(found.detail), status: found.hold ? 'open' : 'noted', createdAt: now })
				.onConflictDoNothing();
		}
	}
	const [bill] = await db.select({ rev: bills.rev }).from(bills).where(eq(bills.id, billId));
	await db
		.insert(billResults)
		.values({
			sessionKey: session.key,
			billId,
			outcome,
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
 * すべての結果が入ったら、可決した法案を IF世界に反映する（docs/spec/72.md 決めたこと5）。minutes は開発用の短い会期（Cron は null）。
 * 反映まで終えたら true（そのあとで現実の改正を取り込んでよい）
 */
export async function settleSession(db: BatchDb, session: Session, previous: Session, now: number, minutes: number | null = null): Promise<boolean> {
	if (now < session.endsAt + SETTLE_GRACE) return false;
	const unsettled = () =>
		db
			.select({ id: bills.id, committeeId: bills.committeeId })
			.from(bills)
			.where(and(inVote(session, previous), sql`NOT EXISTS (SELECT 1 FROM ${billResults} r WHERE r.session_key = ${session.key} AND r.bill_id = ${bills}.id)`))
			.orderBy(asc(bills.proposedAt), asc(bills.id));
	const pending = await unsettled();
	const participants = new Map<number, number>();
	// 前の会期の基準は、結果のない法案があるときだけ、1回だけ求める
	let baselineRow: { total: number; newVotes: number } | undefined;
	const baseline = async () => (baselineRow ??= await baselineOf(db, previous));
	const failed: number[] = [];
	const causes: unknown[] = [];
	for (const bill of pending) {
		try {
			const n = participants.get(bill.committeeId) ?? (await sessionParticipants(db, bill.committeeId, session, previous, now));
			participants.set(bill.committeeId, n);
			await settleBill(db, session, bill.id, n, baseline, now);
		} catch (e) {
			console.error(e);
			failed.push(bill.id);
			causes.push(e);
		}
	}
	if (failed.length) throw new AggregateError(causes, `会期 ${session.key} の法案 ${failed.join(', ')} を処理できませんでした`);
	// 修正案の処理が重なって結果を書かなかった法案があれば、次の実行に任せる
	if (pending.length && (await unsettled()).length) return false;
	await applySession(db, session, minutes, now);
	return true;
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

/**
 * 法案のいまの段階。会期が終わった法案は結果を読み、なければ確定する（docs/spec/71.md 決めたこと5）。
 * 修正案が当たって版が進むので、返す bill は読み直したあとのもの。minutes は開発用の短い会期（本番は null）
 */
export async function billStageNow(db: BatchDb, loaded: NonNullable<Bill>, now: number, minutes: number | null) {
	let bill = loaded;
	const progress = billProgress(bill, now, minutes);
	const result = progress === 'lapsed' ? await resultOnRead(db, bill, minutes, now) : null;
	if (result && result.rev !== bill.rev) bill = (await billById(db, bill.id)) ?? bill;
	const held = result?.review?.status === 'open' || result?.review?.status === 'voided';
	const adjustment = result?.outcome === 'passed' && !held ? await adjustmentOf(db, result.sessionKey, bill.id) : null;
	return { bill, progress, result, adjustment, stage: billStage(progress, result?.outcome ?? null, adjustment, now, result?.review?.status ?? null) };
}

/** その会期のその法案の確認の行 */
export async function reviewOf(db: Db, sessionKey: string, billId: number) {
	const [row] = await db
		.select({ status: voteReviews.status, note: voteReviews.note, signals: voteReviews.signals })
		.from(voteReviews)
		.where(and(eq(voteReviews.sessionKey, sessionKey), eq(voteReviews.billId, billId)));
	return row ?? null;
}

/**
 * 会期が終わった法案の結果と確認の状態。なければ付託先の会期を処理して読み直す。それでもなければ null。
 * 確認の状態を一緒に返すのは、最初の読者に結果が漏れないように（確定の処理のあとで確認の行を読む。docs/spec/73.md 決めたこと4）
 */
export async function resultOnRead(db: BatchDb, bill: { id: number; proposedAt: number | null }, minutes: number | null, now: number) {
	if (bill.proposedAt === null) return null;
	const session = referralSession(bill.proposedAt, minutes);
	const known = await resultOf(db, session.key, bill.id);
	if (known) {
		const review = await reviewOf(db, session.key, bill.id);
		// 否決と廃案、確認中と無効は反映しない。可決で反映済みか要調整なら終わり
		if (known.outcome !== 'passed' || review?.status === 'open' || review?.status === 'voided') return { ...known, review };
		if ((await ifPlaceOf(db, bill.id, known.rev)) || (await adjustmentRowOf(db, known.sessionKey, bill.id))) return { ...known, review };
	}
	// まだ結果がないか、反映の前に失敗していたのでやり直す（docs/spec/72.md 決めたこと5）
	await settleOnRead(db, session, sessionAt(session.startsAt - 1, minutes), now, minutes);
	const row = await resultOf(db, session.key, bill.id);
	return row ? { ...row, review: await reviewOf(db, session.key, bill.id) } : null;
}

/**
 * Cron の処理（docs/spec/73.md 決めたこと4）。確定して未反映の法案の会期を古い順に、そのあと直前の会期を処理する。
 * 会期ごとに失敗を受け止めて残りを続け、最後にまとめて投げ直す
 */
export async function runSessionEnd(db: BatchDb, now: number) {
	const current = sessionAt(now, null);
	const last = sessionAt(current.startsAt - 1, null);
	const waiting = await db
		.select({ proposedAt: bills.proposedAt })
		.from(voteReviews)
		.innerJoin(bills, eq(bills.id, voteReviews.billId))
		.innerJoin(billResults, and(eq(billResults.sessionKey, voteReviews.sessionKey), eq(billResults.billId, voteReviews.billId)))
		.where(
			and(
				eq(voteReviews.status, 'confirmed'),
				eq(billResults.outcome, 'passed'),
				sql`NOT EXISTS (SELECT 1 FROM if_revisions r WHERE r.bill_id = ${billResults}.bill_id AND r.bill_rev = ${billResults}.rev)`,
				sql`NOT EXISTS (SELECT 1 FROM if_laws l WHERE l.bill_id = ${billResults}.bill_id)`,
				sql`NOT EXISTS (SELECT 1 FROM bill_adjustments a WHERE a.bill_id = ${billResults}.bill_id AND a.session_key = ${billResults}.session_key)`
			)
		);
	const sessions = new Map<string, Session>();
	for (const w of waiting.map((r) => r.proposedAt).filter((t): t is number => t !== null).sort((a, b) => a - b)) {
		const s = referralSession(w, null);
		sessions.set(s.key, s);
	}
	sessions.delete(last.key);
	sessions.set(last.key, last);
	const causes: unknown[] = [];
	let lastDone = false;
	for (const session of sessions.values()) {
		try {
			const done = await settleSession(db, session, sessionAt(session.startsAt - 1, null), now, null);
			if (session.key === last.key) lastDone = done;
		} catch (e) {
			console.error(e);
			causes.push(e);
		}
	}
	// 可決法案の反映のあとで、現実の改正を取り込む（docs/spec/95.md 決めたこと1）。読むときの処理では走らない
	if (lastDone && !causes.length) {
		try {
			await importReal(db, last, now);
		} catch (e) {
			causes.push(e);
		}
	}
	if (causes.length) throw new AggregateError(causes, `${causes.length} つの会期を処理できませんでした`);
}

/**
 * 確認の結果を記録する（確定か無効）。状態を条件に入れた1文なので、確定は1回だけ。結果の行がある確認の行だけを扱う。
 * 確定したら反映する。反映に失敗しても確定は取り消さず、読むときの処理か次の Cron でやり直す。呼ぶ側が役職と関わりを確かめる
 */
export async function decideReview(db: BatchDb, staff: { userId: string; role: (typeof ROLES)[number] }, sessionKey: string, billId: number, decision: 'confirm' | 'void', note: string | null, now: number, minutes: number | null) {
	const done = await db
		.update(voteReviews)
		.set({ status: decision === 'confirm' ? 'confirmed' : 'voided', note, decidedRole: staff.role, decidedBy: staff.userId, decidedAt: now })
		.where(
			and(
				eq(voteReviews.sessionKey, sessionKey),
				eq(voteReviews.billId, billId),
				eq(voteReviews.status, 'open'),
				sql`EXISTS (SELECT 1 FROM ${billResults} r WHERE r.session_key = ${sessionKey} AND r.bill_id = ${billId})`
			)
		)
		.returning({ billId: voteReviews.billId });
	if (done.length === 0) return false;
	if (decision === 'confirm') {
		const [bill] = await db.select({ proposedAt: bills.proposedAt }).from(bills).where(eq(bills.id, billId));
		if (bill?.proposedAt != null) {
			const session = referralSession(bill.proposedAt, minutes);
			await settleOnRead(db, session, sessionAt(session.startsAt - 1, minutes), now, minutes);
		}
	}
	return true;
}

export type PendingReview = {
	billId: number;
	sessionKey: string;
	title: string;
	signals: AnomalySignal[];
	/** 提出者か賛同者。賛否の数と集計を渡さない */
	involved: boolean;
	counts: { yes: number; no: number; abstain: number } | null;
	detail: AnomalyDetail | null;
};

/** 運営の画面：確認中の法案。結果の行があるものだけ。提出者と賛同者（どの版でも）には賛否の数と集計を渡さない */
export async function pendingReviews(db: Db, staffUserId: string): Promise<PendingReview[]> {
	const rows = await db
		.select({
			billId: voteReviews.billId,
			sessionKey: voteReviews.sessionKey,
			signals: voteReviews.signals,
			detail: voteReviews.detail,
			title: bills.title,
			yes: billResults.yes,
			no: billResults.no,
			abstain: billResults.abstain,
			involved: sql<number>`(${bills}.user_id = ${staffUserId} OR EXISTS (SELECT 1 FROM ${billSupports} s WHERE s.bill_id = ${bills}.id AND s.user_id = ${staffUserId}))`
		})
		.from(voteReviews)
		.innerJoin(bills, eq(bills.id, voteReviews.billId))
		.innerJoin(billResults, and(eq(billResults.sessionKey, voteReviews.sessionKey), eq(billResults.billId, voteReviews.billId)))
		.where(eq(voteReviews.status, 'open'))
		.orderBy(asc(voteReviews.createdAt));
	return rows.map((r) => {
		const involved = Boolean(r.involved);
		return {
			billId: r.billId,
			sessionKey: r.sessionKey,
			title: r.title,
			signals: JSON.parse(r.signals) as AnomalySignal[],
			involved,
			counts: involved ? null : { yes: r.yes, no: r.no, abstain: r.abstain },
			detail: involved ? null : (JSON.parse(r.detail) as AnomalyDetail)
		};
	});
}

/** 提出者か賛同者か（どの版の賛同でも） */
export async function involvedInBill(db: Db, billId: number, userId: string) {
	const [bill] = await db.select({ userId: bills.userId }).from(bills).where(eq(bills.id, billId));
	if (bill?.userId === userId) return true;
	const [row] = await db
		.select({ n: count() })
		.from(billSupports)
		.where(and(eq(billSupports.billId, billId), eq(billSupports.userId, userId)));
	return row.n > 0;
}

/** 公開の記録：新しい順に50件ごと。集計と対応した人の ID は返さない */
export async function reviewLogPage(db: Db, page: number) {
	const rows = await db
		.select({
			billId: voteReviews.billId,
			title: bills.title,
			signals: voteReviews.signals,
			status: voteReviews.status,
			role: voteReviews.decidedRole,
			note: voteReviews.note,
			createdAt: voteReviews.createdAt,
			decidedAt: voteReviews.decidedAt
		})
		.from(voteReviews)
		.innerJoin(bills, eq(bills.id, voteReviews.billId))
		// 結果の行が入る前の確認の行は出さない（法案のページの集計中と食い違わないように）
		.innerJoin(billResults, and(eq(billResults.sessionKey, voteReviews.sessionKey), eq(billResults.billId, voteReviews.billId)))
		.orderBy(desc(voteReviews.createdAt), desc(voteReviews.billId))
		.limit(PAGE_SIZE + 1)
		.offset((page - 1) * PAGE_SIZE);
	return { rows: rows.slice(0, PAGE_SIZE).map((r) => ({ ...r, signals: JSON.parse(r.signals) as AnomalySignal[] })), hasNext: rows.length > PAGE_SIZE };
}

/** 一覧の1ページの法案の結果。番号は1ページの件数まで */
export async function resultsFor(db: Db, billIds: number[]) {
	if (!billIds.length) return [];
	return db.select({ billId: billResults.billId, sessionKey: billResults.sessionKey, outcome: billResults.outcome }).from(billResults).where(inArray(billResults.billId, billIds));
}

/** 一覧の1ページの法案の確認の状態。番号は1ページの件数まで */
export async function reviewsFor(db: Db, billIds: number[]) {
	if (!billIds.length) return [];
	return db.select({ billId: voteReviews.billId, sessionKey: voteReviews.sessionKey, status: voteReviews.status }).from(voteReviews).where(inArray(voteReviews.billId, billIds));
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
