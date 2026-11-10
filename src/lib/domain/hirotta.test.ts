// Issue #150：「質問で取り上げた」に添える会議録の URL の形（基準2）
import { expect, test } from 'vitest';
import { parseKokkaiUrl } from './hirotta';

test('国会会議録検索システムの https の URL だけを受け付ける', () => {
	expect(parseKokkaiUrl(' https://kokkai.ndl.go.jp/txt/121104024X00320230315/12 ')).toBe('https://kokkai.ndl.go.jp/txt/121104024X00320230315/12');
	for (const bad of [
		'http://kokkai.ndl.go.jp/txt/1',
		'https://example.com/txt/1',
		'https://kokkai.ndl.go.jp.evil.example/txt/1',
		'https://user@kokkai.ndl.go.jp/txt/1',
		'https://kokkai.ndl.go.jp:8443/txt/1',
		'kokkai.ndl.go.jp/txt/1',
		'',
		`https://kokkai.ndl.go.jp/${'a'.repeat(500)}`
	])
		expect(parseKokkaiUrl(bad), bad).toBeNull();
});
