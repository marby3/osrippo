// Issue #153：答弁イベントの日時の読み方
import { expect, test } from 'vitest';
import { parseLocalTime } from './toben';

test('画面の日時を日本時間として読み、実在しない日時は断る（別の日に読み替えない）', () => {
	expect(parseLocalTime('2049-01-10T14:00')).toBe(Date.parse('2049-01-10T14:00:00+09:00'));
	for (const bad of ['2049-02-30T14:00', '2049-13-01T14:00', '2049-01-10T24:00', '2049-01-10T14:60', '2049-01-10 14:00', '']) expect(parseLocalTime(bad), bad).toBeNull();
});
