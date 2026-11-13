// Issue #12 2時点の比較ページ → Issue #191 改正法を1つ選んで、その改正で変わったところを見る
import { expect, test, type Page } from '@playwright/test';

const PAGE = '/hourei/412AC0000000061/hikaku';
const rev = (s: string) => `412AC0000000061_${s}`;
const R20161001 = rev('20161001_425AC0000000096');
const R20230601 = rev('20230601_504AC0000000059');
const R20260624 = rev('20260624_508AC0000000046');
const TITLE_20230601 =
	'消費者契約法及び消費者の財産的被害の集団的な回復のための民事の裁判手続の特例に関する法律の一部を改正する法律';

async function show(page: Page, kaisei: string) {
	await page.goto(PAGE);
	await page.getByLabel('改正法').selectOption(kaisei);
	await page.getByRole('button', { name: '見る' }).click();
}

const article = (page: Page, name: string) => page.getByRole('article', { name, exact: true });

test('#191 基準1：選ぶ欄は「改正法」の1つだけ。選んで「見る」を押すと、直前の版と比べた変更点が出る', async ({ page }) => {
	await page.goto(PAGE);
	const kaisei = page.getByLabel('改正法');
	// 初めはいま効力のある版の改正法
	await expect(kaisei).toHaveValue(R20260624);
	// 19の版のうち、前の版がない一番古い版は入れない。新しい順
	await expect(kaisei.getByRole('option')).toHaveCount(18);
	await expect(kaisei.locator(`option[value="${R20161001}"]`)).toHaveCount(0);
	await expect(kaisei.getByRole('option').first()).toHaveText(/2028年12月23日施行（施行予定）/);
	await expect(page.getByLabel('前の版')).toHaveCount(0);
	await expect(page.getByLabel('後の版')).toHaveCount(0);

	await kaisei.selectOption(R20230601);
	await page.getByRole('button', { name: '見る' }).click();
	await expect(page).toHaveURL(new RegExp(`kaisei=${R20230601}`));
	await expect(kaisei).toHaveValue(R20230601);
	// 直前の 2023-01-05 の版と比べている
	await expect(page.getByRole('article')).toHaveCount(12);
	await expect(article(page, '第12条の3')).toContainText('新しく入った条');
});

test('#191 基準2：結果の上に、比べた2つと改正法の名前を省かずに出す', async ({ page }) => {
	await show(page, R20230601);
	const pair = page.getByText('改正前：2023年1月5日施行の版 → 改正後：2023年6月1日施行の版', { exact: true });
	const name = page.getByText(TITLE_20230601, { exact: true });
	await expect(pair).toBeVisible();
	await expect(name).toBeVisible();
	// 途中で切れていない
	expect(await name.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
	// 結果（変わった条）より上
	const first = (await page.getByRole('article').first().boundingBox())!;
	expect((await pair.boundingBox())!.y).toBeLessThan(first.y);
});

test('#191 基準3：PC の表は左が改正前、右が改正後。スマホは改正前が上', async ({ page }, info) => {
	await show(page, R20230601);
	const art4 = article(page, '第4条');
	const before = (await art4.getByRole('region', { name: '改正前' }).boundingBox())!;
	const after = (await art4.getByRole('region', { name: '改正後' }).boundingBox())!;
	if (info.project.name === 'sp') {
		expect(before.y + before.height).toBeLessThanOrEqual(after.y);
	} else {
		expect(before.x + before.width).toBeLessThanOrEqual(after.x);
		expect(Math.abs(after.y - before.y)).toBeLessThan(2);
	}
});

test('変わった条だけが並ぶ（新しく入った条、なくなった条を含む）', async ({ page }) => {
	await show(page, R20230601);
	await expect(page.getByRole('article')).toHaveCount(12);
	for (const name of ['第3条', '第4条', '第12条の2', '第13条']) await expect(article(page, name)).toBeVisible();
	await expect(article(page, '第1条')).toHaveCount(0);
	await expect(article(page, '第12条の3').locator('ins')).toContainText('＋');

	await page.goto('/hourei/351AC0000000057/hikaku?kaisei=351AC0000000057_20171201_428AC0000000060');
	await expect(article(page, '第70条の3')).toContainText('なくなった条');
	await expect(article(page, '第70条の3').locator('del')).toContainText('−');
});

test('削除は取り消し線と「−」、追加は下線と「＋」', async ({ page }) => {
	await show(page, R20230601);
	const art4 = article(page, '第4条');
	const removed = art4.locator('del').first();
	const added = art4.locator('ins').first();
	await expect(removed).toHaveCSS('text-decoration-line', /line-through/);
	await expect(removed).toContainText('−');
	await expect(added).toHaveCSS('text-decoration-line', /underline/);
	await expect(added).toContainText('＋');
});

test('その法令にない版や一番古い版を指定すると 404。古い ?mae=&ato= は初めて開いたときと同じ', async ({ page }) => {
	for (const kaisei of ['nai', '351AC0000000057_20171201_428AC0000000060', "'%20OR%201=1--", R20161001]) {
		const res = await page.goto(`${PAGE}?kaisei=${kaisei}`);
		expect(res?.status(), kaisei).toBe(404);
	}
	expect((await page.goto('/hourei/000AC0000000000/hikaku'))?.status()).toBe(404);
	await page.goto(`${PAGE}?mae=${rev('20230105_504AC0000000099')}&ato=${R20230601}`);
	await expect(page.getByLabel('改正法')).toHaveValue(R20260624);
});

test('法令ページから「改正で変わったところ」へ行ける', async ({ page }) => {
	await page.goto('/hourei/412AC0000000061');
	await page.getByRole('link', { name: '改正で変わったところ' }).click();
	await expect(page).toHaveURL(/\/hourei\/412AC0000000061\/hikaku/);
	await expect(page.getByRole('heading', { level: 1, name: '改正で変わったところ' })).toBeVisible();
});

test('ページのスクリプトが動き出す前に選んだ改正法が、消えずに見られる（Issue #17）', async ({ page }) => {
	// スクリプトの読み込みを止めておき、選んだあとで動き出させる（遅い回線のスマホと同じ）
	let release!: () => void;
	const held = new Promise<void>((resolve) => (release = resolve));
	await page.route('**/_app/immutable/**/*.js', async (route) => {
		await held;
		await route.continue();
	});
	await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
	await page.getByLabel('改正法').selectOption(R20230601);
	release();
	// ハイドレーションが済むまで待つ（レイアウトが body に data-hydrated を付ける）
	await page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
	await expect(page.getByLabel('改正法')).toHaveValue(R20230601);
	await page.getByRole('button', { name: '見る' }).click();
	await expect(article(page, '第4条')).toBeVisible();
});
