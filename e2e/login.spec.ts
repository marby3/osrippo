// Issue #23 ログイン
import { expect, test, type Page } from '@playwright/test';

/** 提供元までは行かない：認可の URL への移動を止めて、その URL を返す */
async function authorizeUrl(page: Page, button: string, host: string): Promise<URL> {
	let seen: URL | undefined;
	await page.route(`https://${host}/**`, (route) => {
		// 最初の要求（認可の URL）だけを見る。偽のページを返したあとの favicon.ico などで上書きしない
		seen ??= new URL(route.request().url());
		return route.fulfill({ status: 200, body: 'provider' });
	});
	await page.goto('/login');
	await page.getByRole('button', { name: button }).click();
	await expect.poll(() => seen?.host).toBe(host);
	return seen!;
}

test('基準1：Google・LINE の認可の URL へ、client_id と戻り先付きで送られる', async ({ page }) => {
	const google = await authorizeUrl(page, 'Googleでログイン', 'accounts.google.com');
	expect(google.searchParams.get('client_id')).toBe('test-google-client');
	expect(google.searchParams.get('redirect_uri')).toBe('http://localhost:4173/api/auth/callback/google');

	const line = await authorizeUrl(page, 'LINEでログイン', 'access.line.me');
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
	for (const next of ['//evil.example', '/\\evil.example', 'https://evil.example', '/\n/evil.example']) {
		await page.goto(`/login?next=${encodeURIComponent(next)}`);
		expect(new URL(page.url()).origin, next).toBe('http://localhost:4173');
		expect(new URL(page.url()).pathname, next).toBe('/');
	}
	await page.goto(`/login?next=${encodeURIComponent('/watashi')}`);
	await expect(page).toHaveURL('/watashi');
});
