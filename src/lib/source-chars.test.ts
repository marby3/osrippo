import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

// 文字の向きを変える制御文字（U+202A〜202E、U+2066〜2069）。ソースには \u の形で書く。
// ここでは文字そのものも \u の書き方も使わず、番号で比べる。
const isBidiControl = (cp: number) =>
	(cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069);

test('追跡しているファイルに、文字の向きを変える制御文字がそのまま入っていない', () => {
	const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
		.split('\0')
		.filter(Boolean);
	const found: string[] = [];
	for (const file of files) {
		let buf: Buffer;
		try {
			buf = readFileSync(file);
		} catch {
			continue; // 消したがまだコミットしていないファイル
		}
		if (buf.includes(0)) continue; // 画像などのバイナリ
		buf
			.toString('utf8')
			.split('\n')
			.forEach((line, i) => {
				for (const ch of line) {
					const cp = ch.codePointAt(0)!;
					if (isBidiControl(cp)) found.push(`${file}:${i + 1} U+${cp.toString(16).toUpperCase()}`);
				}
			});
	}
	expect(found).toEqual([]);
});
