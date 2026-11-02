// Issue #6 条文を条・項・号に分け、前後の版を対応付ける
import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { alignArticles, parseLaw, type Article, type Match } from './index';

function load(file: string): Article[] {
	const path = new URL(`../../../../tests/fixtures/egov/law_data_${file}.json`, import.meta.url);
	return parseLaw(JSON.parse(readFileSync(path, 'utf8')).law_full_text);
}

const SHOHISHA_BEFORE = '412AC0000000061_20230105_504AC0000000099';
const SHOHISHA_AFTER = '412AC0000000061_20230601_504AC0000000059';

/** 後の版の番号で引く（なくなった条は前の版の番号で引く） */
function byNum<T extends { num: string }>(matches: Match<T>[], num: string, side: 'after' | 'before' = 'after') {
	return matches.find((m) => m[side]?.num === num && (side === 'before' ? !m.after : true));
}

test('基準1：本則の条を条・項・号に分けて順に取り出せる', () => {
	const articles = load(SHOHISHA_AFTER);
	expect(articles).toHaveLength(61);
	expect(articles[0]).toMatchObject({ num: '1', label: '第1条', caption: '（目的）' });
	expect(articles[0].paragraphs[0].text).toMatch(/^この法律は、消費者と事業者との間の情報の質及び量/);
	expect(articles.find((a) => a.num === '6_2')?.label).toBe('第6条の2');

	const art4 = articles.find((a) => a.num === '4')!;
	expect(art4.paragraphs.map((p) => p.num)).toEqual(['1', '2', '3', '4', '5', '6']);
	expect(art4.paragraphs[2].items).toHaveLength(10);
	expect(art4.paragraphs[0].items[0]).toMatchObject({ num: '1' });
	expect(art4.paragraphs[0].items[0].text).toMatch(/^重要事項について事実と異なることを告げること。/);
});

test('基準2：前後の版の条を、似ている度合いの高い順に対応付ける', () => {
	// 消費者契約法 2023-01-05 → 2023-06-01
	const shohisha = alignArticles(load(SHOHISHA_BEFORE), load(SHOHISHA_AFTER));
	expect(byNum(shohisha, '1')).toMatchObject({ kind: 'unchanged', before: { num: '1' } });
	expect(byNum(shohisha, '7')).toMatchObject({ kind: 'amended', before: { num: '7' } });
	expect(byNum(shohisha, '12_3')).toMatchObject({ kind: 'added' });

	// 特定商取引法 2017-06-02 → 2017-12-01：条が繰り下がり、同じ番号に別の中身が入った
	const tokusho = alignArticles(
		load('351AC0000000057_20170602_428AC0000000060'),
		load('351AC0000000057_20171201_428AC0000000060')
	);
	expect(byNum(tokusho, '15_3')).toMatchObject({ before: { num: '15_2' } });
	expect(byNum(tokusho, '24_3')).toMatchObject({ before: { num: '24_2' } });
	expect(byNum(tokusho, '15_2')).toMatchObject({ kind: 'unconfirmed' });
	expect(byNum(tokusho, '15_2')?.before).toBeUndefined();
	expect(byNum(tokusho, '70_2', 'before')).toMatchObject({ kind: 'removed' });
});

test('基準3：結び付いた条の中で、項と号も対応付ける', () => {
	// 消費者契約法 第4条第3項：第3号と第4号が入り、元の第3号〜第8号が第5号〜第10号に繰り下がった
	const shohisha = alignArticles(load(SHOHISHA_BEFORE), load(SHOHISHA_AFTER));
	const art4 = shohisha.find((m) => m.after?.num === '4')!;
	const para3 = art4.paragraphs.find((p) => p.after?.num === '3')!;
	expect(para3.before?.num).toBe('3');
	expect(byNum(para3.items, '5')).toMatchObject({ before: { num: '3' } });
	expect(byNum(para3.items, '7')).toMatchObject({ before: { num: '5' } });
	expect(byNum(para3.items, '10')).toMatchObject({ before: { num: '8' } });
	expect(byNum(para3.items, '3')).toMatchObject({ kind: 'unconfirmed' });
	expect(byNum(para3.items, '4')).toMatchObject({ kind: 'unconfirmed' });
});
