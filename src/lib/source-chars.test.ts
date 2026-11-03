import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

// 文字の向きを変える制御文字（U+202A〜202E、U+2066〜2069）。ソースには文字そのものでなく \u の形で書く。
const BIDI_CONTROL = /[\u202a-\u202e\u2066-\u2069]/;

test('追跡しているファイルに、文字の向きを変える制御文字がそのまま入っていない', () => {
	const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
		.split('\0')
		.filter(Boolean);
	const found: string[] = [];
	for (const file of files) {
		let buf: Buffer;
		try {
			buf = readFileSync(file);
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue; // 消したがまだコミットしていないファイル
			throw e;
		}
		if (buf.includes(0)) continue; // 画像などのバイナリ
		const text = buf.toString('utf8');
		if (!BIDI_CONTROL.test(text)) continue;
		text.split('\n').forEach((line, i) => {
			for (const ch of line) {
				if (BIDI_CONTROL.test(ch)) {
					found.push(`${file}:${i + 1} U+${ch.codePointAt(0)!.toString(16).toUpperCase()}`);
				}
			}
		});
	}
	expect(found).toEqual([]);
});
