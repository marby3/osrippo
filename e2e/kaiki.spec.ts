// Issue #44 会期の進み方（4週）と、ホームの今の会期、サーバーの「いま」
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { ORIGIN, loginAs, postIssueRequest, stubTurnstile } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});

async function open(browser: Browser, headers: Record<string, string>, origin = ORIGIN): Promise<Page> {
	const context = await browser.newContext({ baseURL: origin, extraHTTPHeaders: headers });
	contexts.push(context);
	const page = await context.newPage();
	await stubTurnstile(page);
	return page;
}

const at = (s: string) => `${s}+09:00`;
/** 本当の時刻での会期の名前（日本時間の月） */
const realMonth = () => `${Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Tokyo', month: 'numeric' }).format(new Date()))}月の会期`;
const progress = (page: Page) => page.getByRole('list', { name: '会期の進み具合' });

test('基準2：ホームに今の会期を出す（スマホは4本の棒と次の段の始まり、PCは 2:1:1 の区切りと週）', async ({ browser }, info) => {
	const sp = info.project.name === 'sp';
	const page = await open(browser, { 'x-test-ip': `10.40.${sp ? 1 : 2}.1`, 'x-test-now': at('2030-05-16T10:00:00') });
	await page.goto('/');
	await expect(page.getByText('5月の会期', { exact: true })).toBeVisible();
	await expect(page.getByRole('heading', { name: sp ? 'いまは 質疑と修正' : 'いまは 質疑と修正（3週目）', exact: true })).toBeVisible();

	const items = progress(page).getByRole('listitem');
	if (sp) {
		await expect(items).toHaveCount(4);
		await expect(progress(page).locator('li[data-filled]')).toHaveCount(3);
		await expect(page.getByText('採決は 5月22日（水） から', { exact: true })).toBeVisible();
		// 段ごとの次の始まり
		for (const [now, line, filled] of [
			['2030-05-03T10:00:00', '質疑は 5月15日（水） から', 1],
			['2030-05-09T10:00:00', '質疑は 5月15日（水） から', 2],
			['2030-05-25T10:00:00', '次の会期は 6月1日（土） から', 4]
		] as const) {
			await page.context().setExtraHTTPHeaders({ 'x-test-ip': '10.40.1.1', 'x-test-now': at(now) });
			await page.goto('/');
			await expect(page.getByText(line, { exact: true })).toBeVisible();
			await expect(progress(page).locator('li[data-filled]')).toHaveCount(filled);
		}
	} else {
		await expect(items).toHaveText(['1〜2週 発議', '3週 質疑・修正', '4週 採決（5月22日から）']);
		await expect(items.nth(1)).toHaveCSS('font-weight', '700');
		await expect(items.nth(0)).not.toHaveCSS('font-weight', '700');
		await expect(progress(page).locator('li[data-filled]')).toHaveCount(2);
		// 区切りの幅は 2:1:1
		const [a, b, c] = await Promise.all([0, 1, 2].map(async (i) => (await items.nth(i).boundingBox())!.width));
		expect(Math.abs(a - 2 * b)).toBeLessThan(12);
		expect(Math.abs(b - c)).toBeLessThan(6);
	}
});

test('基準4：テストのサーバーでは x-test-now が書き込みの時刻とレート制限に効き、フラグのないサーバーでは効かない', async ({ browser }, info) => {
	const p = info.project.name;
	const ip = `10.41.${p === 'sp' ? 1 : 2}.1`;
	const page = await open(browser, { 'x-test-ip': ip, 'x-test-now': at('2031-03-10T09:00:00') });
	await loginAs(page, `kaiki-${p}-${Date.now() % 1e8}`, 2);
	const post = async (now: string, n: number) => {
		await page.context().setExtraHTTPHeaders({ 'x-test-ip': ip, 'x-test-now': at(now) });
		return (await postIssueRequest(page, { title: `会期のテスト ${p} ${n} ${Date.now() % 1e8}` })).status();
	};
	// 課題の投稿は1アカウント24時間に5件（docs/spec/25.md）
	for (let n = 1; n <= 5; n++) expect(await post('2031-03-10T09:00:00', n)).toBe(303);
	expect(await post('2031-03-10T10:00:00', 6)).toBe(429);
	expect(await post('2031-03-11T10:00:00', 7)).toBe(303);

	// フラグのないサーバー（4174番）では、ヘッダーがあっても本当の時刻
	const other = await open(browser, { 'x-test-now': at('2031-03-10T09:00:00') }, 'http://localhost:4174');
	await other.goto('/');
	await expect(other.getByText(realMonth(), { exact: true })).toBeVisible();
});

test('信頼の境界：形の違う x-test-now は使わず、本当の時刻にする', async ({ browser }) => {
	for (const value of ['2031-03-10', '2031-03-10T09:00:00', 'abc', '2031-13-40T00:00:00+09:00', '2031-02-30T00:00:00+09:00', '2031-03-10T24:00:00+09:00', '1e15']) {
		const page = await open(browser, { 'x-test-now': value });
		await page.goto('/');
		await expect(page.getByText(realMonth(), { exact: true }), value).toBeVisible();
	}
});
