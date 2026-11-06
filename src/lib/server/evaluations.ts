// 評価と読んだ記録を読む・書く（Issue #67。設計書 docs/spec/67.md）。受け取る値は呼ぶ側（post-actions.ts）が確かめる
import { and, count, countDistinct, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import { actions, evaluations, postViews, posts } from '../db/schema';
import { postScores, scoredStance, type EvaluationKind, type EvaluationOp, type PostScore } from '../domain/evaluations';
import { POST_SHOWN } from '../domain/reports';
import { checkEvaluation, DAY, LIMITS } from '../domain/limits';
import type { BillRole } from '../domain/posts';
import { refuse, type Actor } from './issues';
import type { Db } from './law';
import { notify } from './notifications';

const EVALUATION_ACTIONS = ['evaluation_add', 'evaluation_remove'] as const;
/** 書く文と副問い合わせで使う、表示中の状態の並び（設計書 docs/spec/80.md） */
export const POST_SHOWN_SQL = sql.raw(POST_SHOWN.map((s) => `'${s}'`).join(', '));
/** 投稿そのものが表示中か。親の質疑の状態は見ない（非表示の質疑の下の答弁はスコアに数える。決定E） */
const scored = and(inArray(posts.kind, ['question', 'answer']), inArray(posts.status, POST_SHOWN));

/**
 * いまの立場を、書く文の中で読む式。別に読まないので、立場を変えるのと重なっても、どちらかの立場で1行だけ残る。
 * 未定か行がなければ、提出者と賛同者は賛成寄り（決めたこと6）
 */
export const stanceNow = (sessionKey: string, billId: number, userId: string, role: BillRole | null) =>
	sql`COALESCE((SELECT s.stance FROM stances s WHERE s.session_key = ${sessionKey} AND s.bill_id = ${billId} AND s.user_id = ${userId} AND s.stance <> 'undecided'), ${scoredStance('undecided', role)})`;

/** 評価できる投稿：その法案のその会期の見える質疑と答弁（答弁は親の質疑も見える）。なければ undefined */
export async function evaluationTarget(db: Db, postId: number, bill: { id: number; sessionKey: string }) {
	const [row] = await db
		.select({ id: posts.id, userId: posts.userId })
		.from(posts)
		.where(and(eq(posts.id, postId), eq(posts.billId, bill.id), eq(posts.sessionKey, bill.sessionKey), scored, sql`(${posts}.parent_id IS NULL OR EXISTS (SELECT 1 FROM posts q WHERE q.id = ${posts}.parent_id AND q.status IN (${POST_SHOWN_SQL})))`));
	return row;
}

/**
 * 読んだ記録。読んだ時点の立場で1行だけ残し、読み直しても変えない。自分の投稿、ほかの法案、答弁のある質疑（押せないので）は黙って無視する。
 * 番号は D1 の値の数の上限に収めるため、JSON の1つの値で渡す
 */
export async function recordViews(db: Db, userId: string, bill: { id: number; sessionKey: string }, postIds: number[], role: BillRole | null, now: number) {
	await db.run(sql`
		INSERT INTO ${postViews} (post_id, user_id, stance, created_at)
		SELECT p.id, ${userId}, ${stanceNow(bill.sessionKey, bill.id, userId, role)}, ${now}
		FROM posts p
		WHERE p.bill_id = ${bill.id} AND p.session_key = ${bill.sessionKey} AND p.kind IN ('question', 'answer') AND p.status IN (${POST_SHOWN_SQL}) AND p.user_id <> ${userId}
			AND p.id IN (SELECT value FROM json_each(${JSON.stringify(postIds)}))
			AND (p.parent_id IS NULL OR EXISTS (SELECT 1 FROM posts q WHERE q.id = p.parent_id AND q.status IN (${POST_SHOWN_SQL})))
			AND (p.kind = 'answer' OR NOT EXISTS (SELECT 1 FROM posts a WHERE a.parent_id = p.id AND a.kind = 'answer' AND a.status IN (${POST_SHOWN_SQL})))
		ON CONFLICT DO NOTHING`);
}

/** 押す・取り消す。上限を確かめて保存し、行が変わったときだけ記録を足す。role は押す人の役割（立場の扱いに使う） */
export async function setEvaluation(
	db: Db,
	actor: Actor,
	post: { id: number; billId: number; sessionKey: string },
	kind: EvaluationKind,
	op: EvaluationOp,
	role: BillRole | null,
	now: number
) {
	const mine = eq(actions.userId, actor.userId);
	const pressed = inArray(actions.kind, EVALUATION_ACTIONS);
	const [day] = await db.select({ n: count() }).from(actions).where(and(mine, pressed, gt(actions.createdAt, now - DAY)));
	const [burst] = await db.select({ n: count() }).from(actions).where(and(mine, pressed, gt(actions.createdAt, now - LIMITS.burstWindow)));
	const addedHere = and(eq(actions.kind, 'evaluation_add'), eq(actions.targetId, post.id), gt(actions.createdAt, now - DAY));
	const [others] = await db
		.select({ n: countDistinct(actions.userId) })
		.from(actions)
		.where(and(addedHere, eq(actions.ipHash, actor.ipHash), ne(actions.userId, actor.userId)));
	const [self] = await db.select({ n: count() }).from(actions).where(and(addedHere, mine));
	const refusal = checkEvaluation({ op, accountDay: day.n, accountBurst: burst.n, otherAccountsOnIp: others.n, selfAddedRecently: self.n > 0 });
	if (refusal) return refuse(db, actor, refusal, now);

	let rows: unknown[];
	if (op === 'add') {
		// 読む前に押したら読んだことにする
		await recordViews(db, actor.userId, { id: post.billId, sessionKey: post.sessionKey }, [post.id], role, now);
		rows = await db.all(sql`
			INSERT INTO ${evaluations} (post_id, user_id, kind, stance, created_at)
			SELECT ${post.id}, ${actor.userId}, ${kind}, ${stanceNow(post.sessionKey, post.billId, actor.userId, role)}, ${now}
			WHERE true
			ON CONFLICT DO NOTHING
			RETURNING post_id`);
	} else {
		rows = await db
			.delete(evaluations)
			.where(and(eq(evaluations.postId, post.id), eq(evaluations.userId, actor.userId), eq(evaluations.kind, kind)))
			.returning({ postId: evaluations.postId });
	}
	if (rows.length === 0) return { ok: true as const, changed: false };
	await db.insert(actions).values({ kind: op === 'add' ? 'evaluation_add' : 'evaluation_remove', userId: actor.userId, ipHash: actor.ipHash, targetId: post.id, createdAt: now });
	// 投稿ごとに1回だけ（付け外しを繰り返しても増えない）。押した人は持たない
	if (op === 'add' && kind === 'changed') await notify(db, sql`SELECT user_id FROM posts WHERE id = ${post.id} AND user_id IS NOT ${actor.userId}`, 'mind_changed_post', post.id, 0, now);
	return { ok: true as const, changed: true };
}

/** 見ている人がその法案で押した評価。立場は読まない（決めたこと9） */
export async function pressedOnBill(db: Db, userId: string, billId: number) {
	return db
		.select({ postId: evaluations.postId, kind: evaluations.kind })
		.from(evaluations)
		.innerJoin(posts, eq(posts.id, evaluations.postId))
		.where(and(eq(evaluations.userId, userId), eq(posts.billId, billId)));
}

/**
 * 会期の投稿ごとのスコアと「考えが変わった」の数。上限が法案をまたぐので、会期の分をまとめて読む。誰が押したかは返さない。
 * 画面から呼ばない（フェーズ5の実績が呼ぶ）
 */
export async function sessionPostScores(db: Db, sessionKey: string): Promise<Map<number, PostScore>> {
	const inSession = and(eq(posts.sessionKey, sessionKey), scored);
	const [rows, views, evals] = await Promise.all([
		db.select({ id: posts.id, billId: posts.billId, userId: posts.userId, stance: posts.stance }).from(posts).where(inSession),
		db.select({ postId: postViews.postId, userId: postViews.userId, stance: postViews.stance }).from(postViews).innerJoin(posts, eq(posts.id, postViews.postId)).where(inSession),
		db
			.select({ postId: evaluations.postId, userId: evaluations.userId, kind: evaluations.kind, stance: evaluations.stance, createdAt: evaluations.createdAt })
			.from(evaluations)
			.innerJoin(posts, eq(posts.id, evaluations.postId))
			.where(inSession)
	]);
	return postScores(rows, views, evals);
}
