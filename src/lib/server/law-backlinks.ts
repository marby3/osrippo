// 条の「リンク元」（Issue #166。案 SpLawArticle・PcLawArticle の「この条に触れている議論」）。決めたことは Issue #198 の「#166」の節。
// 法案：いまの版（bills.rev）の変える条（bill_changes）から引く。amend・delete は条の内部ID、add は法令と条の番号。下書きと保存していない法案は出さない。
// 課題・解決策・質疑：書いたときに入れた law_refs から引き、元の表と結んで非表示・統合したものを外す。答弁と補足は、その質疑として出す。
// 読む行を抑える：それぞれ新しい順に LIMIT 件まで。law_refs は (law_id, num) の索引、bill_changes は provision_id と num の索引で引く
import { and, desc, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { billChanges, billLaws, bills, issues, lawRefs, posts, solutions } from '../db/schema';
import { billProgress, referralSession } from '../domain/bills';
import { LISTED, POST_SHOWN, SOLUTION_SHOWN } from '../domain/reports';
import { excerpt } from '../domain/toukei';
import { billStage, type BillStage } from '../domain/votes';
import { adjustmentsFor } from './if-world';
import { currentArticleIds } from './law-refs';
import { resultsFor, reviewsFor } from './results';
import type { Db } from './law';

/** それぞれの種類で出す数 */
export const BACKLINKS_LIMIT = 10;

export type BacklinkBill = {
	id: number;
	title: string;
	/** 進み。会期が終わって結果の行がまだない法案は null（「集計中」と出さない。結果を確定させるのは法案の一覧と法案のページ） */
	stage: BillStage | null;
	/** 付託先の会期のキー。発議していない（撤回した下書き）は null */
	session: string | null;
};
export type Discussion = {
	kind: 'issue' | 'solution' | 'question';
	/** 課題は題名、解決策と質疑は本文のはじめ */
	text: string;
	/** 解決策は課題の題名、質疑は法案の題名 */
	context: string | null;
	href: string;
};
/** bills は遊べる法律だけ（読める法律を変える法案はない）。読める法律は null */
export type Backlinks = { bills: BacklinkBill[] | null; discussions: Discussion[] };

/** 空の結果（引けなかったときに出す） */
export const emptyBacklinks = (playable: boolean): Backlinks => ({ bills: playable ? [] : null, discussions: [] });

/** 引けなかったときは空の結果にして、条のページは出す（リンク元は飾り） */
export async function articleBacklinksOrEmpty(db: Db, article: { lawId: string; num: string; playable: boolean }, now: number, minutes: number | null): Promise<Backlinks> {
	try {
		return await articleBacklinks(db, article, now, minutes);
	} catch (e) {
		console.error('条のリンク元を引けませんでした', e);
		return emptyBacklinks(article.playable);
	}
}

export async function articleBacklinks(db: Db, article: { lawId: string; num: string; playable: boolean }, now: number, minutes: number | null): Promise<Backlinks> {
	const [billRows, discussions] = await Promise.all([article.playable ? billsChanging(db, article.lawId, article.num, now, minutes) : null, discussionsOn(db, article.lawId, article.num)]);
	return { bills: billRows, discussions };
}

async function billsChanging(db: Db, lawId: string, num: string, now: number, minutes: number | null): Promise<BacklinkBill[]> {
	const ids = await currentArticleIds(db, lawId, num);
	const shown = and(gt(bills.rev, 0), ne(bills.status, 'draft'));
	const cols = { id: bills.id, title: bills.title, status: bills.status, proposedAt: bills.proposedAt, createdAt: bills.createdAt };
	// いまの版の行だけ（bills.rev と同じ版）
	const atCurrent = and(eq(bills.id, billChanges.billId), eq(bills.rev, billChanges.rev));
	const added = db
		.select(cols)
		.from(billChanges)
		.innerJoin(billLaws, and(eq(billLaws.billId, billChanges.billId), eq(billLaws.rev, billChanges.rev), eq(billLaws.seq, billChanges.lawSeq)))
		.innerJoin(bills, atCurrent)
		.where(and(eq(billChanges.op, 'add'), eq(billChanges.num, num), eq(billLaws.lawId, lawId), shown));
	const rows = ids.length
		? await db
				.select(cols)
				.from(billChanges)
				.innerJoin(bills, atCurrent)
				.where(and(inArray(billChanges.provisionId, ids), shown))
				.union(added)
				.orderBy(sql`created_at DESC`, sql`id DESC`)
				.limit(BACKLINKS_LIMIT)
		: await added.orderBy(desc(bills.createdAt), desc(bills.id)).limit(BACKLINKS_LIMIT);

	// 終わった法案の結果（法案の一覧と同じ求め方）。確認の行は結果の行より先に入るので、結果を読んでから確認の行を読む（docs/spec/73.md 決めたこと3）
	const progress = new Map(rows.map((r) => [r.id, billProgress(r, now, minutes)]));
	const lapsed = rows.filter((r) => progress.get(r.id) === 'lapsed').map((r) => r.id);
	const results = await resultsFor(db, lapsed);
	const [adjustments, reviews] = await Promise.all([adjustmentsFor(db, lapsed), reviewsFor(db, lapsed)]);
	return rows.map((r) => {
		const session = r.proposedAt === null ? null : referralSession(r.proposedAt, minutes).key;
		const p = progress.get(r.id)!;
		if (p !== 'lapsed') return { id: r.id, title: r.title, stage: billStage(p, null), session };
		const outcome = results.find((x) => x.billId === r.id && x.sessionKey === session)?.outcome ?? null;
		const review = reviews.find((x) => x.billId === r.id && x.sessionKey === session)?.status ?? null;
		const adjustment = adjustments.find((x) => x.billId === r.id && x.sessionKey === session && x.resolvedAt === null) ?? null;
		const stage = billStage(p, outcome, adjustment, now, review);
		return { id: r.id, title: r.title, stage: stage === 'counting' ? null : stage, session };
	});
}

async function discussionsOn(db: Db, lawId: string, num: string): Promise<Discussion[]> {
	const on = (kind: 'issue' | 'solution' | 'post') => and(eq(lawRefs.lawId, lawId), eq(lawRefs.num, num), eq(lawRefs.kind, kind));
	const issueRows = db
		.select({ id: issues.id, title: issues.title, at: issues.createdAt })
		.from(lawRefs)
		.innerJoin(issues, eq(issues.id, lawRefs.refId))
		.where(and(on('issue'), inArray(issues.status, LISTED)))
		.orderBy(desc(lawRefs.refId))
		.limit(BACKLINKS_LIMIT);
	// 非表示の課題の解決策も出さない（統合した課題の解決策は、統合先に付け替わっている）
	const solutionRows = db
		.select({ id: solutions.id, issueId: solutions.issueId, body: solutions.body, issueTitle: issues.title, at: solutions.createdAt })
		.from(lawRefs)
		.innerJoin(solutions, eq(solutions.id, lawRefs.refId))
		.innerJoin(issues, eq(issues.id, solutions.issueId))
		.where(and(on('solution'), inArray(solutions.status, SOLUTION_SHOWN), inArray(issues.status, LISTED)))
		.orderBy(desc(lawRefs.refId))
		.limit(BACKLINKS_LIMIT);
	// 答弁と補足は、その質疑として出す（同じ質疑は1つにまとめ、いちばん新しい投稿の時刻で並べる）。触れた投稿と質疑の両方が表示中のときだけ
	const question = alias(posts, 'question');
	const latest = sql<number>`max(${posts.createdAt})`;
	const questionRows = db
		.select({ id: question.id, billId: question.billId, body: question.body, billTitle: bills.title, at: latest })
		.from(lawRefs)
		.innerJoin(posts, eq(posts.id, lawRefs.refId))
		.innerJoin(question, sql`${question.id} = coalesce(${posts.parentId}, ${posts.id})`)
		.innerJoin(bills, eq(bills.id, question.billId))
		.where(and(on('post'), inArray(posts.status, POST_SHOWN), inArray(question.status, POST_SHOWN)))
		.groupBy(question.id)
		.orderBy(desc(latest), desc(question.id))
		.limit(BACKLINKS_LIMIT);
	const [i, s, q] = await Promise.all([issueRows, solutionRows, questionRows]);
	const all: (Discussion & { at: number; order: number })[] = [
		...i.map((r) => ({ kind: 'issue' as const, text: r.title, context: null, href: `/kadai/${r.id}`, at: r.at, order: 0 })),
		...s.map((r) => ({ kind: 'solution' as const, text: excerpt(r.body), context: r.issueTitle, href: `/kadai/${r.issueId}/kaiketsu#kaiketsu-${r.id}`, at: r.at, order: 1 })),
		...q.map((r) => ({ kind: 'question' as const, text: excerpt(r.body), context: r.billTitle, href: `/houan/${r.billId}/shitsugi#shitsugi-${r.id}`, at: r.at, order: 2 }))
	];
	// 新しい順。同じ時刻なら質疑・解決策・課題の順（課題のあとに解決策、解決策のあとに質疑が書かれる）
	return all.sort((x, y) => y.at - x.at || y.order - x.order).map(({ at: _, order: __, ...d }) => d);
}
