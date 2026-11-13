// わたしの記録（/watashi）のキャラクターシート（Issue #171。決めたことは Issue #198 の「#171」の節）。
// 本人だけが読む。得票・順位・票・立場・賛否の傾向は読まない（仕様書「賛否の傾向は実績に一切影響しない」）
import { and, desc, eq, gt, gte, inArray, lt } from 'drizzle-orm';
import { actions, amendments, billCosponsors, billLaws, bills, chairTerms, laws } from '../db/schema';
import { billProgress, PARTICIPANT_KINDS, referralSession } from '../domain/bills';
import { AMENDMENT_SHOWN } from '../domain/amendments';
import { articleLabel } from '../domain/law/parse';
import type { Session } from '../domain/session';
import { billStage, type BillStage } from '../domain/votes';
import { adjustmentsFor } from './if-world';
import type { Db } from './law';
import { resultsFor, reviewsFor } from './results';

/**
 * その会期に委員会に所属しているか：その会期に、今月の参加者に数える行動（課題・解決策・法案・賛同・質疑・答弁・投票など）をしたこと。
 * その会期の委員長・理事の役（解任されたものも）がある人も所属に数える（画面の読み込みで合わせる）。
 * 委員会は1つなので、行動の表から求める（行動に委員会の列はない）
 */
export async function isMember(db: Db, userId: string, session: Session): Promise<boolean> {
	const rows = await db
		.select({ id: actions.id })
		.from(actions)
		.where(and(eq(actions.userId, userId), inArray(actions.kind, PARTICIPANT_KINDS), gte(actions.createdAt, session.startsAt), lt(actions.createdAt, session.endsAt)))
		.limit(1);
	return rows.length > 0;
}

/** その会期の役。順位と得票は読まない */
export async function chairRoleOf(db: Db, userId: string, committeeId: number, session: Session): Promise<{ role: 'chair' | 'director'; recalled: boolean } | null> {
	const [row] = await db
		.select({ role: chairTerms.role, recalledAt: chairTerms.recalledAt })
		.from(chairTerms)
		.where(and(eq(chairTerms.committeeId, committeeId), eq(chairTerms.sessionKey, session.key), eq(chairTerms.userId, userId)));
	return row ? { role: row.role, recalled: row.recalledAt !== null } : null;
}

export type DraftedBill = {
	id: number;
	title: string;
	role: 'author' | 'cosponsor';
	stage: BillStage;
	/** 会期が終わった法案の付託先の会期のキー。終わっていなければ null */
	session: string | null;
};

/** 起草した法案を出す数（結果を引く IN の値の数を、D1 の上限の100より少なく抑える） */
export const DRAFTED_LIMIT = 50;

/**
 * 起草した法案：提出者か、承認された共同提出者の法案。保存していない下書きは出さない。作ったのが新しい順に DRAFTED_LIMIT 件まで。
 * 段階は法案の一覧と同じ求め方（会期が終わった法案は結果、確認中、要調整）
 */
export async function draftedBills(db: Db, userId: string, now: number, minutes: number | null): Promise<{ rows: DraftedBill[]; more: boolean }> {
	const cols = { id: bills.id, title: bills.title, status: bills.status, proposedAt: bills.proposedAt, createdAt: bills.createdAt };
	const [authored, cosponsored] = await Promise.all([
		db
			.select(cols)
			.from(bills)
			.where(and(eq(bills.userId, userId), gt(bills.rev, 0)))
			.orderBy(desc(bills.createdAt), desc(bills.id))
			.limit(DRAFTED_LIMIT + 1),
		db
			.select(cols)
			.from(billCosponsors)
			.innerJoin(bills, eq(bills.id, billCosponsors.billId))
			.where(and(eq(billCosponsors.userId, userId), eq(billCosponsors.status, 'accepted'), gt(bills.rev, 0)))
			.orderBy(desc(bills.createdAt), desc(bills.id))
			.limit(DRAFTED_LIMIT + 1)
	]);
	const all = [...authored.map((r) => ({ ...r, role: 'author' as const })), ...cosponsored.map((r) => ({ ...r, role: 'cosponsor' as const }))].sort((a, b) => b.createdAt - a.createdAt || b.id - a.id);
	const rows = all.slice(0, DRAFTED_LIMIT);

	// 確認の行は結果の行より先に入るので、結果を読んでから確認の行を読む（docs/spec/73.md 決めたこと3）
	const progress = new Map(rows.map((r) => [r.id, billProgress(r, now, minutes)]));
	const ended = rows.filter((r) => progress.get(r.id) === 'lapsed').map((r) => r.id);
	const results = await resultsFor(db, ended);
	const [adjustments, reviews] = await Promise.all([adjustmentsFor(db, ended), reviewsFor(db, ended)]);
	const views = rows.map((r): DraftedBill => {
		const p = progress.get(r.id)!;
		if (p !== 'lapsed') return { id: r.id, title: r.title, role: r.role, stage: billStage(p, null), session: null };
		const session = referralSession(r.proposedAt as number, minutes).key;
		const outcome = results.find((x) => x.billId === r.id && x.sessionKey === session)?.outcome ?? null;
		const review = reviews.find((x) => x.billId === r.id && x.sessionKey === session)?.status ?? null;
		const adjustment = adjustments.find((x) => x.billId === r.id && x.sessionKey === session && x.resolvedAt === null) ?? null;
		return { id: r.id, title: r.title, role: r.role, stage: billStage(p, outcome, adjustment, now, review), session };
	});
	return { rows: views, more: all.length > DRAFTED_LIMIT };
}

export type AdoptedAmendment = { id: number; billId: number; billTitle: string; lawTitle: string; location: string; status: 'accepted' | 'passed' };

/** 採用された修正案を出す数 */
export const ADOPTED_LIMIT = 50;

/** 採用された修正案：取り込まれたか可決した自分の修正案（共同起草者と同じ決まり。coDrafters）のうち、表示中のもの。新しい順に ADOPTED_LIMIT 件まで */
export async function adoptedAmendments(db: Db, userId: string): Promise<{ rows: AdoptedAmendment[]; more: boolean }> {
	const rows = await db
		.select({ id: amendments.id, billId: amendments.billId, billTitle: bills.title, num: amendments.num, status: amendments.status, lawTitle: laws.title, newTitle: billLaws.newTitle })
		.from(amendments)
		.innerJoin(bills, eq(bills.id, amendments.billId))
		.leftJoin(billLaws, and(eq(billLaws.billId, amendments.billId), eq(billLaws.rev, amendments.baseRev), eq(billLaws.seq, amendments.lawSeq)))
		.leftJoin(laws, eq(laws.id, billLaws.lawId))
		.where(and(eq(amendments.userId, userId), inArray(amendments.status, ['accepted', 'passed']), inArray(amendments.moderationStatus, AMENDMENT_SHOWN)))
		.orderBy(desc(amendments.id))
		.limit(ADOPTED_LIMIT + 1);
	const views = rows.slice(0, ADOPTED_LIMIT).map((r) => ({
		id: r.id,
		billId: r.billId,
		billTitle: r.billTitle,
		lawTitle: r.lawTitle ?? r.newTitle ?? '',
		location: articleLabel(r.num),
		status: r.status as 'accepted' | 'passed'
	}));
	return { rows: views, more: rows.length > ADOPTED_LIMIT };
}
