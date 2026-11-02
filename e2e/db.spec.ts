// Issue #8 基準1：pnpm db:reset でローカル D1 を作り直せる（webServer を起動するときに pnpm db:reset が走る。既存のサーバーを使う場合は走らない）
// D1 を別のプロセスから開くと、サーバーとロックがぶつかる（Issue #17）。サーバーを通して確かめる
import { expect, test } from '@playwright/test';

test('基準1：pnpm db:reset のあと、ローカル D1 に3法が入っている', async ({ page }) => {
	for (const [id, title] of [
		['412AC0000000061', '消費者契約法'],
		['351AC0000000057', '特定商取引に関する法律'],
		['337AC0000000134', '不当景品類及び不当表示防止法']
	]) {
		const res = await page.goto(`/hourei/${id}`);
		expect(res?.status(), id).toBe(200);
		await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
	}
});
