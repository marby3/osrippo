// フェーズ2 課題・解決策の締めのテスト（Issue #14）。
// 通ったらフェーズ2完了として v0.2 を出す。それまでは test:phase でだけ回す。
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { stubTurnstile } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});

/**
 * テスト用のログイン（テストの環境で明示的に有効にしたときだけ動く）。name ごとに別の利用者になる。
 * 本番の Google・LINE のログインは通らない。
 */
async function loginAs(browser: Browser, name: string): Promise<Page> {
	const context = await browser.newContext();
	contexts.push(context);
	const page = await context.newPage();
	// Turnstile は外部の api.js を読まず、通るトークンを入れる（Issue #25 設計書 決めたこと8）
	await stubTurnstile(page);
	await page.goto(`/test-login?name=${encodeURIComponent(name)}`);
	await expect(page.getByText(`テスト用のログイン：${name}`)).toBeVisible();
	return page;
}

async function report(page: Page, url: string) {
	await page.goto(url);
	await page.getByRole('button', { name: 'この課題を通報する' }).click();
	await page.getByRole('button', { name: '通報する', exact: true }).click();
	await expect(page.getByText('通報を受け付けました')).toBeVisible();
}

const either = (page: Page, name: string) =>
	page.getByRole('link', { name }).or(page.getByRole('button', { name }));

test('課題を投稿し、わかるを付け、3人の通報で非表示になるまで', async ({ browser, page }, info) => {
	const title = `締めのテスト ${info.project.name} ${Date.now()}`;

	// 1. ログインしていなくても一覧を見られる。書くにはログインが要る
	await page.goto('/kadai');
	await expect(page.getByRole('heading', { level: 1, name: '課題', exact: true })).toBeVisible();
	await page.getByRole('link', { name: '課題を書く' }).click();
	await expect(either(page, 'Googleでログイン')).toBeVisible();
	await expect(either(page, 'LINEでログイン')).toBeVisible();

	// 2. A が課題を書く
	const a = await loginAs(browser, `A-${info.project.name}`);
	// 段は「タイトル → くわしく（お題を選ぶ）→ 確認」（Issue #25 で決めた形）。
	// 似た課題が出るようになると、最初の段のボタンは「どれとも違うので、次へ」になる
	await a.goto('/kadai/kaku');
	await a.getByLabel('何に困っていますか？').fill(title);
	await a.getByRole('button', { name: /^(どれとも違うので、)?次へ$/ }).click();
	await a.getByLabel('困っている人').fill('ネット通販で定期購入を申し込んだ人');
	await a.getByLabel('具体的には').fill('1回だけのつもりで申し込んだら、解約の電話がつながらず毎月届き続けている。');
	await a.getByRole('radio', { name: '関係ある（消費者保護）' }).check();
	await a.getByRole('button', { name: '次へ', exact: true }).click();
	// Turnstile のトークンが入るまで「投稿する」は押せない
	await a.getByRole('button', { name: '投稿する' }).click();
	await expect(a.getByRole('heading', { level: 1, name: title })).toBeVisible();
	await expect(a.getByText('ネット通販で定期購入を申し込んだ人')).toBeVisible();
	await expect(a.getByText('解約の電話がつながらず毎月届き続けている')).toBeVisible();
	const issueUrl = a.url();
	expect(issueUrl).toMatch(/\/kadai\/\d+$/);

	// 3. B が「わかる」を付け、取り消す
	const b = await loginAs(browser, `B-${info.project.name}`);
	await b.goto(issueUrl);
	const wakaru = b.getByRole('button', { name: /^わかる/ }).first();
	await wakaru.click();
	await expect(wakaru).toHaveText(/わかる\s*1$/);
	await wakaru.click();
	await expect(wakaru).toHaveText(/わかる\s*0$/);

	// 5.（4 の前に確かめる）同じ人の2回目は数えない。B は通報済みになり、B と C の2人ではまだ出ている
	// 直接送った2回目の数え方（サーバー側の重複除去）は、通報の Issue のテストで確かめる
	await report(b, issueUrl);
	await b.goto(issueUrl);
	await expect(b.getByText('この課題は通報済みです')).toBeVisible();
	await expect(b.getByRole('button', { name: 'この課題を通報する' })).toHaveCount(0);
	const c = await loginAs(browser, `C-${info.project.name}`);
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
