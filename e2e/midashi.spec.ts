// Issue #21 法令ページ：編・章・節の見出しと目次
import { expect, test, type Page } from '@playwright/test';

const TOKUSHO = '/hourei/351AC0000000057';
const article = (page: Page, name: string) => page.getByRole('article', { name, exact: true });

test('基準3：見出しが変わるところに、見出しをつないだ帯が出る', async ({ page }) => {
	await page.goto(TOKUSHO);
	const band = page.getByText('第二章　訪問販売、通信販売及び電話勧誘販売／第二節　訪問販売', { exact: true });
	await expect(band).toHaveCount(1);
	const b = (await band.boundingBox())!;
	const before = (await article(page, '第2条').boundingBox())!;
	const art3 = (await article(page, '第3条').boundingBox())!;
	expect(before.y).toBeLessThan(b.y);
	expect(b.y).toBeLessThan(art3.y);
	// 同じ節の続き（第3条の2）の上には帯を出さない：第二節の帯は1つだけ
	await expect(page.getByText(/第二節　訪問販売$/)).toHaveCount(1);
});

test('基準4：目次の見出しを押すと、その見出しの最初の条へ移る', async ({ page }, info) => {
	await page.goto(TOKUSHO);
	await page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
	const toc = page.getByRole('navigation', { name: '目次' });
	if (info.project.name === 'sp') {
		await expect(toc).toBeHidden();
		await page.getByRole('button', { name: '目次から探す' }).click();
	} else {
		// PC は左に目次
		await expect(toc).toBeVisible();
		expect((await toc.boundingBox())!.x).toBeLessThan((await article(page, '第1条').boundingBox())!.x);
	}
	await toc.getByRole('link', { name: '第三章　連鎖販売取引' }).click();
	await expect(article(page, '第33条')).toBeInViewport();

	// 子の見出しだけを持つ見出し（第二章）は、下の木を深さ優先でたどって最初の条（第2条）へ
	if (info.project.name === 'sp') await page.getByRole('button', { name: '目次から探す' }).click();
	await toc.getByRole('link', { name: '第二章　訪問販売、通信販売及び電話勧誘販売' }).click();
	await expect(page).toHaveURL(/#jo-2$/);
});
