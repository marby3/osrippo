// Issue #125 基準1：課題の一覧の絞り込み「法案あり」の URL（信頼の境界）
import { expect, test } from 'vitest';
import { listHref, parseListQuery } from './issues';

const parse = (search: string) => parseListQuery(new URLSearchParams(search));

test('houan=ari で法案ありの絞り込みになり、探す言葉と並びは残る', () => {
	expect(parse('houan=ari&q=自転車&sort=new')).toEqual({
		sort: 'new',
		topic: 'all',
		solutions: false,
		bills: true,
		q: '自転車',
		page: 1
	});
	expect(parse('')).toMatchObject({ bills: false });
});

test.each([
	['houan=yes', 'ari 以外の値'],
	['houan=ari&kaiketsu=ari', '解決策ありと一緒'],
	['houan=ari&topic=current', '今回のお題と一緒']
])('形が違う（%s：%s）と null（404）', (search) => {
	expect(parse(search)).toBeNull();
});

test('法案ありの一覧の URL は houan=ari を付け、往復しても同じ', () => {
	const q = { sort: 'bridge', topic: 'all', solutions: false, bills: true, q: '自転車', page: 2 } as const;
	const href = listHref(q);
	expect(href).toBe('/kadai?houan=ari&q=%E8%87%AA%E8%BB%A2%E8%BB%8A&page=2');
	expect(parse(href.split('?')[1])).toEqual(q);
});

// Issue #126 基準1・4（決めること D）：既定の並びは立場を超えた支持順（sort なし）。「わかる」の多い順は sort=support
test('sort がなければ立場を超えた支持順、sort=support は「わかる」の多い順。sort=bridge は形が違う', () => {
	expect(parse('')).toMatchObject({ sort: 'bridge' });
	expect(parse('sort=support')).toMatchObject({ sort: 'support' });
	expect(parse('sort=new')).toMatchObject({ sort: 'new' });
	expect(parse('sort=bridge')).toBeNull();
});

test('立場を超えた支持順の URL には sort を付けず、「わかる」の多い順には sort=support を付ける', () => {
	const base = { topic: 'all', solutions: false, bills: false, q: '', page: 1 } as const;
	expect(listHref({ ...base, sort: 'bridge' })).toBe('/kadai');
	expect(listHref({ ...base, sort: 'support' })).toBe('/kadai?sort=support');
	expect(parse('sort=support')).toEqual({ ...base, sort: 'support' });
});
