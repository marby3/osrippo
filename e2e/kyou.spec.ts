// Issue #128：ホームの「今日の条文」（SpHome・PcHome）。選び方は src/lib/db/today.test.ts
import { expect, test, type Page } from '@playwright/test';
import { newUser } from './helpers';

const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
const card = (page: Page) => page.getByRole('region', { name: /^今日の条文/ });
const lawLink = (page: Page) => card(page).getByRole('link', { name: /第\d+条/ });
const AGE = /^(2017年4月より前から変更なし|\d{4}年\d{1,2}月に(改正|制定)(・\d+年変わっていない)?)$/;
const at = (day: number) => `2790-07-${String(day).padStart(2, '0')}T09:00:00+09:00`;

test('基準1：ログインしていなくても、ホームに「今日の条文 ・ 法令名 第N条」、本文、どれだけ変わっていないかを出す', async ({ page }) => {
	await page.goto('/');
	await hydrated(page);
	await expect(card(page)).toBeVisible();
	await expect(card(page).getByRole('heading')).toHaveText(/^今日の条文 ・ .+ 第\d+条(の\d+)?$/);
	await expect(card(page).locator('[data-today-text]')).not.toBeEmpty();
	await expect(card(page).locator('[data-today-age]')).toHaveText(AGE);
});

test('基準2：どれだけ変わっていないかは、法令のページのその条の下と同じ文', async ({ page }) => {
	await page.goto('/');
	await hydrated(page);
	const age = (await card(page).locator('[data-today-age]').innerText()).trim();
	const text = (await card(page).locator('[data-today-text]').innerText()).trim();
	await lawLink(page).click();
	const article = page.locator(':target');
	await expect(article).toContainText(text);
	await expect(article.locator('p.amended')).toHaveText(age);
});

test('基準3：その日のうちはだれが開いても同じ条で、日が変わると次の条になる', async ({ browser, page }, info) => {
	await page.context().setExtraHTTPHeaders({ 'x-test-now': at(10) });
	await page.goto('/');
	const first = await lawLink(page).getAttribute('href');
	const other = await newUser(browser, { name: `kyou${info.project.name}${Date.now() % 1e7}`, ip: `10.128.0.${info.project.name === 'sp' ? 1 : 2}` });
	await other.context.setExtraHTTPHeaders({ 'x-test-ip': `10.128.0.${info.project.name === 'sp' ? 1 : 2}`, 'x-test-now': at(10).replace('09:00', '23:30') });
	await other.page.goto('/');
	expect(await lawLink(other.page).getAttribute('href')).toBe(first);
	await page.context().setExtraHTTPHeaders({ 'x-test-now': at(11) });
	await page.goto('/');
	expect(await lawLink(page).getAttribute('href')).not.toBe(first);
	await other.context.close();
});

test('基準4：「法令名 第N条」は、法令のページのその条へのリンク', async ({ page }) => {
	await page.goto('/');
	const href = (await lawLink(page).getAttribute('href'))!;
	expect(href).toMatch(/^\/hourei\/\w+#jo-\d+(_\d+)*$/);
	const label = (await lawLink(page).innerText()).match(/第\d+条(の\d+)*/)![0];
	await lawLink(page).click();
	await expect(page).toHaveURL(new RegExp(`${href.replace(/[#]/g, '\\#')}$`));
	await expect(page.locator(':target').getByRole('heading', { level: 3 })).toContainText(label);
});

test('基準5：スマホは割り当てのカードと探す欄の下、PC は右の列の割り当てのカードの下。枠線で囲む', async ({ browser }, info) => {
	const w = info.project.name;
	const u = await newUser(browser, { name: `kyou5${w}${Date.now() % 1e7}`, ip: `10.128.1.${w === 'sp' ? 1 : 2}`, days: 8 });
	// 採決の前（割り当てのカードはくじの案内だけ）
	await u.context.setExtraHTTPHeaders({ 'x-test-ip': `10.128.1.${w === 'sp' ? 1 : 2}`, 'x-test-now': '2790-07-15T09:00:00+09:00' });
	await u.page.goto('/');
	await hydrated(u.page);
	const box = (await card(u.page).boundingBox())!;
	const assignment = (await u.page.getByRole('region', { name: /^あなたの割り当て法案/ }).boundingBox())!;
	const search = (await u.page.locator('main form[action="/kensaku"]').boundingBox())!;
	expect(box.y).toBeGreaterThanOrEqual(assignment.y + assignment.height);
	if (w === 'sp') {
		expect(box.y).toBeGreaterThanOrEqual(search.y + search.height);
	} else {
		// 割り当てのカードと同じ右の列
		expect(Math.abs(box.x - assignment.x)).toBeLessThan(2);
		expect(box.x).toBeGreaterThanOrEqual(search.x + search.width);
	}
	expect(await card(u.page).evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe('solid');
	await u.context.close();
});
