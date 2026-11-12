// Issue #154：統計ページのルール（設計書 docs/spec/154.md）
import { describe, expect, test } from 'vitest';
import { sessionAt } from './session';
import { billBridge, excerpt, rankBridges, rankChanged, sessionFromKey } from './toukei';

const group = (yes: number, no: number, abstain: number) => ({ yes, no, abstain });

describe('sessionFromKey', () => {
	test('YYYY-MM はその月の会期', () => {
		const s = sessionFromKey('2050-05', null);
		expect(s).toEqual(sessionAt(Date.parse('2050-05-10T00:00:00+09:00'), null));
		expect(s?.key).toBe('2050-05');
	});
	test('形が違う・月が範囲の外なら null', () => {
		for (const bad of ['abc', '2050-5', '2050-13', '2050-00', '2050-05-01', '', 'm8-1']) expect(sessionFromKey(bad, null), bad).toBeNull();
	});
	test('短い会期は、いまの設定の分数と同じときだけ', () => {
		expect(sessionFromKey('m8-3', 8)?.key).toBe('m8-3');
		expect(sessionFromKey('m8-3', 8)?.startsAt).toBe(3 * 8 * 60_000);
		expect(sessionFromKey('m5-3', 8)).toBeNull();
		expect(sessionFromKey('2050-05', 8)).toBeNull();
	});
});

describe('billBridge', () => {
	test('賛成寄りと反対寄りの、それぞれの賛成の割合の低いほう。未定の人は入れない', () => {
		expect(billBridge({ for: group(9, 1, 0), undecided: group(0, 30, 0), against: group(3, 6, 1) })).toBeCloseTo(0.3);
	});
	test('どちらかが10人に満たなければ null（10人ちょうどは数える）', () => {
		expect(billBridge({ for: group(10, 0, 0), undecided: group(0, 0, 0), against: group(2, 7, 0) })).toBeNull();
		expect(billBridge({ for: group(10, 0, 0), undecided: group(0, 0, 0), against: group(2, 7, 1) })).toBeCloseTo(0.2);
	});
});

describe('rankBridges', () => {
	test('null を除き、丸めた値の高い順、同じなら番号の順に10本まで。返すのは丸めた値だけ', () => {
		const rows = [
			{ billId: 5, title: 'e', bridge: 0.31 },
			{ billId: 2, title: 'b', bridge: 0.29 },
			{ billId: 3, title: 'c', bridge: null },
			{ billId: 1, title: 'a', bridge: 0.5 },
			...Array.from({ length: 10 }, (_, i) => ({ billId: 100 + i, title: `x${i}`, bridge: 0.1 }))
		];
		const ranked = rankBridges(rows);
		expect(ranked).toHaveLength(10);
		expect(ranked.slice(0, 3)).toEqual([
			{ billId: 1, title: 'a', ratio: 50 },
			// 0.31 と 0.29 はどちらも 30%。丸める前の値ではなく番号の順
			{ billId: 2, title: 'b', ratio: 30 },
			{ billId: 5, title: 'e', ratio: 30 }
		]);
		expect(ranked[3]).toEqual({ billId: 100, title: 'x0', ratio: 10 });
	});
});

describe('rankChanged', () => {
	test('10人以上だけを多い順、同じなら番号の順に10件。番号だけを返す', () => {
		const rows = [
			{ postId: 7, changed: 9 },
			{ postId: 3, changed: 10 },
			{ postId: 9, changed: 25 },
			{ postId: 1, changed: 10 },
			...Array.from({ length: 10 }, (_, i) => ({ postId: 100 + i, changed: 11 }))
		];
		const ranked = rankChanged(rows);
		expect(ranked).toHaveLength(10);
		expect(ranked[0]).toBe(9);
		expect(ranked.slice(1)).toEqual([100, 101, 102, 103, 104, 105, 106, 107, 108]);
		expect(rankChanged(rows.filter((r) => r.changed <= 10))).toEqual([1, 3]);
	});
});

describe('excerpt', () => {
	test('60字までそのまま、それより長ければ60字と「…」', () => {
		expect(excerpt('あ'.repeat(60))).toBe('あ'.repeat(60));
		expect(excerpt('あ'.repeat(61))).toBe(`${'あ'.repeat(60)}…`);
	});
});
