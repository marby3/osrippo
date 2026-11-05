// Issue #67 基準7・8・9：スコアの計算、同じ相手の上限、レート制限（設計書 docs/spec/67.md 決めたこと3・7）
import { describe, expect, test } from 'vitest';
import { checkEvaluation, COUNTS_AS_VIOLATION, LIMITS } from './limits';
import { postScores, scoredStance, type ScoreEvaluation, type ScorePost, type ScoreView } from './evaluations';
import type { Stance } from './posts';

/** 投稿1本分の行を作る。読んだ人は別々の人にする（同じ相手の上限に当たらないように） */
function build(post: ScorePost, groups: Partial<Record<Stance, { read: number; evaluated: number }>>) {
	const views: ScoreView[] = [];
	const evaluations: ScoreEvaluation[] = [];
	for (const [stance, { read, evaluated }] of Object.entries(groups) as [Stance, { read: number; evaluated: number }][]) {
		for (let i = 0; i < read; i++) {
			const userId = `p${post.id}-${stance}-${i}`;
			views.push({ postId: post.id, userId, stance });
			if (i < evaluated) evaluations.push({ postId: post.id, userId, kind: 'reasonable', stance, createdAt: i });
		}
	}
	return { views, evaluations };
}
const post = (id: number, stance: Stance, userId = `author-${id}`, billId = 1): ScorePost => ({ id, billId, userId, stance });
const scoreOf = (posts: ScorePost[], built: ReturnType<typeof build>[]) =>
	postScores(
		posts,
		built.flatMap((b) => b.views),
		built.flatMap((b) => b.evaluations)
	);

test('基準7：仕様の計算例のとおり（p0＝0.1、α＝5）。件数ではなく割合で比べる', () => {
	const major = post(1, 'for');
	const minor = post(2, 'against');
	// p0 をちょうど 0.1 にする（数える評価 23 ÷ 読んだ人 230）。読んだ人だけの投稿で分母を足す
	const filler = post(3, 'for');
	const scores = scoreOf(
		[major, minor, filler],
		[
			build(major, { against: { read: 8, evaluated: 2 }, undecided: { read: 15, evaluated: 6 } }),
			build(minor, { for: { read: 60, evaluated: 12 }, undecided: { read: 15, evaluated: 3 } }),
			build(filler, { against: { read: 132, evaluated: 0 } })
		]
	);
	expect(scores.get(1)?.score).toBeCloseTo(0.2788, 3);
	expect(scores.get(2)?.score).toBeCloseTo(0.1888, 3);
});

describe('基準7：数え方', () => {
	const p = post(1, 'for');

	test('同じ立場の人は、読んでも押しても数えない', () => {
		const base = build(p, { against: { read: 5, evaluated: 1 }, undecided: { read: 5, evaluated: 1 } });
		const same = build(p, { for: { read: 50, evaluated: 50 } });
		expect(scoreOf([p], [base, same]).get(1)?.score).toBeCloseTo(scoreOf([p], [base]).get(1)?.score as number, 10);
	});

	test('投稿者が未定なら、賛成寄りと反対寄りの割合の平均を相手側の割合にし、未定の人も数える', () => {
		const u = post(1, 'undecided');
		const built = build(u, { for: { read: 5, evaluated: 5 }, against: { read: 15, evaluated: 0 }, undecided: { read: 10, evaluated: 2 } });
		// p0 = 7 / 30
		const p0 = 7 / 30;
		const rFor = (5 + 5 * p0) / 10;
		const rAgainst = (0 + 5 * p0) / 20;
		const rUnd = (2 + 5 * p0) / 15;
		const expected = (20 * ((rFor + rAgainst) / 2) + 10 * rUnd) / 30;
		expect(scoreOf([u], [built]).get(1)?.score).toBeCloseTo(expected, 10);
	});

	test('相手側も未定も読んだ人が3人未満なら評価不足で null。0点にしない。片方が3人なら計算する', () => {
		expect(scoreOf([p], [build(p, { against: { read: 2, evaluated: 0 }, undecided: { read: 2, evaluated: 0 } })]).get(1)?.score).toBeNull();
		expect(scoreOf([p], [build(p, {})]).get(1)?.score).toBeNull();
		expect(scoreOf([p], [build(p, { against: { read: 3, evaluated: 0 }, undecided: { read: 2, evaluated: 0 } })]).get(1)?.score).toBe(0);
	});

	test('投稿者が未定のとき、評価不足は賛成寄りと反対寄りの合計で判定する', () => {
		const u = post(1, 'undecided');
		expect(scoreOf([u], [build(u, { for: { read: 2, evaluated: 0 }, against: { read: 1, evaluated: 0 } })]).get(1)?.score).toBe(0);
	});

	test('読んだあとで考えを変えて「筋が通っている」を押した人は、評価の立場の読んだ人に数える。「考えが変わった」の立場は使わない', () => {
		const views: ScoreView[] = [
			{ postId: 1, userId: 'x', stance: 'for' },
			{ postId: 1, userId: 'y', stance: 'for' },
			{ postId: 1, userId: 'a', stance: 'against' },
			{ postId: 1, userId: 'b', stance: 'against' }
		];
		const evaluations: ScoreEvaluation[] = [
			// x は賛成寄りで読み、反対寄りに変えて押した → 反対寄りの読んだ人
			{ postId: 1, userId: 'x', kind: 'reasonable', stance: 'against', createdAt: 1 },
			// y は「考えが変わった」だけ反対寄りで押した → 読んだ立場（賛成寄り）のままで、同じ立場なので数えない
			{ postId: 1, userId: 'y', kind: 'changed', stance: 'against', createdAt: 2 }
		];
		// e=1, n=3, p0=1/3 で (1 + 5/3) / (3 + 5) = 1/3
		expect(postScores([p], views, evaluations).get(1)?.score).toBeCloseTo(1 / 3, 10);
		expect(postScores([p], views, evaluations).get(1)?.changed).toBe(1);
	});

	test('読んだ行のない「筋が通っている」は読んだ人に足す。投稿者本人の行は数えない', () => {
		const views: ScoreView[] = ['a', 'b', p.userId].map((userId) => ({ postId: 1, userId, stance: 'against' as const }));
		const evaluations: ScoreEvaluation[] = [
			{ postId: 1, userId: 'c', kind: 'reasonable', stance: 'against', createdAt: 1 },
			{ postId: 1, userId: p.userId, kind: 'reasonable', stance: 'against', createdAt: 2 }
		];
		// e=1, n=3, p0=1/3
		expect(postScores([p], views, evaluations).get(1)?.score).toBeCloseTo(1 / 3, 10);
	});
});

test('基準7：提出者と賛同者は、未定なら賛成寄りとして扱う。ほかの人と、選んだ立場はそのまま', () => {
	expect(scoredStance('undecided', 'author')).toBe('for');
	expect(scoredStance('undecided', 'supporter')).toBe('for');
	expect(scoredStance('undecided', null)).toBe('undecided');
	expect(scoredStance('against', 'author')).toBe('against');
	expect(scoredStance('for', null)).toBe('for');
});

describe('基準8：同じ相手の上限', () => {
	// 同じ投稿者 t の投稿5本に、同じ人 x が押す
	const posts = [1, 2, 3, 4, 5].map((id) => post(id, 'for', 't'));
	const others = (id: number) => ['a', 'b', 'c'].map((userId) => ({ postId: id, userId, stance: 'against' as const }));
	const views: ScoreView[] = posts.flatMap((p) => [{ postId: p.id, userId: 'x', stance: 'against' as const }, ...others(p.id)]);

	test('「筋が通っている」は古い順に3件まで数え、超えた分は評価にも読んだ人にも数えない', () => {
		const evaluations = posts.map((p) => ({ postId: p.id, userId: 'x', kind: 'reasonable' as const, stance: 'against' as const, createdAt: p.id }));
		const scores = postScores(posts, views, evaluations);
		// 数える評価 3、読んだ人は 上限の内の投稿 4人×3本 ＋ 上限の外の投稿 3人×2本 ＝ 18。p0 = 1/6
		const p0 = 3 / 18;
		expect(scores.get(1)?.score).toBeCloseTo((1 + 5 * p0) / (4 + 5), 10);
		expect(scores.get(3)?.score).toBeCloseTo((1 + 5 * p0) / (4 + 5), 10);
		expect(scores.get(4)?.score).toBeCloseTo((0 + 5 * p0) / (3 + 5), 10);
		expect(scores.get(5)?.score).toBeCloseTo((0 + 5 * p0) / (3 + 5), 10);
	});

	test('同じ立場の評価は枠を使わない', () => {
		const evaluations = [
			{ postId: 1, userId: 'x', kind: 'reasonable' as const, stance: 'for' as const, createdAt: 1 },
			{ postId: 2, userId: 'x', kind: 'reasonable' as const, stance: 'for' as const, createdAt: 2 },
			{ postId: 3, userId: 'x', kind: 'reasonable' as const, stance: 'against' as const, createdAt: 3 },
			{ postId: 4, userId: 'x', kind: 'reasonable' as const, stance: 'against' as const, createdAt: 4 },
			{ postId: 5, userId: 'x', kind: 'reasonable' as const, stance: 'against' as const, createdAt: 5 }
		];
		const scores = postScores(posts, views, evaluations);
		// 反対寄りで押した3件はすべて数える
		expect(scores.get(5)?.score).toBeGreaterThan(scores.get(1)?.score as number);
	});

	test('「考えが変わった」は立場を問わず3件まで数え、スコアに足さない。種類ごとに別の枠で、読んだ人に影響しない', () => {
		const changed = posts.map((p) => ({ postId: p.id, userId: 'x', kind: 'changed' as const, stance: 'for' as const, createdAt: p.id }));
		const scores = postScores(posts, views, changed);
		expect(posts.map((p) => scores.get(p.id)?.changed)).toEqual([1, 1, 1, 0, 0]);
		// 評価はない。読んだ人は変わらない
		expect(scores.get(4)?.score).toBe(0);
		const both = postScores(posts, views, [...changed, { postId: 1, userId: 'x', kind: 'reasonable', stance: 'against', createdAt: 9 }]);
		expect(both.get(1)?.changed).toBe(1);
		expect(both.get(1)?.score).toBeGreaterThan(0);
	});

	test('別の人からの評価は枠が別', () => {
		const evaluations = ['p', 'q', 'r', 's'].flatMap((userId) => [{ postId: 1, userId, kind: 'changed' as const, stance: 'for' as const, createdAt: 1 }]);
		expect(postScores(posts, views, evaluations).get(1)?.changed).toBe(4);
	});
});

test('基準9：1アカウント24時間に100回、5分に20回、同じ投稿に同じ回線から3アカウントまで。アカウントの上限は違反に数え、回線は数えない', () => {
	const ok = { op: 'add' as const, accountDay: 0, accountBurst: 0, otherAccountsOnIp: 0, selfAddedRecently: false };
	const kind = (c: Partial<typeof ok> | { op: 'remove' }) => checkEvaluation({ ...ok, ...c })?.kind ?? null;
	expect(LIMITS.evaluationPerDay).toBe(100);
	expect(LIMITS.evaluationPerBurst).toBe(20);
	expect(kind({ accountDay: 99 })).toBeNull();
	expect(kind({ accountDay: 100 })).toBe('evaluation-day');
	expect(kind({ accountBurst: 19 })).toBeNull();
	expect(kind({ accountBurst: 20 })).toBe('evaluation-burst');
	expect(kind({ otherAccountsOnIp: 2 })).toBeNull();
	expect(kind({ otherAccountsOnIp: 3 })).toBe('evaluation-ip');
	// 取り消しと、自分が付けたことのある投稿は回線の上限を見ない
	expect(kind({ otherAccountsOnIp: 3, op: 'remove' })).toBeNull();
	expect(kind({ otherAccountsOnIp: 3, selfAddedRecently: true })).toBeNull();
	expect(COUNTS_AS_VIOLATION['evaluation-day']).toBe(true);
	expect(COUNTS_AS_VIOLATION['evaluation-burst']).toBe(true);
	expect(COUNTS_AS_VIOLATION['evaluation-ip']).toBe(false);
});
