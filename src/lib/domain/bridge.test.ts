// Issue #149：議員ダッシュボードの割合の丸め（設計書 docs/spec/149.md の 2）
import { expect, test } from 'vitest';
import { roundRatio } from './bridge';

test('5%刻みに丸めた 0〜100 の整数。割合がなければ null', () => {
	expect(roundRatio(0.769)).toBe(75);
	expect(roundRatio(0.774)).toBe(75);
	expect(roundRatio(0.776)).toBe(80);
	expect(roundRatio(0)).toBe(0);
	expect(roundRatio(1)).toBe(100);
	expect(roundRatio(null)).toBeNull();
});
