// フェーズ2 課題・解決策の締めのテスト（Issue #14）。
// 通ったらフェーズ2完了として v0.2 を出す。それまでは test:phase でだけ回す。
import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * テスト用のログイン（手元とテストの環境だけで動く）。name ごとに別の利用者になる。
 * 本番の Google・LINE のログインは通らない。
 */
async function loginAs(browser: Browser, name: string): Promise<Page> {
	const page = await (await browser.newContext()).newPage();
	await page.goto(`/test-login?name=${encodeURIComponent(name)}`);
	return page;
}

async function report(page: Page, url: string) {
	await page.goto(url);
	await page.getByRole('button', { name: 'この課題を通報する' }).click();
	await page.getByRole('button', { name: '通報する', exact: true }).click();
	await expect(page.getByText('通報を受け付けました')).toBeVisible();
}

test('課題を投稿し、わかるを付け、3人の通報で非表示になるまで', async ({ browser, page }, info) => {
	const title = `締めのテスト ${info.project.name} ${Date.now()}`;

	// 1. ログインしていなくても一覧を見られる。書くにはログインが要る
	await page.goto('/kadai');
	await expect(page.getByRole('heading', { name: '課題' })).toBeVisible();
	await page.getByRole('link', { name: '課題を書く' }).click();
	await expect(page.getByRole('link', { name: 'Googleでログイン' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'LINEでログイン' })).toBeVisible();

	// 2. A が課題を書く
	const a = await loginAs(browser, `A-${info.project.name}`);
	await a.goto('/kadai/new');
	await a.getByLabel('何に困っていますか？').fill(title);
	await a.getByRole('button', { name: 'どれとも違うので、次へ' }).click();
	await a.getByLabel('困っている人').fill('ネット通販で定期購入を申し込んだ人');
	await a.getByRole('button', { name: '次へ' }).click();
	await a.getByLabel('具体的には').fill('1回だけのつもりで申し込んだら、解約の電話がつながらず毎月届き続けている。');
	await a.getByRole('button', { name: '投稿する' }).click();
	await expect(a.getByRole('heading', { level: 1, name: title })).toBeVisible();
	await expect(a.getByText('ネット通販で定期購入を申し込んだ人')).toBeVisible();
	await expect(a.getByText('解約の電話がつながらず毎月届き続けている')).toBeVisible();
	const issueUrl = a.url();
	expect(issueUrl).toMatch(/\/kadai\/[^/]+$/);

	// 3. B が「わかる」を付け、取り消す
	const b = await loginAs(browser, `B-${info.project.name}`);
	await b.goto(issueUrl);
	const wakaru = b.getByRole('button', { name: /わかる/ });
	await wakaru.click();
	await expect(wakaru).toHaveAttribute('aria-pressed', 'true');
	await expect(wakaru).toContainText('1');
	await wakaru.click();
	await expect(wakaru).toHaveAttribute('aria-pressed', 'false');
	await expect(wakaru).toContainText('0');

	// 5. 同じ人の2回目は数えない：B が2回、C が1回 → まだ出ている
	const c = await loginAs(browser, `C-${info.project.name}`);
	await report(b, issueUrl);
	await report(b, issueUrl);
	await report(c, issueUrl);
	await page.goto(issueUrl);
	await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
	await page.goto('/kadai');
	await expect(page.getByRole('link', { name: title })).toBeVisible();

	// 4. 3人目（D）の通報で非表示になる
	const d = await loginAs(browser, `D-${info.project.name}`);
	await report(d, issueUrl);
	await page.goto(issueUrl);
	await expect(page.getByText('この課題は通報により非表示になっています')).toBeVisible();
	await expect(page.getByRole('heading', { level: 1, name: title })).toHaveCount(0);
	await page.goto('/kadai');
	await expect(page.getByRole('link', { name: title })).toHaveCount(0);
});
