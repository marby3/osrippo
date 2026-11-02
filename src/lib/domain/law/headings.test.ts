// Issue #21 基準1：見出しの木
import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseHeadings } from './index';

const fixture = (id: string) =>
	JSON.parse(readFileSync(new URL(`../../../../tests/fixtures/egov/law_data_${id}.json`, import.meta.url), 'utf8'));

test('基準1：特定商取引法の現在の版から見出しの木を作る', () => {
	const tree = parseHeadings(fixture('351AC0000000057_20260812_508AC0000000064').law_full_text);
	expect(tree.map((h) => h.kind)).toEqual(Array(9).fill('chapter'));
	expect(tree.map((h) => h.num)).toEqual(['1', '2', '3', '4', '5', '5_2', '5_3', '6', '7']);
	expect(tree[5].title).toBe('第五章の二　訪問購入');
	expect(tree[0]).toMatchObject({ title: '第一章　総則', articles: ['1'], children: [] });
	expect(tree[1].articles).toEqual([]);
	expect(tree[1].children.map((h) => [h.kind, h.title])).toEqual([
		['section', '第一節　定義'],
		['section', '第二節　訪問販売'],
		['section', '第三節　通信販売'],
		['section', '第四節　電話勧誘販売'],
		['section', '第五節　雑則']
	]);
	expect(tree[1].children[1].articles.slice(0, 3)).toEqual(['3', '3_2', '4']);
});
