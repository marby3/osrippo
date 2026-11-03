// Issue #44 会期の区切り（基準1）と開発用の短い会期（基準3）
import { describe, expect, test } from 'vitest';
import { sessionAt, sessionMinutes } from './session';
import { ja } from '../copy/ja';

/** 日本時間の日時 → ミリ秒 */
const jst = (s: string) => Date.parse(`${s}+09:00`);

describe('基準1：カレンダーの月の会期', () => {
	test('週と段は日で決まり、0時ちょうどは新しい側。どの長さの月でも、年の変わり目でも同じ', () => {
		const cases: [string, string, number, string][] = [
			// [日本時間, 会期, 週, 段]
			['2030-05-01T00:00:00', '2030-05', 1, 'proposal'],
			['2030-05-07T23:59:59.999', '2030-05', 1, 'proposal'],
			['2030-05-08T00:00:00', '2030-05', 2, 'proposal'],
			['2030-05-14T23:59:59.999', '2030-05', 2, 'proposal'],
			['2030-05-15T00:00:00', '2030-05', 3, 'deliberation'],
			['2030-05-21T23:59:59.999', '2030-05', 3, 'deliberation'],
			['2030-05-22T00:00:00', '2030-05', 4, 'vote'],
			['2030-05-31T23:59:59.999', '2030-05', 4, 'vote'],
			['2030-06-01T00:00:00', '2030-06', 1, 'proposal'],
			['2030-06-30T12:00:00', '2030-06', 4, 'vote'],
			['2030-02-28T23:59:59.999', '2030-02', 4, 'vote'],
			['2030-03-01T00:00:00', '2030-03', 1, 'proposal'],
			['2028-02-29T12:00:00', '2028-02', 4, 'vote'],
			['2030-12-31T23:59:59.999', '2030-12', 4, 'vote'],
			['2031-01-01T00:00:00', '2031-01', 1, 'proposal']
		];
		for (const [at, key, week, stage] of cases) {
			const s = sessionAt(jst(at), null);
			expect({ at, key: s.key, week: s.week, stage: s.stage }).toEqual({ at, key, week, stage });
		}
	});

	test('会期の始まりと終わり、質疑と採決の始まりは日本時間の0時', () => {
		const s = sessionAt(jst('2030-12-20T10:00:00'), null);
		expect(s.month).toBe(12);
		expect(s.startsAt).toBe(jst('2030-12-01T00:00:00'));
		expect(s.deliberationAt).toBe(jst('2030-12-15T00:00:00'));
		expect(s.voteAt).toBe(jst('2030-12-22T00:00:00'));
		expect(s.endsAt).toBe(jst('2031-01-01T00:00:00'));
		expect(ja.session.name(s)).toBe('12月の会期');
	});
});

describe('基準3：開発用の短い会期', () => {
	test('SESSION_MINUTES は pnpm dev のときだけ、1〜1440 の整数だけを使う', () => {
		expect(sessionMinutes(true, '8')).toBe(8);
		expect(sessionMinutes(true, '1440')).toBe(1440);
		expect(sessionMinutes(false, '8')).toBeNull();
		for (const raw of [undefined, '', '0', '1441', '-5', '2.5', '8分', ' 8']) expect(sessionMinutes(true, raw)).toBeNull();
	});

	test('分の会期は 2:1:1 に割る（前の半分が発議、次の4分の1が質疑と修正、最後の4分の1が採決）', () => {
		const minute = 60 * 1000;
		// 8分の会期：1970-01-01 から8分で割り切れる時刻から
		const start = jst('2030-05-16T09:08:00');
		expect(start % (8 * minute)).toBe(0);
		const at = (m: number) => sessionAt(start + m * minute, 8);
		expect([0, 1, 2, 3, 4, 5, 6, 7].map((m) => [at(m).week, at(m).stage])).toEqual([
			[1, 'proposal'],
			[1, 'proposal'],
			[2, 'proposal'],
			[2, 'proposal'],
			[3, 'deliberation'],
			[3, 'deliberation'],
			[4, 'vote'],
			[4, 'vote']
		]);
		const s = at(5);
		expect(s.startsAt).toBe(start);
		expect(s.deliberationAt).toBe(start + 4 * minute);
		expect(s.voteAt).toBe(start + 6 * minute);
		expect(s.endsAt).toBe(start + 8 * minute);
		expect(s.month).toBeNull();
		expect(at(8).key).not.toBe(s.key);
		expect(ja.session.name(s)).toBe('9時08分からの会期');
	});
});
