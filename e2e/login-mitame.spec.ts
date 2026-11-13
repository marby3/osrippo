// Issue #159 ログインの画面の並び、ロゴ、はじめての方への説明、確認の枠の幅。基準4（いまの動き）は e2e/login.spec.ts
import { expect, test, type Page } from '@playwright/test';
import { stubTurnstile } from './helpers';

const NEWCOMER = 'はじめての方は、招待コードを入れて、β版のお約束に同意してから、このボタンで登録してください。お使いのGoogleかLINEのアカウントで入るので、パスワードはいりません。';
const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
const google = (page: Page) => page.getByRole('button', { name: 'Googleでログイン', exact: true });
const line = (page: Page) => page.getByRole('button', { name: 'LINEでログイン', exact: true });
/** 確認の枠を置く場所（フォームの中の最後の div。ボタンのあと） */
const widget = (page: Page) => page.locator('main form > div').last();

async function open(page: Page) {
	await page.goto('/login');
	await hydrated(page);
	await expect(google(page)).toBeEnabled();
}

test('基準1：説明文 → はじめての方への説明 → Google → LINE → 確認の枠の順で、見た目と読み上げの順がそろう', async ({ page }) => {
	await stubTurnstile(page);
	await open(page);
	const main = page.getByRole('main');
	const parts = [main.getByText(/読むだけならログインはいりません/), main.getByText(NEWCOMER), google(page), line(page), widget(page)];

	// 読み上げの順（文書の順）
	const handles = await Promise.all(parts.map((p) => p.elementHandle()));
	const positions = await main.evaluate((root, elements) => {
		const all = [...root.querySelectorAll('*')];
		return elements.map((e) => all.indexOf(e as Element));
	}, handles);
	expect(positions.every((p) => p >= 0)).toBe(true);
	expect([...positions].sort((a, b) => a - b)).toEqual(positions);

	// 見た目の順（上から）
	const tops = await Promise.all(parts.map(async (p) => (await p.boundingBox())?.y ?? -1));
	expect(tops.every((y) => y >= 0)).toBe(true);
	expect([...tops].sort((a, b) => a - b)).toEqual(tops);
});

test('基準2：ボタンの文字の左に、そのサービスのロゴ。ロゴは読み上げず、ボタンの名前は変わらない', async ({ page }) => {
	await stubTurnstile(page);
	await open(page);
	for (const button of [google(page), line(page)]) {
		const logo = button.locator('img');
		await expect(logo).toHaveCount(1);
		await expect(logo).toHaveAttribute('aria-hidden', 'true');
		await expect(logo).toHaveAttribute('alt', '');
		// 画像が読めている
		expect(await logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
		// 文字の左
		const logoBox = await logo.boundingBox();
		const textBox = await button.locator('span').boundingBox();
		expect(logoBox && textBox && logoBox.x + logoBox.width <= textBox.x).toBe(true);
	}
	// どちらのロゴか（画像は小さいので data URI に埋め込まれる。公式の色で見分ける）
	await expect(google(page).locator('img')).toHaveAttribute('src', /4285F4/i);
	await expect(line(page).locator('img')).toHaveAttribute('src', /06C755/i);
});

test('基準3：ボタンの上に、はじめての方への説明が出る', async ({ page }) => {
	await stubTurnstile(page);
	await open(page);
	const text = page.getByText(NEWCOMER, { exact: true });
	await expect(text).toBeVisible();
	const textBox = await text.boundingBox();
	const buttonBox = await google(page).boundingBox();
	expect(textBox && buttonBox && textBox.y + textBox.height <= buttonBox.y).toBe(true);
});

test('基準5：確認の枠は flexible で描き、枠とボタンの左右の端がそろう', async ({ page }) => {
	// 描くときの指定を記録する差し替え（本物の flexible と同じく、枠は置いた場所の幅いっぱいに広がる）
	await page.route(/^https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js/, (route) =>
		route.fulfill({
			contentType: 'text/javascript',
			body: `window.turnstile = {
				render(el, opts) {
					window.__turnstileOptions = { size: opts.size };
					const frame = document.createElement('div');
					frame.style.width = '100%';
					frame.style.height = '65px';
					el.appendChild(frame);
					setTimeout(() => opts.callback && opts.callback('test-pass'));
					return 'stub';
				},
				reset() {},
				remove() {}
			};`
		})
	);
	await open(page);
	expect(await page.evaluate(() => (window as unknown as { __turnstileOptions?: { size?: string } }).__turnstileOptions)).toEqual({ size: 'flexible' });
	// 置き場所ではなく、描いた枠そのものを測る
	const frame = await widget(page).locator('div').first().boundingBox();
	for (const button of [google(page), line(page)]) {
		const box = await button.boundingBox();
		expect(frame && box).toBeTruthy();
		expect(Math.abs((frame?.x ?? 0) - (box?.x ?? 0))).toBeLessThanOrEqual(1);
		expect(Math.abs((frame?.x ?? 0) + (frame?.width ?? 0) - ((box?.x ?? 0) + (box?.width ?? 0)))).toBeLessThanOrEqual(1);
	}
});
