// Issue #120：ホームと課題の一覧の見た目を案に合わせる（SpIssues・PcIssues・SpHome・PcHome）
import { expect, test, type Locator, type Page } from '@playwright/test';
import { newUser, ORIGIN, postIssue } from './helpers';

const sp = (name: string) => name === 'sp';
const menu = (page: Page) => page.getByRole('navigation', { name: 'メニュー', exact: true });

/** 見えない（読み上げにだけ残る）部品：大きさが 1px 以下 */
async function visuallyHidden(target: Locator) {
	await expect(target).toHaveCount(1);
	const box = (await target.boundingBox())!;
	expect(box.width * box.height).toBeLessThanOrEqual(1);
}

/** 探す欄の形（基準3・7）：薄い字、見えないボタン、キーボードの「検索」キー */
async function searchBox(page: Page, label: string) {
	const input = page.getByRole('searchbox', { name: label, exact: true });
	await expect(input).toBeVisible();
	await expect(input).toHaveAttribute('placeholder', '例：自転車');
	await expect(input).toHaveAttribute('enterkeyhint', 'search');
	await visuallyHidden(page.getByRole('button', { name: '探す', exact: true }));
	return input;
}

test('基準1：スマホは課題の一覧の本文の見出しを見えない見出しにし、PC は見せる', async ({ page }, info) => {
	await page.goto('/kadai');
	const h1 = page.getByRole('heading', { level: 1, name: '課題', exact: true });
	if (sp(info.project.name)) await visuallyHidden(h1);
	else await expect(h1).toBeVisible();
});

test('基準2：スマホの「＋課題を書く」は下のタブのすぐ上に横いっぱいで留まり、PC は見出しの右', async ({ page }, info) => {
	await page.goto('/kadai');
	const write = page.getByRole('link', { name: /課題を書く/ });
	await expect(write).toBeVisible();
	const box = (await write.boundingBox())!;
	const viewport = page.viewportSize()!;
	if (sp(info.project.name)) {
		const tabs = (await menu(page).boundingBox())!;
		// タブのすぐ上（白い帯の中）で、左右の余白 1rem を残して横いっぱい
		expect(box.y + box.height).toBeLessThanOrEqual(tabs.y);
		expect(tabs.y - (box.y + box.height)).toBeLessThanOrEqual(16);
		expect(Math.round(box.width)).toBe(viewport.width - 32);
		// 一番下まで送っても、最後の行が帯に隠れない
		await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
		const last = (await page.getByRole('contentinfo').boundingBox())!;
		expect(last.y + last.height).toBeLessThanOrEqual((await write.boundingBox())!.y);
	} else {
		const h1 = (await page.getByRole('heading', { level: 1, name: '課題', exact: true }).boundingBox())!;
		expect(box.x).toBeGreaterThan(h1.x + h1.width);
		expect(Math.abs(box.y + box.height / 2 - (h1.y + h1.height / 2))).toBeLessThanOrEqual(8);
	}
});

test('基準3：課題の一覧の探す欄は薄い字「例：自転車」で、見えるボタンはなく、Enter で探す', async ({ page }) => {
	await page.goto('/kadai');
	await page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
	const input = await searchBox(page, '課題を探す');
	await input.fill('自転車');
	await input.press('Enter');
	await expect(page).toHaveURL(/\/kadai\?q=%E8%87%AA%E8%BB%A2%E8%BB%8A$/);
});

test('基準4：スマホの並びは枠のない文字だけの選択欄', async ({ page }, info) => {
	test.skip(!sp(info.project.name), 'スマホの案（SpIssues）');
	await page.goto('/kadai');
	const select = page.getByRole('combobox', { name: /並び/ });
	await expect(select).toBeVisible();
	await expect(select).toHaveCSS('border-top-width', '0px');
	await expect(select).toHaveCSS('font-weight', '700');
	await expect(page.getByText('並び：', { exact: true })).toBeVisible();
});

test('基準5：PC は左の列に探す・表示する課題（丸い選択肢）・並び順、右の列に表。スクリプトなしでも絞り込める', async ({ browser }, info) => {
	test.skip(sp(info.project.name), 'PC の案（PcIssues）');
	// 表が出るように、課題を1件書いておく
	const writer = await newUser(browser, { name: `ichiran${Date.now() % 1e8}`, ip: '10.114.0.1', days: 8 });
	await postIssue(writer.page, { title: `一覧の見た目 ${Date.now() % 1e8}` });
	await writer.context.close();
	const context = await browser.newContext({ baseURL: ORIGIN, javaScriptEnabled: false, viewport: { width: 1280, height: 800 } });
	const page = await context.newPage();
	await page.goto('/kadai');
	const table = (await page.getByRole('main').getByRole('table').boundingBox())!;
	const filters = page.getByRole('navigation', { name: '表示する課題', exact: true });
	const left = [page.getByRole('searchbox', { name: '課題を探す' }), filters, page.getByRole('combobox', { name: '並び順' })];
	let lastBottom = 0;
	for (const part of left) {
		const box = (await part.boundingBox())!;
		expect(box.x + box.width).toBeLessThan(table.x);
		expect(box.y).toBeGreaterThanOrEqual(lastBottom);
		lastBottom = box.y + box.height;
	}
	await expect(page.getByText('表示する課題', { exact: true })).toBeVisible();
	await expect(page.getByText('並び順', { exact: true })).toBeVisible();
	// 選択肢は縦に並び、丸い印が付く。選んでいるものは印が塗られる
	const items = filters.getByRole('link');
	await expect(items).toHaveCount(4); // すべて・今回のお題・解決策あり・法案あり（Issue #125）
	const boxes = await Promise.all([0, 1, 2].map(async (i) => (await items.nth(i).boundingBox())!));
	expect(boxes[1].y).toBeGreaterThan(boxes[0].y);
	expect(boxes[2].y).toBeGreaterThan(boxes[1].y);
	const mark = (i: number) => items.nth(i).evaluate((el) => getComputedStyle(el, '::before').borderRadius);
	expect(await mark(0)).not.toBe('0px');
	await items.filter({ hasText: '解決策あり' }).click();
	await expect(page).toHaveURL(/\/kadai\?kaiketsu=ari$/);
	await expect(filters.getByRole('link', { name: '解決策あり' })).toHaveAttribute('aria-current', 'page');
	await context.close();
});

test('基準6：ホームの本文の「オープンソース立法府」は見えない見出し', async ({ page }) => {
	await page.goto('/');
	await visuallyHidden(page.getByRole('heading', { level: 1, name: 'オープンソース立法府', exact: true }));
});

test('基準7：ホームの探す欄は課題の一覧と同じ形', async ({ page }) => {
	await page.goto('/');
	await page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
	const input = await searchBox(page, '法令や課題を探す');
	await expect(input).toHaveCSS('border-top-left-radius', '8px');
	await input.fill('契約');
	await input.press('Enter');
	await expect(page).toHaveURL(/\/kensaku\?q=/);
});
