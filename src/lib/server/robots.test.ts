// Issue #156：ステージングを検索に載せない（基準1・2・4）
import { describe, expect, test } from 'vitest';
import { withNoindex } from './robots';

describe('基準1・2：NOINDEX が "1" のときだけ X-Robots-Tag を付ける', () => {
	test('"1" なら、ページの応答に noindex, nofollow を付け、中身と状態はそのまま', async () => {
		const res = withNoindex(new Response('<p>ページ</p>', { status: 404, headers: { 'content-type': 'text/html' } }), '1');
		expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
		expect(res.status).toBe(404);
		expect(res.headers.get('content-type')).toBe('text/html');
		expect(await res.text()).toBe('<p>ページ</p>');
	});

	test('ヘッダーを変えられない応答（Response.redirect）にも付ける', () => {
		const res = withNoindex(Response.redirect('https://example.com/kadai', 303), '1');
		expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
		expect(res.status).toBe(303);
		expect(res.headers.get('location')).toBe('https://example.com/kadai');
	});

	test.each([undefined, '', '0', 'true'])('%s なら付けない（本番）', (value) => {
		const original = new Response('x');
		const res = withNoindex(original, value);
		expect(res).toBe(original);
		expect(res.headers.has('x-robots-tag')).toBe(false);
	});
});
