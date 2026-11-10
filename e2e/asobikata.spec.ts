// Issue #131：はじめての方へ：遊び方（3画面）と、ホームの入口
import { expect, test, type Page } from '@playwright/test';
import { ORIGIN } from './helpers';

const ENTRY = 'はじめての方へ：遊び方（3分）';
const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
const box = async (page: Page, l: ReturnType<Page['locator']>) => {
	await expect(l).toBeVisible();
	return (await l.boundingBox())!;
};

test('基準1：ホームに入口の行があり、スマホはいちばん上、PC は右の列のいちばん下。うすい灰色の地で押しやすい大きさ', async ({ page }, info) => {
	await page.goto('/');
	await hydrated(page);
	const entry = page.getByRole('link', { name: ENTRY });
	await expect(entry).toHaveAttribute('href', '/asobikata');
	const e = await box(page, entry);
	const session = await box(page, page.getByRole('region', { name: /^いまは/ }));
	if (info.project.name === 'sp') {
		expect(e.y + e.height).toBeLessThanOrEqual(session.y);
	} else {
		const today = await box(page, page.getByRole('region', { name: /^今日の条文/ }));
		expect(e.y).toBeGreaterThanOrEqual(today.y + today.height);
		expect(Math.abs(e.x - today.x)).toBeLessThan(2);
	}
	expect(e.height).toBeGreaterThanOrEqual(44);
	const surface = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-surface').trim());
	expect(surface).toBe('#f5f5f7');
	expect(await entry.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(245, 245, 247)');
});

test('基準2：3つの画面を「前へ」「次へ」で行き来でき、最後は「ホームへ」。スクリプトがなくても動く', async ({ browser }) => {
	for (const javaScriptEnabled of [true, false]) {
		const context = await browser.newContext({ javaScriptEnabled, baseURL: ORIGIN });
		const page = await context.newPage();
		await page.goto('/asobikata');
		for (const n of [1, 2, 3]) {
			await expect(page.getByText(`ステップ ${n} / 3`, { exact: true })).toBeVisible();
			await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
			// 進み具合の棒は3つで、いまの段までが済み
			await expect(page.getByRole('list', { name: '遊び方の段' }).getByRole('listitem')).toHaveCount(3);
			await expect(page.getByRole('list', { name: '遊び方の段' }).locator('[aria-current="step"]')).toHaveCount(1);
			if (n > 1) await expect(page.getByRole('link', { name: '前へ', exact: true })).toHaveAttribute('href', n === 2 ? '/asobikata' : '/asobikata/2');
			if (n < 3) await page.getByRole('link', { name: '次へ', exact: true }).click();
		}
		await expect(page).toHaveURL(/\/asobikata\/3$/);
		await expect(page.getByRole('link', { name: '次へ', exact: true })).toHaveCount(0);
		await page.getByRole('link', { name: 'ホームへ', exact: true }).click();
		await expect(page).toHaveURL(`${ORIGIN}/`);
		// 1つめの画面の URL は1つだけ。ない段は 404
		for (const path of ['/asobikata/1', '/asobikata/4', '/asobikata/x']) expect((await page.request.get(path)).status(), path).toBe(404);
		await context.close();
	}
});

test('基準3：「いちばん大事な流れ」を3つにまとめ、日付は法案の書き方のページと同じ値', async ({ page }) => {
	// 法案の書き方の流れから、発議の締切・質疑・採決の日を読む
	await page.goto('/houan/kakikata');
	const flow = await page.locator('#nagare').innerText();
	const [, until] = /毎月(\d+)日まで/.exec(flow)!;
	const [, deliberation] = /毎月(\d+)日から）。\s*$/m.exec(flow.split('\n').find((l) => l.includes('質疑'))!)!;
	const [, vote] = /毎月(\d+)日から月末/.exec(flow)!;

	await page.goto('/asobikata');
	await expect(page.getByRole('heading', { level: 1 })).toContainText('困りごとを出す');
	await expect(page.getByRole('link', { name: '課題を見る' })).toHaveAttribute('href', '/kadai');

	await page.goto('/asobikata/2');
	await expect(page.getByRole('heading', { level: 1 })).toContainText('法案にして話し合う');
	await expect(page.locator('main')).toContainText(`毎月${until}日まで`);
	await expect(page.locator('main')).toContainText(`${deliberation}日からは質疑`);
	await expect(page.getByRole('link', { name: '法案を見る' })).toHaveAttribute('href', '/houan');

	await page.goto('/asobikata/3');
	await expect(page.getByRole('heading', { level: 1 })).toContainText('投票して決める');
	await expect(page.locator('main')).toContainText(`${vote}日から採決`);
	await expect(page.locator('main')).toContainText('IF世界の法律になります');
	await expect(page.getByRole('link', { name: '採決を見る' })).toHaveAttribute('href', '/saiketsu');
});

test('基準4：画面に実装用語を出さない', async ({ page }) => {
	const words = ['diff', '差分', 'マージ', '反映', 'ブランチ', 'リベース', '衝突', 'アクティブ', '橋渡し', '評価スコア', '有効票', '参考票', '確認中', 'OGP', '内部ID'];
	for (const path of ['/asobikata', '/asobikata/2', '/asobikata/3']) {
		await page.goto(path);
		const text = await page.locator('main').innerText();
		for (const w of words) expect(text, `${path}: ${w}`).not.toContain(w);
	}
});

test('基準5：2つめの画面から法案の書き方へ、法案の書き方の冒頭から遊び方へ', async ({ page }) => {
	await page.goto('/asobikata/2');
	await page.getByRole('link', { name: '法案の書き方を見る' }).click();
	await expect(page).toHaveURL(/\/houan\/kakikata$/);
	const back = page.getByRole('link', { name: /はじめての方へ：遊び方/ });
	await expect(back).toHaveAttribute('href', '/asobikata');
	// 冒頭（最初の節より前）
	const b = await box(page, back);
	const first = await box(page, page.locator('#nagare'));
	expect(b.y).toBeLessThan(first.y);
});
