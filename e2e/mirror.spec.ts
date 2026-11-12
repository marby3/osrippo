// Issue #155 基準1：公開ミラーの書き出しの入口。会期の選び方と中身は src/lib/db/mirror.test.ts
import { expect, test } from '@playwright/test';
import { newUser } from './helpers';

// 画面のテストのサーバーの MIRROR_TOKEN（scripts/preview-test.ts）
const TOKEN = 'test-mirror-token';
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

test('基準1：トークンがない・違えば 401 で中身を返さない。ログインしたセッションでは通らない。正しいトークンなら JSON', async ({ browser, request }, info) => {
	for (const path of ['/mirror', '/mirror/2035-04']) {
		for (const headers of [{}, bearer('wrong-token'), bearer(''), { authorization: `Basic ${TOKEN}` }, { authorization: TOKEN }]) {
			const res = await request.get(path, { headers });
			expect(res.status(), `${path} ${JSON.stringify(headers)}`).toBe(401);
			expect(await res.text()).not.toMatch(/sessions|laws|articles/);
		}
	}

	const { context, page } = await newUser(browser, { name: `ミラー ${info.project.name} ${Date.now()}`, ip: `10.155.${info.project.name === 'sp' ? 1 : 2}.1` });
	try {
		for (const path of ['/mirror', '/mirror/2035-04']) expect((await page.request.get(path)).status(), path).toBe(401);
	} finally {
		await context.close();
	}

	const res = await request.get('/mirror', { headers: bearer(TOKEN) });
	expect(res.status()).toBe(200);
	expect(res.headers()['content-type']).toContain('application/json');
	expect(res.headers()['cache-control']).toContain('no-store');
	const body = (await res.json()) as { sessions: unknown };
	expect(Array.isArray(body.sessions)).toBe(true);
	for (const key of body.sessions as string[]) expect(key).toMatch(/^\d{4}-\d{2}$/);
});

test('不正な入力：会期の形が違えば 404、after の形が違えば 400', async ({ request }) => {
	for (const key of ['2035-13', '2035-4', 'abc', '..%2F..%2Fetc', '2035-04-01']) expect((await request.get(`/mirror/${key}`, { headers: bearer(TOKEN) })).status(), key).toBe(404);
	for (const value of ['x', '2035-13', "2035-04' OR 1=1"]) expect((await request.get(`/mirror?after=${encodeURIComponent(value)}`, { headers: bearer(TOKEN) })).status(), value).toBe(400);
});
