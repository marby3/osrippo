// Issue #143：法令用語のかんたんな説明の一覧と、その当て方（基準1）。基準2〜4は e2e/setsumei.spec.ts
import { expect, test } from 'vitest';
import { glossaryNotes, glossSegments } from './glossary';

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
	// 読めても法律で意味の違う言葉（条文に読み仮名は付けず、説明の枠にだけ読みを出す。かなだけの言葉は読みなし）
	for (const word of ['善意', '悪意', 'みなす', '推定']) expect(of(word), word).toBeDefined();
	expect(of('善意')?.reading).toBe('ぜんい');
	expect(of('みなす')?.reading).toBeNull();

	// 文の中の言葉に、読み仮名と説明が付く
	expect(glossSegments('善意の第三者に対抗し、役務を')).toEqual([
		{ word: '善意', parts: [{ text: '善意' }], reading: 'ぜんい', note: of('善意')?.note },
		{ text: 'の第三者に対抗し、' },
		{ word: '役務', parts: [{ text: '役務', rt: 'えきむ' }], reading: 'えきむ', note: of('役務')?.note },
		{ text: 'を' }
	]);
	// 読み仮名だけの言葉は、説明なし
	expect(glossSegments('勧誘')).toEqual([{ word: '勧誘', parts: [{ text: '勧誘', rt: 'かんゆう' }], reading: null, note: null }]);
});

