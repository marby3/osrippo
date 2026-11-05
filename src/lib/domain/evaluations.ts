// 評価とスコアの決まり（Issue #67。設計書 docs/spec/67.md 決めたこと6・7）。DB にも画面にも触れない
import type { BillProgress } from './bills';
import type { PostRole, Stance } from './posts';

export const EVALUATION_KINDS = ['reasonable', 'changed'] as const;
export type EvaluationKind = (typeof EVALUATION_KINDS)[number];
export type EvaluationOp = 'add' | 'remove';

/** 補正の強さ（仕様の α） */
const ALPHA = 5;
/** 読んだ人がこれより少なければ評価不足 */
const MIN_READERS = 3;
/** 同じ人から同じ投稿者へ、会期で数える件数（種類ごと） */
const PAIR_CAP = 3;

/** 押せる時期と読んだ記録を取る時期：3週目から採決の締切まで */
export const evaluationOpen = (progress: BillProgress) => progress === 'deliberation' || progress === 'vote';

/** フォームの値。形が違えば null（400） */
export const parseEvaluationKind = (raw: string | null): EvaluationKind | null => ((EVALUATION_KINDS as readonly string[]).includes(String(raw)) ? (raw as EvaluationKind) : null);
export const parseEvaluationOp = (raw: string | null): EvaluationOp | null => (raw === 'add' || raw === 'remove' ? raw : null);

/** 記録に残す立場。提出者と賛同者は法案を支持しているので、未定なら賛成寄り */
export const scoredStance = (stance: Stance, role: PostRole | null): Stance => (stance === 'undecided' && role !== null ? 'for' : stance);

export type ScorePost = { id: number; billId: number; userId: string; stance: Stance };
export type ScoreView = { postId: number; userId: string; stance: Stance };
export type ScoreEvaluation = { postId: number; userId: string; kind: EvaluationKind; stance: Stance; createdAt: number };
export type PostScore = { score: number | null; changed: number };

type Group = { n: number; e: number };
type Groups = Record<Stance, Group>;
/** 投稿者と同じ立場を除いた、数えるグループ。投稿者が未定なら全員 */
const countedStances = (poster: Stance): Stance[] => (poster === 'for' ? ['against', 'undecided'] : poster === 'against' ? ['for', 'undecided'] : ['for', 'against', 'undecided']);

/** 会期の分の行から、投稿ごとのスコアと「考えが変わった」の数を求める。上限が法案をまたぐので会期の分をまとめて渡す */
export function postScores(posts: ScorePost[], views: ScoreView[], evaluations: ScoreEvaluation[]): Map<number, PostScore> {
	const postById = new Map(posts.map((p) => [p.id, p]));
	const changed = new Map<number, number>();
	const counted = new Map<number, Map<Stance, number>>();
	const pressedStance = new Map<string, Stance>();
	const overCap = new Set<string>();
	const pairCounts = new Map<string, number>();
	const key = (postId: number, userId: string) => `${postId}\n${userId}`;
	/** 枠が残っていれば1件使う（投稿者ごと・種類ごと） */
	const takeSlot = (kind: EvaluationKind, userId: string, poster: string) => {
		const pair = `${kind}\n${userId}\n${poster}`;
		const used = pairCounts.get(pair) ?? 0;
		if (used >= PAIR_CAP) return false;
		pairCounts.set(pair, used + 1);
		return true;
	};

	const ordered = evaluations
		.filter((e) => {
			const post = postById.get(e.postId);
			return post !== undefined && post.userId !== e.userId;
		})
		.sort((a, b) => a.createdAt - b.createdAt || a.postId - b.postId);
	for (const e of ordered) {
		const post = postById.get(e.postId) as ScorePost;
		if (e.kind === 'changed') {
			if (takeSlot('changed', e.userId, post.userId)) changed.set(post.id, (changed.get(post.id) ?? 0) + 1);
			continue;
		}
		// 同じ立場の評価は枠を使わない（数えないので）
		if (!countedStances(post.stance).includes(e.stance)) {
			pressedStance.set(key(post.id, e.userId), e.stance);
		} else if (takeSlot('reasonable', e.userId, post.userId)) {
			pressedStance.set(key(post.id, e.userId), e.stance);
			const groups = counted.get(post.id) ?? new Map<Stance, number>();
			groups.set(e.stance, (groups.get(e.stance) ?? 0) + 1);
			counted.set(post.id, groups);
		} else {
			overCap.add(key(post.id, e.userId));
		}
	}

	// 読んだ人：評価を押した人はその立場、ほかの人は読んだ立場。読んだ行のない評価も足す
	const readers = new Map<number, Map<string, Stance>>(posts.map((p) => [p.id, new Map()]));
	for (const v of views) {
		const post = postById.get(v.postId);
		if (post && post.userId !== v.userId) readers.get(v.postId)?.set(v.userId, v.stance);
	}
	for (const [k, stance] of pressedStance) {
		const [postId, userId] = k.split('\n');
		readers.get(Number(postId))?.set(userId, stance);
	}
	for (const k of overCap) {
		const [postId, userId] = k.split('\n');
		readers.get(Number(postId))?.delete(userId);
	}

	const groupsOf = new Map<number, Groups>();
	const billTotals = new Map<number, { n: number; e: number }>();
	for (const post of posts) {
		const groups: Groups = { for: { n: 0, e: 0 }, against: { n: 0, e: 0 }, undecided: { n: 0, e: 0 } };
		for (const stance of readers.get(post.id)?.values() ?? []) groups[stance].n++;
		for (const [stance, e] of counted.get(post.id) ?? []) groups[stance].e = e;
		groupsOf.set(post.id, groups);
		const total = billTotals.get(post.billId) ?? { n: 0, e: 0 };
		for (const stance of countedStances(post.stance)) {
			total.n += groups[stance].n;
			total.e += groups[stance].e;
		}
		billTotals.set(post.billId, total);
	}

	return new Map(
		posts.map((post) => {
			const groups = groupsOf.get(post.id) as Groups;
			const total = billTotals.get(post.billId) as { n: number; e: number };
			const p0 = total.n > 0 ? total.e / total.n : 0;
			const rate = (g: Group) => (g.e + ALPHA * p0) / (g.n + ALPHA);
			const nOpp = post.stance === 'undecided' ? groups.for.n + groups.against.n : groups[post.stance === 'for' ? 'against' : 'for'].n;
			const rOpp = post.stance === 'undecided' ? (rate(groups.for) + rate(groups.against)) / 2 : rate(groups[post.stance === 'for' ? 'against' : 'for']);
			const nUnd = groups.undecided.n;
			const score = nOpp < MIN_READERS && nUnd < MIN_READERS ? null : (nOpp * rOpp + nUnd * rate(groups.undecided)) / (nOpp + nUnd);
			return [post.id, { score, changed: changed.get(post.id) ?? 0 }];
		})
	);
}
