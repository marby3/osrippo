// Issue #87：立場別の分布と考えの動きのルール（設計書 docs/spec/87.md）
import { describe, expect, test } from 'vitest';
import { sessionAt } from './session';
import { distributionView, motionView, STATS_MIN, stanceAt, tallyStanceStats, weekEnds } from './stance-stats';

const JST = (s: string) => Date.parse(`${s}+09:00`);
const may = sessionAt(JST('2030-05-10T12:00:00'), null);

describe('weekEnds', () => {
	test('カレンダーの月は8日・15日・22日・翌月1日の0時', () => {
		expect(weekEnds(may)).toEqual([JST('2030-05-08T00:00:00'), JST('2030-05-15T00:00:00'), JST('2030-05-22T00:00:00'), JST('2030-06-01T00:00:00')]);
	});
	test('分の会期は4つに等しく分ける', () => {
		const s = sessionAt(10 * 60_000 + 1, 8);
		expect(weekEnds(s)).toEqual([s.startsAt + 2 * 60_000, s.startsAt + 4 * 60_000, s.startsAt + 6 * 60_000, s.endsAt]);
	});
});

describe('stanceAt', () => {
	const logs = [
		{ userId: 'a', stance: 'for' as const, createdAt: 100 },
		{ userId: 'a', stance: 'against' as const, createdAt: 200 },
		{ userId: 'b', stance: 'against' as const, createdAt: 50 }
	];
	test('その時刻より前の最後の行。ちょうどの変更は入れない', () => {
		expect(stanceAt(logs, 'a', 200)).toBe('for');
		expect(stanceAt(logs, 'a', 201)).toBe('against');
	});
	test('行がなければ未定', () => {
		expect(stanceAt(logs, 'a', 100)).toBe('undecided');
		expect(stanceAt(logs, 'c', 1000)).toBe('undecided');
	});
});

describe('tallyStanceStats', () => {
	const [w1, w2, w3] = weekEnds(may);
	test('締切の時点の立場ごとに数えた票を数え、立場の行がない人は未定。週ごとに一度でも選んだ人を数え、まだ選んでいない週は未定', () => {
		const logs = [
			{ userId: 'a', stance: 'for' as const, createdAt: w1 - 1 },
			{ userId: 'b', stance: 'against' as const, createdAt: w1 + 1 },
			// 未定に戻した人
			{ userId: 'b', stance: 'undecided' as const, createdAt: w3 - 1 },
			// 立場を選んだが投票しなかった人
			{ userId: 'c', stance: 'for' as const, createdAt: w2 }
		];
		const votes = [
			{ userId: 'a', choice: 'yes' as const },
			{ userId: 'b', choice: 'no' as const },
			{ userId: 'd', choice: 'abstain' as const }
		];
		expect(tallyStanceStats(votes, logs, may)).toEqual({
			votes: {
				for: { yes: 1, no: 0, abstain: 0 },
				undecided: { yes: 0, no: 1, abstain: 1 },
				against: { yes: 0, no: 0, abstain: 0 }
			},
			weeks: [
				{ for: 1, undecided: 2, against: 0 },
				{ for: 1, undecided: 1, against: 1 },
				{ for: 2, undecided: 1, against: 0 },
				{ for: 2, undecided: 1, against: 0 }
			]
		});
	});
});

describe('distributionView', () => {
	const group = (yes: number, no: number, abstain: number) => ({ yes, no, abstain });
	test('10人ちょうどの区分は出し、9人の区分は出さない。割合は5%刻みで、人数は返さない', () => {
		expect(STATS_MIN).toBe(10);
		const view = distributionView({ for: group(2, 7, 1), undecided: group(5, 4, 0), against: group(0, 0, 0) });
		expect(view).toEqual({ rows: [{ stance: 'for', yes: 20, no: 70, abstain: 10 }], omitted: true });
	});
	test('区分の並びは賛成寄り・未定・反対寄り。3つの割合を合わせ直さない', () => {
		const view = distributionView({ for: group(4, 4, 4), undecided: group(10, 0, 0), against: group(1, 6, 7) });
		expect(view).toEqual({
			rows: [
				{ stance: 'for', yes: 35, no: 35, abstain: 35 },
				{ stance: 'undecided', yes: 100, no: 0, abstain: 0 },
				{ stance: 'against', yes: 5, no: 45, abstain: 50 }
			],
			omitted: false
		});
	});
	test('どの区分も出せなければ rows は空', () => {
		expect(distributionView({ for: group(3, 0, 0), undecided: group(0, 0, 0), against: group(0, 9, 0) })).toEqual({ rows: [], omitted: true });
	});
});

describe('motionView', () => {
	const week = (f: number, u: number, a: number) => ({ for: f, undecided: u, against: a });
	test('数える人が9人なら null', () => {
		expect(motionView([week(0, 9, 0), week(3, 6, 0), week(3, 3, 3), week(4, 2, 3)])).toBeNull();
	});
	test('10人以上なら週ごとの割合を5%刻みで', () => {
		expect(motionView([week(0, 10, 0), week(3, 7, 0), week(5, 2, 3), week(10, 0, 0)])).toEqual([
			{ week: 1, for: 0, undecided: 100, against: 0 },
			{ week: 2, for: 30, undecided: 70, against: 0 },
			{ week: 3, for: 50, undecided: 20, against: 30 },
			{ week: 4, for: 100, undecided: 0, against: 0 }
		]);
	});
});
