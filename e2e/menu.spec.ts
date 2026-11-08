// Issue #85：全体のメニュー（PcHeader・SpNav）とパンくず
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { newUser, ORIGIN, postIssue } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});

const SITE = 'オープンソース立法府';
const LAW = '412AC0000000061';
const TABS = [
	['ホーム', '/'],
	['課題', '/kadai'],
	['法案', '/houan'],
	['採決', '/saiketsu'],
	['法律', '/hourei']
] as const;
/** 幅ごと・テストごとに別の年（ほかのテストと会期が重ならないように） */
const at = (w: string, n: number, day: number) => `${2480 + n * 2 + (w === 'sp' ? 0 : 1)}-05-${String(day).padStart(2, '0')}T09:00:00+09:00`;

const menu = (page: Page) => page.getByRole('navigation', { name: 'メニュー', exact: true });
const crumbs = (page: Page) => page.getByRole('navigation', { name: 'いまいる場所', exact: true });
const bell = (page: Page) => page.getByRole('banner').getByRole('link', { name: /^通知（未読 \d+件）$/ });

async function person(browser: Parameters<typeof newUser>[0], w: string, n: number, now: string): Promise<Page> {
	const ip = `10.${w === 'sp' ? 110 : 111}.${n}.1`;
	const u = await newUser(browser, { name: `menu${n}${w}${Date.now() % 1e8}`, ip, days: 8 });
	contexts.push(u.context);
	await u.context.setExtraHTTPHeaders({ 'x-test-ip': ip, 'x-test-now': now });
	return u.page;
}

test('基準1：PC はどのページにも上のメニュー（ロゴ・5つのタブ・ベル・わたしの記録）を出す', async ({ browser }, info) => {
	test.skip(info.project.name !== 'pc', 'PC の案（PcHeader）');
	const page = await person(browser, 'pc', 1, at('pc', 1, 10));
	for (const path of ['/', '/kadai', '/houan', '/saiketsu', '/hourei', `/hourei/${LAW}`, '/kensaku', '/watashi']) {
		await page.goto(path);
		const banner = page.getByRole('banner');
		await expect(banner.getByRole('link', { name: SITE, exact: true }), path).toHaveAttribute('href', '/');
		await expect(menu(page).getByRole('link')).toHaveCount(TABS.length);
		for (const [name, href] of TABS) await expect(menu(page).getByRole('link', { name, exact: true }), path).toHaveAttribute('href', href);
		// 「データ」は統計のページの Issue で足す（決めたこと B）
		await expect(page.getByRole('link', { name: 'データ', exact: true })).toHaveCount(0);
		await expect(bell(page)).toHaveAttribute('href', '/tsuchi');
		await expect(banner.getByRole('link', { name: 'わたしの記録', exact: true })).toHaveAttribute('href', '/watashi');
		await expect(banner.getByRole('link', { name: 'わたしの記録', exact: true })).toHaveText('わたしの記録');
	}
	// 「法律」のタブは対象の3法の一覧へ（決めたこと A）
	await menu(page).getByRole('link', { name: '法律', exact: true }).click();
	await expect(page).toHaveURL(/\/hourei$/);
	const laws = page.getByRole('main').getByRole('link');
	await expect(laws).toHaveCount(3);
	for (const id of ['337AC0000000134', '351AC0000000057', LAW]) await expect(page.getByRole('main').locator(`a[href="/hourei/${id}"]`)).toHaveCount(1);
});

test('基準2：スマホは上の帯（ロゴ・見出し・ベル・人のアイコン）と、下に固定した5つのタブを出す', async ({ browser }, info) => {
	test.skip(info.project.name !== 'sp', 'スマホの案（SpNav）');
	const page = await person(browser, 'sp', 2, at('sp', 2, 10));
	const title = page.locator('[data-menu-title]');
	for (const [path, text] of [
		['/', SITE],
		['/kadai', '課題'],
		['/houan/kakikata', '法案'],
		['/saiketsu', '採決'],
		[`/hourei/${LAW}`, '法律'],
		['/kensaku', SITE]
	] as const) {
		await page.goto(path);
		await expect(title, path).toHaveText(text);
		await expect(title, path).toBeVisible();
	}
	const banner = page.getByRole('banner');
	await expect(banner.getByRole('link', { name: SITE, exact: true })).toHaveAttribute('href', '/');
	await expect(bell(page)).toBeVisible();
	const mine = banner.getByRole('link', { name: 'わたしの記録', exact: true });
	await expect(mine).toBeVisible();
	await expect(mine).toHaveAttribute('href', '/watashi');

	// 下のタブ：5つ、アイコン付き、画面の下に固定
	await expect(menu(page).getByRole('link')).toHaveCount(TABS.length);
	for (const [name, href] of TABS) {
		const tab = menu(page).getByRole('link', { name, exact: true });
		await expect(tab).toHaveAttribute('href', href);
		await expect(tab.locator('svg')).toHaveCount(1);
	}
	const viewport = page.viewportSize()!;
	const box = (await menu(page).boundingBox())!;
	expect(Math.round(box.y + box.height)).toBe(viewport.height);
	// 一番下まで送っても、最後の行（フッター）がタブに隠れない
	await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
	const footer = (await page.getByRole('contentinfo').boundingBox())!;
	expect(footer.y + footer.height).toBeLessThanOrEqual((await menu(page).boundingBox())!.y + 1);
	await menu(page).getByRole('link', { name: '法律', exact: true }).click();
	await expect(page).toHaveURL(/\/hourei$/);
});

test('基準3：開いているページのタブを太字と線で示し、aria-current を付ける', async ({ browser }, info) => {
	const page = await person(browser, info.project.name, 3, at(info.project.name, 3, 10));
	for (const [path, tab] of [
		['/', 'ホーム'],
		['/kadai', '課題'],
		['/kadai/kaku', '課題'],
		['/houan', '法案'],
		['/houan/kakikata', '法案'],
		['/saiketsu', '採決'],
		['/hourei', '法律'],
		[`/hourei/${LAW}`, '法律'],
		[`/if/hourei/${LAW}`, '法律'],
		['/kensaku', null],
		['/watashi', null],
		['/tsuchi', null]
	] as const) {
		await page.goto(path);
		const current = menu(page).locator('[aria-current="page"]');
		if (tab === null) {
			await expect(current, path).toHaveCount(0);
			continue;
		}
		await expect(current, path).toHaveCount(1);
		await expect(current, path).toHaveAccessibleName(tab);
		await expect(current, path).toHaveCSS('font-weight', '700');
		// 線：PC は下、スマホは上（PcHeader・SpNav）
		const side = info.project.name === 'pc' ? 'border-bottom-width' : 'border-top-width';
		expect(await current.evaluate((el, s) => getComputedStyle(el).getPropertyValue(s), side), path).not.toBe('0px');
		const other = menu(page).getByRole('link', { name: tab === 'ホーム' ? '課題' : 'ホーム', exact: true });
		await expect(other).not.toHaveCSS('font-weight', '700');
	}
});

test('基準4：ベルはログインしているときだけ出し、読み上げは「通知（未読 n件）」、未読があれば件数を出す', async ({ browser }, info) => {
	const w = info.project.name;
	// 採決の週より前：未読 0
	const page = await person(browser, w, 4, at(w, 4, 10));
	await page.goto('/kadai');
	await expect(bell(page)).toHaveAccessibleName('通知（未読 0件）');
	await expect(bell(page)).toBeVisible();
	await expect(bell(page)).toHaveText('');
	await expect(bell(page)).toHaveAttribute('data-sveltekit-preload-data', 'off');
	// 採決の週：委員長選挙の始まりが届く（未読 1）
	await page.context().setExtraHTTPHeaders({ 'x-test-ip': `10.${w === 'sp' ? 110 : 111}.4.1`, 'x-test-now': at(w, 4, 25) });
	await page.goto('/kadai');
	await expect(bell(page)).toHaveAccessibleName('通知（未読 1件）');
	await expect(bell(page)).toHaveText('1');
	await bell(page).click();
	await expect(page).toHaveURL(/\/tsuchi$/);
	await expect(bell(page)).toHaveAccessibleName('通知（未読 0件）');

	// ログインしていなければベルを出さず、「わたしの記録」はログインへ
	const anonymous = await browser.newContext({ baseURL: ORIGIN });
	contexts.push(anonymous);
	const stranger = await anonymous.newPage();
	await stranger.goto('/kadai');
	await expect(stranger.getByRole('link', { name: /^通知/ })).toHaveCount(0);
	await stranger.getByRole('banner').getByRole('link', { name: 'わたしの記録', exact: true }).click();
	await expect(stranger).toHaveURL(/\/login\?next=%2Fwatashi$/);
});

test('基準5：PC はタブの一覧より下のページに「課題 ／ 課題の詳細」の形のパンくずを出す（スマホは出さない）', async ({ browser }, info) => {
	const pc = info.project.name === 'pc';
	const page = await person(browser, info.project.name, 5, at(info.project.name, 5, 10));
	const id = await postIssue(page, { title: `パンくずの課題 ${info.project.name}${Date.now() % 1e8}` });
	for (const [path, section, href, name] of [
		[`/kadai/${id}`, '課題', '/kadai', '課題の詳細'],
		['/kadai/kaku', '課題', '/kadai', '課題を書く'],
		['/houan/kakikata', '法案', '/houan', '法案の書き方'],
		[`/hourei/${LAW}`, '法律', '/hourei', '消費者契約法']
	] as const) {
		await page.goto(path);
		if (!pc) {
			await expect(crumbs(page), path).toHaveCount(0);
			continue;
		}
		await expect(crumbs(page), path).toBeVisible();
		await expect(crumbs(page).getByRole('link')).toHaveCount(1);
		await expect(crumbs(page).getByRole('link', { name: section, exact: true }), path).toHaveAttribute('href', href);
		await expect(crumbs(page), path).toHaveText(`${section} ／ ${name}`);
	}
	// タブの一覧そのものには出さない
	for (const path of ['/', '/kadai', '/houan', '/saiketsu', '/hourei']) {
		await page.goto(path);
		await expect(crumbs(page), path).toHaveCount(0);
	}
});

test('基準6：ホームの「課題」「法案」「採決」「通知」へのリンクの段を外し、検索の欄は残す', async ({ browser }, info) => {
	const page = await person(browser, info.project.name, 6, at(info.project.name, 6, 10));
	await page.goto('/');
	const main = page.getByRole('main');
	for (const name of ['課題を見る', '法案を見る', '採決を見る']) await expect(page.getByRole('link', { name, exact: true })).toHaveCount(0);
	await expect(main.getByRole('link', { name: /^通知/ })).toHaveCount(0);
	await expect(main.getByRole('searchbox', { name: '法令や課題を探す' })).toBeVisible();
});
