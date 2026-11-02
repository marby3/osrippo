// Issue #4 基準2：tokens.css が全ページで効いている
import { expect, test } from '@playwright/test';

test('body・リンク・キーボードのフォーカスが Tokens どおり', async ({ page }) => {
	await page.goto('/');
	const body = page.locator('body');
	await expect(body).toHaveCSS('color', 'rgb(26, 26, 28)');
	await expect(body).toHaveCSS('background-color', 'rgb(255, 255, 255)');
	await expect(body).toHaveCSS('font-family', /Noto Sans JP/);
	await expect(body).toHaveCSS('line-height', '27.2px');

	// 部品はまだないので、リンクとボタンを差し込んで確かめる
	await page.evaluate(() => {
		document.body.insertAdjacentHTML('afterbegin', '<a href="#x">リンク</a><button>ボタン</button>');
	});
	await expect(page.getByRole('link', { name: 'リンク' })).toHaveCSS('color', 'rgb(26, 86, 199)');

	await page.keyboard.press('Tab');
	const link = page.getByRole('link', { name: 'リンク' });
	await expect(link).toBeFocused();
	await expect(link).toHaveCSS('outline', 'rgb(26, 26, 28) solid 4px');
	await expect(link).toHaveCSS('box-shadow', /rgb\(255, 212, 61\) 0px 0px 0px 2px/);
});
