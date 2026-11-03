// Issue #23 ログイン
import { expect, test, type Page } from '@playwright/test';

/**
 * 提供元までは行かない：ログインのフォームと同じ POST を、リダイレクトを追わずに送り、行き先を返す
 * （ブラウザで押すと 303 の先を追いかけて本物の提供元へ通信してしまい、page.route でも止められない）
 */
async function authorizeUrl(page: Page, button: string, action: string): Promise<URL> {
	await page.goto('/login');
	await expect(page.getByRole('button', { name: button })).toBeVisible();
	const res = await page.request.post(`/login?/${action}`, {
		form: { next: '/' },
		// ブラウザのフォームと同じく HTML を求める（そうでないと SvelteKit は JSON で返す）
		headers: { origin: new URL(page.url()).origin, accept: 'text/html' },
		maxRedirects: 0
	});
	expect(res.status()).toBe(303);
	// 提供元から戻ったときに確かめる state の Cookie が、ブラウザに届く
	const cookies = res.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie');
	expect(cookies.map((c) => c.value).join('\n')).toMatch(/better-auth\.state=/);
	return new URL(res.headers()['location']);
}

test('基準1：Google・LINE の認可の URL へ、client_id と戻り先付きで送られる', async ({ page }) => {
	const google = await authorizeUrl(page, 'Googleでログイン', 'google');
	expect(google.host).toBe('accounts.google.com');
	expect(google.searchParams.get('client_id')).toBe('test-google-client');
	expect(google.searchParams.get('redirect_uri')).toBe('http://localhost:4173/api/auth/callback/google');

	const line = await authorizeUrl(page, 'LINEでログイン', 'line');
	expect(line.host).toBe('access.line.me');
	expect(line.searchParams.get('client_id')).toBe('test-line-client');
	expect(line.searchParams.get('redirect_uri')).toBe('http://localhost:4173/api/auth/callback/line');
});

test('基準2：テスト用のログインで入ると表示名が出て、ログアウトするとログインに送られる', async ({ page }, info) => {
	const name = `watashi-${info.project.name}`;
	await page.goto(`/test-login?name=${name}`);
	await expect(page.getByText(`テスト用のログイン：${name}`)).toBeVisible();
	await page.goto('/watashi');
	await expect(page.getByText(name, { exact: true })).toBeVisible();

	// GET ではログアウトしない
	await page.request.get('/logout');
	await page.goto('/watashi');
	await expect(page.getByText(name, { exact: true })).toBeVisible();

	await page.getByRole('button', { name: 'ログアウト' }).click();
	await page.waitForURL('/');
	await page.goto('/watashi');
	await expect(page).toHaveURL('/login?next=%2Fwatashi');
});

test('基準3：TEST_LOGIN のないサーバーでは 404、name が不正なら 400', async ({ browser, request }) => {
	// TEST_LOGIN を渡していない2つ目のサーバー（Cookie のない新しいコンテキスト）
	const context = await browser.newContext({ baseURL: 'http://localhost:4174' });
	expect((await context.request.get('/test-login?name=a')).status()).toBe(404);
	await context.close();

	for (const name of ['', 'a b', 'a@b', '../x', 'x'.repeat(33)]) {
		expect((await request.get(`/test-login?name=${encodeURIComponent(name)}`)).status(), name).toBe(400);
	}
});

test('基準4：ログインしたあとの戻り先に外のサイトを渡しても、外へは送らない', async ({ page }, info) => {
	await page.goto(`/test-login?name=next-${info.project.name}`);
	for (const next of ['//evil.example', '/\\evil.example', 'https://evil.example', '/\n/evil.example', '/.//evil.example']) {
		await page.goto(`/login?next=${encodeURIComponent(next)}`);
		expect(new URL(page.url()).origin, next).toBe('http://localhost:4173');
		expect(new URL(page.url()).pathname, next).toBe('/');
	}
	await page.goto(`/login?next=${encodeURIComponent('/watashi')}`);
	await expect(page).toHaveURL('/watashi');
});

test('Better Auth の経路は、提供元から戻るところ以外は外から呼べない（表示名を勝手に変えられない）', async ({ page }, info) => {
	const name = `guard-${info.project.name}`;
	await page.goto(`/test-login?name=${name}`);
	const origin = new URL(page.url()).origin;
	const post = (path: string, data: object) =>
		page.request.post(path, { data, headers: { origin }, maxRedirects: 0 });

	expect((await post('/api/auth/update-user', { name: '運営', image: 'https://evil.example/a.png' })).status()).toBe(404);
	expect((await post('/api/auth/sign-in/social', { provider: 'google', callbackURL: 'https://evil.example' })).status()).toBe(404);
	await page.goto('/watashi');
	await expect(page.getByText(name, { exact: true })).toBeVisible();
});
