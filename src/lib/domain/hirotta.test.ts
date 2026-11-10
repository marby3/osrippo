// Issue #150：「質問で取り上げた」に添える会議録の URL の形（基準2）
import { expect, test } from 'vitest';
import { parseKokkaiUrl } from './hirotta';

test('国会会議録検索システムの会議録の URL（/txt/会議録の番号、または /txt/会議録の番号/発言の番号）だけを受け付け、会議録の番号を取り出す', () => {
	expect(parseKokkaiUrl(' https://kokkai.ndl.go.jp/txt/121205254X00720231120/12 ')).toEqual({
		url: 'https://kokkai.ndl.go.jp/txt/121205254X00720231120/12',
		meetingId: '121205254X00720231120'
	});
	expect(parseKokkaiUrl('https://kokkai.ndl.go.jp/txt/121205254X00720231120')?.meetingId).toBe('121205254X00720231120');
	for (const bad of [
		'http://kokkai.ndl.go.jp/txt/121205254X00720231120',
		'https://example.com/txt/121205254X00720231120',
		'https://kokkai.ndl.go.jp.evil.example/txt/121205254X00720231120',
		'https://user@kokkai.ndl.go.jp/txt/121205254X00720231120',
		'https://kokkai.ndl.go.jp:8443/txt/121205254X00720231120',
		'https://kokkai.ndl.go.jp/',
		'https://kokkai.ndl.go.jp/txt/abc',
		'https://kokkai.ndl.go.jp/txt/121205254X00720231120/12/3',
		'kokkai.ndl.go.jp/txt/121205254X00720231120',
		'',
		`https://kokkai.ndl.go.jp/txt/121205254X00720231120?${'a'.repeat(500)}`
	])
		expect(parseKokkaiUrl(bad), bad).toBeNull();
});
