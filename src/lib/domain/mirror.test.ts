// Issue #155 基準4 の形：公開ミラーの Markdown と会期の名前（純粋な関数）
import { expect, test } from 'vitest';
import { articleFileName, articleMarkdown, mirrorFiles, sessionName } from './mirror';

test('基準4：会期の名前、条のファイル名、条の Markdown（1行目に番号と見出し、そのあとに項と号。削除は「削除」だけ）', () => {
	expect(sessionName('2035-04')).toBe('2035年4月の会期');
	expect(sessionName('2035-12')).toBe('2035年12月の会期');
	expect(articleFileName('3_2')).toBe('第3条の2.md');

	expect(
		articleMarkdown({
			num: '3_2',
			caption: '（定義）',
			paragraphs: [
				{ num: '1', text: '第一項の本文', items: [] },
				{ num: '2', text: '第二項の本文', items: [{ num: '1', text: '一号の本文' }, { num: '12_2', text: '十二号の二の本文' }] }
			]
		})
	).toBe('# 第3条の2　（定義）\n\n第一項の本文\n\n2　第二項の本文\n\n一　一号の本文\n\n十二の二　十二号の二の本文\n');

	expect(articleMarkdown({ num: '2', caption: '', paragraphs: [{ num: '1', text: '削除', items: [] }] })).toBe('# 第2条\n\n削除\n');
});

test('不正な入力：受け取った JSON の会期・法令の ID・条の番号がパスにならない形なら投げる', () => {
	const law = (id: string, num = '1') => ({ id, title: 't', enacted: false, articles: [{ num, caption: '', paragraphs: [] }] });
	expect(() => mirrorFiles({ key: '../x', laws: [] })).toThrow();
	expect(() => mirrorFiles({ key: '2035-04', laws: [law('../x')] })).toThrow();
	expect(() => mirrorFiles({ key: '2035-04', laws: [law('L/x')] })).toThrow();
	expect(() => mirrorFiles({ key: '2035-04', laws: [law('L1', '1/../..')] })).toThrow();
	expect(mirrorFiles({ key: '2035-04', laws: [law('if-1', '3_2')] }).has('if-1/第3条の2.md')).toBe(true);
});
