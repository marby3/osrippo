// 質疑・答弁・補足と立場を読む・書く（Issue #66。設計書 docs/spec/66.md）。受け取る値は呼ぶ側（post-actions.ts）が確かめる
import { and, asc, count, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { actions, billSupports, posts, stances } from '../db/schema';
import { DAY, LIMITS, checkBillPost } from '../domain/limits';
import { EVALUATION_KINDS, type EvaluationKind } from '../domain/evaluations';
import { QUESTION_PAGE_SIZE, STANCE_CHANGES, type PostKind, type BillRole, type PostRole, type Stance } from '../domain/posts';
import { POST_SHOWN } from '../domain/reports';
import type { Session } from '../domain/session';
import { supportRev } from './bills';
import { pressedOnBill, stanceNow } from './evaluations';
import { POST_SHOWN_SQL } from './post-status';
import { refuse, type Actor } from './issues';
import type { Db } from './law';

const POST_ACTION = { question: 'question_post', answer: 'answer_post', supplement: 'supplement_post' } as const;
const POST_ACTIONS = Object.values(POST_ACTION);

/**
 * 賛同者か。「賛同 N人」と同じ行を数える（発議した版。下書きはいまの版）。直される前の版にだけ賛同した人は、賛同者として答弁できない。
 * 修正案の取り込みで発議のあとに版が進んでも、発議した版の賛同者のまま（docs/spec/68.md 決めたこと8）
 */
export async function isSupporter(db: Db, bill: { id: number; rev: number; proposedRev: number | null }, userId: string): Promise<boolean> {
	const rows = await db
		.select({ userId: billSupports.userId })
		.from(billSupports)
		.where(and(eq(billSupports.billId, bill.id), eq(billSupports.rev, supportRev(bill)), eq(billSupports.userId, userId)))
		.limit(1);
	return rows.length > 0;
}

/** その法案のその会期の質疑。なければ undefined */
export async function questionOf(db: Db, questionId: number, billId: number, sessionKey: string) {
	const [row] = await db
		.select({ id: posts.id, userId: posts.userId, status: posts.status })
		.from(posts)
		.where(and(eq(posts.id, questionId), eq(posts.billId, billId), eq(posts.sessionKey, sessionKey), eq(posts.kind, 'question')));
	return row;
}

/**
 * 上限を確かめて書く。writerRole は書く人の役割（posts.role は答弁だけに入れるので別に受け取る）。書いた時点の立場を残す（docs/spec/67.md 決めたこと6）。
 * 答弁と補足は親の質疑が表示中のときだけ入る1文で書く（確かめたあとに非表示になっても、隠れた質疑の下に増えない。docs/spec/80.md）。入らなければ id は null で、記録を足さない
 */
export async function createPost(
	db: Db,
	actor: Actor,
	post: { billId: number; sessionKey: string; kind: PostKind; parentId: number | null; role: PostRole | null; body: string },
	now: number,
	writerRole: BillRole | null
) {
	const since = now - DAY;
	const mine = eq(actions.userId, actor.userId);
	const allKinds = inArray(actions.kind, POST_ACTIONS);
	const [accountDay] = await db.select({ n: count() }).from(actions).where(and(mine, eq(actions.kind, POST_ACTION[post.kind]), gt(actions.createdAt, since)));
	const [accountBurst] = await db.select({ n: count() }).from(actions).where(and(mine, allKinds, gt(actions.createdAt, now - LIMITS.burstWindow)));
	const [ipDay] = await db.select({ n: count() }).from(actions).where(and(eq(actions.ipHash, actor.ipHash), allKinds, gt(actions.createdAt, since)));
	const refusal = checkBillPost(post.kind, { accountDay: accountDay.n, accountBurst: accountBurst.n, ipDay: ipDay.n });
	if (refusal) return refuse(db, actor, refusal, now);
	const stance = stanceNow(post.sessionKey, post.billId, actor.userId, writerRole);
	const [row] =
		post.parentId === null
			? await db
					.insert(posts)
					.values({ ...post, userId: actor.userId, createdAt: now, stance })
					.returning({ id: posts.id })
			: await db
					.insert(posts)
					// 全列を schema.ts の順に並べる（列を足すとここも直す）。末尾の6つは status_* と merged_into
					.select(sql`SELECT NULL, ${post.billId}, ${post.sessionKey}, ${post.kind}, ${post.parentId}, ${actor.userId}, ${post.role}, ${post.body}, 'visible', ${now}, ${stance}, NULL, NULL, NULL, NULL, NULL, NULL WHERE EXISTS (SELECT 1 FROM posts q WHERE q.id = ${post.parentId} AND q.status IN (${POST_SHOWN_SQL}))`)
					.returning({ id: posts.id });
	if (!row) return { ok: true as const, id: null };
	await db.insert(actions).values({ kind: POST_ACTION[post.kind], userId: actor.userId, ipHash: actor.ipHash, targetId: post.billId, createdAt: now });
	return { ok: true as const, id: row.id };
}

// 副問い合わせの中の id と混ざらないよう、列は表の名前を付けて書く（drizzle の ${table.col} は表名なしの列名になる）
const unanswered = sql`NOT EXISTS (SELECT 1 FROM ${posts} a WHERE a.parent_id = ${posts}.id AND a.kind = 'answer' AND a.status IN (${POST_SHOWN_SQL}))`;
// 関連法案の数に上限がないので、番号は JSON の1つの値で渡す（D1 は1文に100個までしか値を結び付けられない）
const questions = (billId: number, related: number[] = []) =>
	and(
		related.length ? sql`${posts}.bill_id IN (SELECT value FROM json_each(${JSON.stringify([billId, ...related])}))` : eq(posts.billId, billId),
		eq(posts.kind, 'question'),
		inArray(posts.status, POST_SHOWN)
	);

/** 質疑の数（すべて）。related は一緒に数える関連法案 */
export async function questionTotal(db: Db, billId: number, related: number[] = []) {
	const [row] = await db.select({ n: count() }).from(posts).where(questions(billId, related));
	return row.n;
}

/** 答弁待ちの質疑の数。いまの付託先の会期の質疑だけ（前の会期の質疑には答弁できない。docs/spec/72.md の C） */
export async function waitingQuestions(db: Db, billId: number, sessionKey: string) {
	const [row] = await db.select({ n: count() }).from(posts).where(and(questions(billId), eq(posts.sessionKey, sessionKey), unanswered));
	return row.n;
}

/**
 * 質疑のタブのカード。新しい順で、答弁と補足は古い順。返す値に user_id と立場を入れない（自分のものかは mine、押したかは pressed で返す）。
 * 答弁と補足は parent_id IN (…) でまとめて引く（1ページ20件なので、D1 の値の数の上限に収まる）。
 * related を渡すと関連法案の質疑も一緒に返す（Issue #69。どの法案の質疑かは billId で分かる）
 */
export async function listQuestions(db: Db, billId: number, userId: string | null, onlyWaiting: boolean, page: number, related: number[] = [], sessionKey?: string) {
	const rows = await db
		.select({ id: posts.id, billId: posts.billId, sessionKey: posts.sessionKey, body: posts.body, userId: posts.userId, mergedCount: sql<number>`(SELECT count(*) FROM posts m WHERE m.merged_into = ${posts}.id AND m.status = 'merged')` })
		.from(posts)
		.where(onlyWaiting ? and(questions(billId), sessionKey ? eq(posts.sessionKey, sessionKey) : undefined, unanswered) : questions(billId, related))
		.orderBy(desc(posts.id))
		.limit(QUESTION_PAGE_SIZE + 1)
		.offset((page - 1) * QUESTION_PAGE_SIZE);
	const shown = rows.slice(0, QUESTION_PAGE_SIZE);
	const children = shown.length
		? await db
				.select({ id: posts.id, parentId: posts.parentId, kind: posts.kind, role: posts.role, body: posts.body, userId: posts.userId })
				.from(posts)
				.where(and(inArray(posts.parentId, shown.map((q) => q.id)), inArray(posts.status, POST_SHOWN)))
				.orderBy(asc(posts.id))
		: [];
	const of = (id: number, kind: PostKind) => children.filter((c) => c.parentId === id && c.kind === kind);
	const pressedRows = userId !== null && shown.length ? await pressedOnBill(db, userId, billId) : [];
	const pressedOf = (id: number) =>
		Object.fromEntries(EVALUATION_KINDS.map((kind) => [kind, pressedRows.some((r) => r.postId === id && r.kind === kind)])) as Record<EvaluationKind, boolean>;
	return {
		rows: shown.map((q) => ({
			id: q.id,
			billId: q.billId,
			sessionKey: q.sessionKey,
			body: q.body,
			mergedCount: q.mergedCount,
			mine: q.userId === userId,
			pressed: pressedOf(q.id),
			answers: of(q.id, 'answer').map((a) => ({ id: a.id, role: a.role as PostRole, body: a.body, mine: a.userId === userId, pressed: pressedOf(a.id) })),
			supplements: of(q.id, 'supplement').map((s) => ({ id: s.id, body: s.body, mine: s.userId === userId }))
		})),
		hasNext: rows.length > QUESTION_PAGE_SIZE
	};
}

/** 見ている人の立場と、あと何回変えられるか。行がなければ未定（最初に選ぶのは数えない） */
export async function stanceOf(db: Db, sessionKey: string, billId: number, userId: string): Promise<{ stance: Stance; left: number }> {
	const [row] = await db
		.select({ stance: stances.stance, changes: stances.changes })
		.from(stances)
		.where(and(eq(stances.sessionKey, sessionKey), eq(stances.billId, billId), eq(stances.userId, userId)));
	return row ? { stance: row.stance, left: STANCE_CHANGES - row.changes } : { stance: 'undecided', left: STANCE_CHANGES };
}

/**
 * 立場を変える。回数の確かめも同じ文の中で行うので、2つのタブから同時に押しても上限を超えない。履歴（stance_log）はトリガーが足す。
 * 行がないのは未定と同じなので、何も選んでいない人が未定を押しても何も起きない
 */
export async function setStance(db: Db, actor: Actor, bill: { id: number }, session: Pick<Session, 'key'>, stance: Stance, now: number) {
	const changed =
		stance === 'undecided'
			? await db.all(sql`
				UPDATE ${stances} SET stance = 'undecided', changes = changes + 1, updated_at = ${now}
				WHERE session_key = ${session.key} AND bill_id = ${bill.id} AND user_id = ${actor.userId} AND stance <> 'undecided' AND changes < ${STANCE_CHANGES}
				RETURNING changes`)
			: await db.all(sql`
				INSERT INTO ${stances} (session_key, bill_id, user_id, stance, changes, updated_at) VALUES (${session.key}, ${bill.id}, ${actor.userId}, ${stance}, 0, ${now})
				ON CONFLICT (session_key, bill_id, user_id) DO UPDATE SET stance = excluded.stance, changes = stances.changes + 1, updated_at = excluded.updated_at
				WHERE stances.stance <> excluded.stance AND stances.changes < ${STANCE_CHANGES}
				RETURNING changes`);
	if (changed.length === 0) {
		const current = await stanceOf(db, session.key, bill.id, actor.userId);
		return current.stance === stance ? { ok: true as const, changed: false } : { ok: false as const, reason: 'limit' as const };
	}
	await db.insert(actions).values({ kind: 'stance_set', userId: actor.userId, ipHash: actor.ipHash, targetId: bill.id, createdAt: now });
	return { ok: true as const, changed: true };
}
