// Issue #123：投票の画面の変更点は、変わったところの前後だけを出す
import { describe, expect, test } from 'vitest';
import type { DiffPart } from './compare.ts';
import { excerptDiff } from './excerpt.ts';

const same = (value: string): DiffPart => ({ value });
const del = (value: string): DiffPart => ({ value, removed: true });
const ins = (value: string): DiffPart => ({ value, added: true });

describe('excerptDiff', () => {
	test('最初の変わらないところは、変わったところの前の10文字だけを残し、前を「…」にする', () => {
		expect(excerptDiff([same('一二三四五六七八九十ABCDE'), ins('足す')])).toEqual([same('…六七八九十ABCDE'), ins('足す')]);
	});

	test('最後の変わらないところは、変わったところのあとの10文字だけを残し、あとを「…」にする', () => {
		expect(excerptDiff([del('消す'), same('一二三四五六七八九十ABCDE')])).toEqual([del('消す'), same('一二三四五六七八九十…')]);
	});

	test('あいだの変わらないところは、前後10文字ずつを残し、まんなかを「…」にする', () => {
		const middle = '一二三四五六七八九十ABCDEFGHIJあいうえおかきくけこ';
		expect(excerptDiff([del('消す'), same(middle), ins('足す')])).toEqual([
			del('消す'),
			same('一二三四五六七八九十…あいうえおかきくけこ'),
			ins('足す')
		]);
	});

	test('短い変わらないところはそのまま残す', () => {
		const parts = [same('ヘルメットを'), del('かぶるよう努めなければならない'), ins('かぶらなければならない'), same('。')];
		expect(excerptDiff(parts)).toEqual(parts);
	});

	test('あいだがちょうど20文字なら縮めない', () => {
		const middle = '一二三四五六七八九十ABCDEFGHIJ';
		expect(excerptDiff([del('消す'), same(middle), ins('足す')])).toEqual([del('消す'), same(middle), ins('足す')]);
	});

	test('変わったところは長くても全部出す', () => {
		const long = 'あ'.repeat(200);
		expect(excerptDiff([same('前'), del(long), ins(long), same('後')])).toEqual([same('前'), del(long), ins(long), same('後')]);
	});

	test('改行は空白にして1つの段落にする（変わったところも）', () => {
		expect(excerptDiff([same('（目的）\nこの法律は、'), del('古い\n文'), same('。')])).toEqual([
			same('…目的） この法律は、'),
			del('古い 文'),
			same('。')
		]);
	});

	test('丸ごと足した条は、足したところだけ', () => {
		expect(excerptDiff([ins('（定義）\n新しい条')])).toEqual([ins('（定義） 新しい条')]);
	});

	test('数える長さを変えられる', () => {
		expect(excerptDiff([same('一二三四五'), ins('足す')], 2)).toEqual([same('…四五'), ins('足す')]);
	});
});
