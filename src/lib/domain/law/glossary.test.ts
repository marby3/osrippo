// Issue #129：法令用語の読み仮名の一覧と、その当て方（基準1・2・6）
import { describe, expect, test } from 'vitest';
import { glossaryEntries, rubyParts, rubySegments } from './glossary';

describe('基準1：読み仮名の一覧', () => {
	test('例の言葉が入っていて、読みはひらがなで、同じ言葉が2回ない', () => {
		const entries = glossaryEntries();
		const reading = (word: string) =>
			entries
				.find((e) => e.word === word)
				?.parts.map((p) => p.rt ?? '')
				.join('');
		expect(reading('役務')).toBe('えきむ');
		expect(reading('勧誘')).toBe('かんゆう');
		expect(reading('履行')).toBe('りこう');
		expect(reading('附則')).toBe('ふそく');
		for (const e of entries) for (const p of e.parts) if (p.rt !== undefined) expect(p.rt, e.word).toMatch(/^[ぁ-ゖー]+$/);
		expect(new Set(entries.map((e) => e.word)).size).toBe(entries.length);
	});
});

describe('基準2：言葉の上に読み仮名を付ける', () => {
	test('一覧の言葉だけに付け、ほかはそのまま', () => {
		expect(rubySegments('役務提供事業者は、勧誘をしてはならない。')).toEqual([
			{ text: '役務', rt: 'えきむ' },
			{ text: '提供事業者は、' },
			{ text: '勧誘', rt: 'かんゆう' },
			{ text: 'をしてはならない。' }
		]);
		expect(rubySegments('この法律は、公布の日から施行する。')).toEqual([{ text: 'この法律は、公布の日から施行する。' }]);
	});

	test('長い言葉を先に当てる（承継人は承継と人に分けない）。送り仮名には付けない', () => {
		expect(rubySegments('承継人')).toEqual([{ text: '承継人', rt: 'しょうけいにん' }]);
		expect(rubySegments('承継する')).toEqual([{ text: '承継', rt: 'しょうけい' }, { text: 'する' }]);
		expect(rubySegments('甲若しくは乙')).toEqual([{ text: '甲' }, { text: '若', rt: 'も' }, { text: 'しくは乙' }]);
	});
});

test('基準6：変更点の切れ目が言葉の途中にあるときは、その言葉に付けない。切れ目のない言葉には付ける', () => {
	const parts = rubyParts([{ value: '電話勧' }, { value: '誘販売', added: true }, { value: 'の役務' }]);
	expect(parts.map((p) => p.segments)).toEqual([[{ text: '電話勧' }], [{ text: '誘販売' }], [{ text: 'の' }, { text: '役務', rt: 'えきむ' }]]);
	expect(parts[1].added).toBe(true);
});
