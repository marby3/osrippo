// Issue #162 基準3：読める法律の法令のページ（設計書 docs/spec/162.md 決めたこと4）。民法は db:reset でテストデータの一覧から入る
import { expect, test } from '@playwright/test';

test('基準3：読める法律のページに、題名、「読める法律（最新の版だけ）」、第1条の本文が出て、比較へのリンクは出ない', async ({ page }) => {
	await page.goto('/hourei/129AC0000000089');
	await expect(page.getByRole('heading', { level: 1, name: '民法' })).toBeVisible();
	await expect(page.getByText('読める法律（最新の版だけ）')).toBeVisible();
	const art1 = page.getByRole('article', { name: '第1条', exact: true });
	await expect(art1).toContainText('私権は、公共の福祉に適合しなければならない。');
	await expect(page.getByRole('link', { name: '改正で変わったところ' })).toHaveCount(0);
});
