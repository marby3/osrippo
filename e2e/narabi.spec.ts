// Issue #126：立場を超えた支持順（課題の橋渡しスコア）。計算と10人の基準は src/lib/db/bridge.test.ts
import { expect, test, type Page } from '@playwright/test';

const select = (page: Page) => page.getByRole('combobox', { name: /並び/ });
const NOTE = '人数が足りないので、いまは「わかる」の多い順に並べています';

test('基準1：並びに「立場を超えた支持順」があり、選び直しても探す言葉と絞り込みは残る', async ({ page }) => {
	await page.goto('/kadai?houan=ari&q=%E8%87%AA%E8%BB%A2%E8%BB%8A');
	await page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
	await expect(select(page).locator('option').first()).toHaveText('立場を超えた支持順');
	await select(page).selectOption({ label: '「わかる」の多い順' });
	await expect(page).toHaveURL(/sort=support/);
	await expect(page).toHaveURL(/houan=ari/);
	await expect(page).toHaveURL(/q=%E8%87%AA%E8%BB%A2%E8%BB%8A/);
	await select(page).selectOption({ label: '立場を超えた支持順' });
	await expect(page).not.toHaveURL(/sort=/);
	await expect(page).toHaveURL(/houan=ari/);
});

test('基準3：人数が足りないときは注記を出す（画面のテストの DB は直近の会期に数えた票が足りない）。ほかの並びでは出さない', async ({ page }) => {
	await page.goto('/kadai');
	await expect(page.getByText(NOTE, { exact: true })).toBeVisible();
	await page.goto('/kadai?sort=support');
	await expect(page.getByText(NOTE, { exact: true })).toHaveCount(0);
});

test('基準4：並びを選んでいないときは「立場を超えた支持順」', async ({ page }) => {
	await page.goto('/kadai');
	await expect(select(page)).toHaveValue('bridge');
	await expect(select(page).locator('option:checked')).toHaveText('立場を超えた支持順');
});
