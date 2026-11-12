// Issue #143：法令用語のかんたんな説明の一覧と、その当て方（基準1・4）
import { expect, test } from 'vitest';
import { glossaryNotes, glossParts, glossSegments } from './glossary';

test('基準1：説明の一覧。意味の分かりにくい言葉と、法律で意味の違う言葉に、60字までの説明がある', () => {
	const notes = glossaryNotes();
	expect(notes.length).toBeGreaterThanOrEqual(25);
	expect(notes.length).toBeLessThanOrEqual(40);
	expect(new Set(notes.map((n) => n.word)).size).toBe(notes.length);
	for (const n of notes) {
		expect(n.note.length, n.word).toBeGreaterThan(0);
		expect(n.note.length, n.word).toBeLessThanOrEqual(60);
	}
	const of = (word: string) => notes.find((n) => n.word === word);
	// 読み仮名の一覧の言葉は読みも持つ
	for (const word of ['役務', '準用', '課徴金', '過料', '併科', '承継', '追認']) expect(of(word)?.reading, word).toMatch(/^[ぁ-ゖー]+$/);
	expect(of('役務')?.reading).toBe('えきむ');
	// 読めても法律で意味の違う言葉（読み仮名はない）
	for (const word of ['善意', '悪意', 'みなす', '推定']) expect(of(word), word).toMatchObject({ reading: null });

	// 文の中の言葉に、読み仮名と説明が付く
	expect(glossSegments('善意の第三者に対抗し、役務を')).toEqual([
		{ word: '善意', parts: [{ text: '善意' }], note: of('善意')?.note },
		{ text: 'の第三者に対抗し、' },
		{ word: '役務', parts: [{ text: '役務', rt: 'えきむ' }], note: of('役務')?.note },
		{ text: 'を' }
	]);
	// 読み仮名だけの言葉は、説明なし
	expect(glossSegments('勧誘')).toEqual([{ word: '勧誘', parts: [{ text: '勧誘', rt: 'かんゆう' }], note: null }]);
});

test('基準4：変更点の切れ目が言葉の途中にあるときは、その言葉に説明を付けない。切れ目のない言葉には付け、削除と追加の印は残す', () => {
	const parts = glossParts([{ value: '善' }, { value: '意の役務', removed: true }, { value: '悪意', added: true }]);
	expect(parts.map((p) => p.segments.map((s) => ('word' in s ? s.word : s.text)))).toEqual([['善'], ['意の', '役務'], ['悪意']]);
	expect(parts[1].segments.find((s) => 'word' in s && s.word === '役務')).toMatchObject({ note: expect.any(String) });
	expect(parts.map((p) => [p.removed, p.added])).toEqual([[undefined, undefined], [true, undefined], [undefined, true]]);
});
