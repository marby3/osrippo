// Issue #156：ステージングを検索に載せない（基準1）。SvelteKit が hooks より前に返す応答（末尾のスラッシュの 308 など）も、Worker の入口で包む
import { describe, expect, test } from 'vitest';
import { withNoindexFetch } from './fetch';

const env = (NOINDEX?: string) => ({ NOINDEX }) as unknown as Env;
const ctx = {} as ExecutionContext;

describe('基準1：Worker の入口で、すべての応答に X-Robots-Tag を付ける', () => {
	test('アプリが返したリダイレクト（hooks を通らない 308）にも付く', async () => {
		const fetch = withNoindexFetch(async () => Response.redirect('https://example.com/kadai', 308));
		const res = await fetch(new Request('https://example.com/kadai/'), env('1'), ctx);
		expect(res.status).toBe(308);
		expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
	});

	test('NOINDEX がなければ、アプリの応答をそのまま返す', async () => {
		const original = new Response('x');
		const res = await withNoindexFetch(async () => original)(new Request('https://example.com/'), env(), ctx);
		expect(res).toBe(original);
	});
});
