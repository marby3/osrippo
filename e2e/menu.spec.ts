// Issue #85：全体のメニュー（PcHeader・SpNav）とパンくず
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { billSupportRequest, createAmendBill, issueWithSolutions, newUser, ORIGIN, postIssue, proposeRequest } from './helpers';

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

test('基準1：PC はどのページにも上のメニュー（ロゴ・5つのタブと「データ」・ベル・わたしの記録）を出す', async ({ browser }, info) => {
	test.skip(info.project.name !== 'pc', 'PC の案（PcHeader）');
	const page = await person(browser, 'pc', 1, at('pc', 1, 10));
	for (const path of ['/', '/kadai', '/houan', '/saiketsu', '/hourei', `/hourei/${LAW}`, '/kensaku', '/watashi']) {
		await page.goto(path);
		const banner = page.getByRole('banner');
		await expect(banner.getByRole('link', { name: SITE, exact: true }), path).toHaveAttribute('href', '/');
		// PC は5つのタブの右に「データ」（統計ページ。Issue #154）
		await expect(menu(page).getByRole('link')).toHaveCount(TABS.length + 1);
		for (const [name, href] of [...TABS, ['データ', '/toukei']]) await expect(menu(page).getByRole('link', { name, exact: true }), path).toHaveAttribute('href', href);
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
		// 書く画面のスマホは下のタブを隠す（#118）ので、PC だけで確かめる
		...(info.project.name === 'pc' ? ([['/kadai/kaku', '課題']] as const) : []),
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

// Issue #118：スマホで入力・投票中は下のタブを隠し（Tokens）、画面の下に留めたボタンをタブに重ねない

/** 発議した法案と、その月の時刻を進める手立て。w と n で年を分ける */
async function proposedBill(browser: Parameters<typeof newUser>[0], w: string, n: number) {
	const year = 2500 + n * 2 + (w === 'sp' ? 0 : 1);
	const day = (d: number) => `${year}-05-${String(d).padStart(2, '0')}T09:00:00+09:00`;
	const label = `${w}${n}-${Date.now() % 1e8}`;
	const people: { page: Page; ip: string }[] = [];
	const person = async (who: string) => {
		const ip = `10.${w === 'sp' ? 112 : 113}.${n}.${people.length + 1}`;
		const u = await newUser(browser, { name: `${who}${label}`, ip, days: 8 });
		contexts.push(u.context);
		await u.context.setExtraHTTPHeaders({ 'x-test-ip': ip, 'x-test-now': day(5) });
		people.push({ page: u.page, ip });
		return u.page;
	};
	const author = await person('a');
	const { issueId, ids } = await issueWithSolutions(author, `隠すタブ ${label}`, [`解決策 ${label}`]);
	const bill = await createAmendBill(author, `隠すタブの法案 ${label}`, ids[0], { 'body.0': `この法律は、${label}のためのものである。` });
	const backers = [await person('b'), await person('c'), await person('d')];
	const reader = await person('e');
	const setDay = async (d: number) => {
		for (const p of people) await p.page.context().setExtraHTTPHeaders({ 'x-test-ip': p.ip, 'x-test-now': day(d) });
	};
	const propose = async () => {
		for (const b of backers) expect((await billSupportRequest(b, bill, { op: 'add', rev: '1' })).status()).toBe(200);
		expect((await proposeRequest(author, bill)).status()).toBe(200);
	};
	return { author, reader, issueId, bill, billId: bill.replace('/houan/', ''), setDay, propose };
}

/** 画面の中に収まり、真ん中を押すとその部品に当たる（ほかの部品に重なっていない） */
async function reachable(page: Page, target: ReturnType<Page['locator']>) {
	await expect(target).toBeVisible();
	const box = (await target.boundingBox())!;
	expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
	const hit = await target.evaluate((el) => {
		const r = el.getBoundingClientRect();
		const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
		return top !== null && (top === el || el.contains(top));
	});
	expect(hit, '真ん中がほかの部品に隠れている').toBe(true);
}

test('#118 基準1：スマホは書く画面と投票の画面で下のタブを隠し、上の帯は出す（PC は変えない）', async ({ browser }, info) => {
	test.setTimeout(180_000);
	const w = info.project.name;
	const s = await proposedBill(browser, w, 1);
	const check = async (page: Page, path: string) => {
		await page.goto(path);
		await expect(page.getByRole('banner'), path).toBeVisible();
		if (w === 'sp') await expect(menu(page), path).toBeHidden();
		else await expect(menu(page), path).toBeVisible();
	};
	// 下書きのうちに書く画面
	for (const path of ['/kadai/kaku', `/kadai/${s.issueId}/kaiketsu/kaku`, '/houan/kaku', `${s.bill}/kaku`]) await check(s.author, path);
	// 質疑と修正（15日）
	await s.propose();
	await s.setDay(15);
	for (const path of [`${s.bill}/shitsugi/kaku`, `${s.bill}/shusei/kaku`]) await check(s.reader, path);
	// 投票（22日）
	await s.setDay(22);
	await check(s.reader, `/saiketsu/${s.billId}`);
	// 書く画面でない法案のページには出す
	await s.reader.goto(s.bill);
	await expect(menu(s.reader)).toBeVisible();
});

test('#118 基準2：スマホの投票の画面で、「票を選んでください」が画面の下に留まり、押せる', async ({ browser }, info) => {
	test.skip(info.project.name !== 'sp', 'スマホの案（SpVote）');
	test.setTimeout(180_000);
	const s = await proposedBill(browser, 'sp', 2);
	await s.propose();
	await s.setDay(22);
	// 小さいスマホでページが画面からはみ出し、ボタンが画面の下に留まる
	await s.reader.setViewportSize({ width: 390, height: 480 });
	await s.reader.goto(`/saiketsu/${s.billId}`);
	expect(await s.reader.evaluate(() => document.documentElement.scrollHeight > innerHeight), 'ページが画面からはみ出していない').toBe(true);
	await reachable(s.reader, s.reader.getByRole('button', { name: '票を選んでください' }));
});

test('#118 基準3：スマホの質疑のタブで、「質疑を書く」が下のタブのすぐ上に留まり、重ならない', async ({ browser }, info) => {
	test.skip(info.project.name !== 'sp', 'スマホの案（SpBillQA）');
	test.setTimeout(180_000);
	const s = await proposedBill(browser, 'sp', 3);
	await s.propose();
	await s.setDay(15);
	// 小さいスマホでページが画面からはみ出し、ボタンが画面の下に留まる
	await s.reader.setViewportSize({ width: 390, height: 480 });
	await s.reader.goto(`${s.bill}/shitsugi`);
	const write = s.reader.getByRole('link', { name: '質疑を書く', exact: true });
	expect(await s.reader.evaluate(() => document.documentElement.scrollHeight > innerHeight), 'ページが画面からはみ出していない').toBe(true);
	await reachable(s.reader, write);
	await expect(menu(s.reader)).toBeVisible();
	const tabs = (await menu(s.reader).boundingBox())!;
	const button = (await write.boundingBox())!;
	expect(button.y + button.height).toBeLessThanOrEqual(tabs.y);
});

// Issue #119：PC の本文の左右の端をメニューにそろえる

/** PC のメニューの端（ロゴの左端と「わたしの記録」の右端）と、本文（main の中身の箱）の左右 */
async function edges(page: Page) {
	const banner = page.getByRole('banner');
	const logo = (await banner.getByRole('link', { name: SITE, exact: true }).boundingBox())!;
	const mine = (await banner.getByRole('link', { name: 'わたしの記録', exact: true }).boundingBox())!;
	const main = await page.getByRole('main').evaluate((el) => {
		const r = el.getBoundingClientRect();
		const s = getComputedStyle(el);
		return { left: r.left + parseFloat(s.paddingLeft), right: r.right - parseFloat(s.paddingRight) };
	});
	return { menuLeft: logo.x, menuRight: mine.x + mine.width, ...main };
}

test('#119 基準1：PC の広いページは、本文の左右の端がメニューの端とそろう', async ({ browser }, info) => {
	test.skip(info.project.name !== 'pc', 'PC だけ');
	test.setTimeout(180_000);
	const s = await proposedBill(browser, 'pc', 4);
	const check = async (page: Page, path: string) => {
		await page.goto(path);
		const e = await edges(page);
		expect(Math.abs(e.left - e.menuLeft), `${path} の左端`).toBeLessThanOrEqual(1);
		expect(Math.abs(e.right - e.menuRight), `${path} の右端`).toBeLessThanOrEqual(1);
	};
	for (const path of ['/', '/kadai', `/kadai/${s.issueId}`, '/kadai/kaku', '/houan', `/hourei/${LAW}`, `/if/hourei/${LAW}`, `/hourei/${LAW}/hikaku`]) await check(s.author, path);
	await s.propose();
	await s.setDay(15);
	for (const path of [s.bill, `${s.bill}/henkou`, `${s.bill}/shitsugi`, `${s.bill}/shusei`, `${s.bill}/shitsugi/kaku`, `${s.bill}/shusei/kaku`]) await check(s.reader, path);
	await s.setDay(22);
	for (const path of [`/saiketsu/${s.billId}`, `/saiketsu/${s.billId}/kekka`]) await check(s.reader, path);
});

test('#119 基準2：PC の採決の一覧は、狭い1列を真ん中に置く', async ({ browser }, info) => {
	test.skip(info.project.name !== 'pc', 'PC だけ');
	const page = await person(browser, 'pc', 7, at('pc', 7, 25));
	await page.goto('/saiketsu');
	const e = await edges(page);
	const width = page.viewportSize()!.width;
	expect(Math.abs(e.left - (width - e.right))).toBeLessThanOrEqual(1);
	// 広いページの幅（メニューの端から端）より、はっきり狭い（100px 以上）
	expect(e.right - e.left).toBeLessThan(e.menuRight - e.menuLeft - 100);
});

test('#119 基準3：PC の案のないページは、本文がメニューの端より外に広がらない', async ({ browser }, info) => {
	test.skip(info.project.name !== 'pc', 'PC だけ');
	test.setTimeout(180_000);
	const s = await proposedBill(browser, 'pc', 5);
	const check = async (page: Page, path: string) => {
		await page.goto(path);
		const e = await edges(page);
		expect(e.left, `${path} の左端`).toBeGreaterThanOrEqual(e.menuLeft - 1);
		expect(e.right, `${path} の右端`).toBeLessThanOrEqual(e.menuRight + 1);
	};
	for (const path of [
		'/kensaku?q=契約',
		'/watashi',
		'/tsuchi',
		'/iinkai',
		'/unei',
		'/hourei',
		'/houan/kakikata',
		'/houan/kaku',
		`${s.bill}/kaku`,
		`/kadai/${s.issueId}/kaiketsu`,
		`/kadai/${s.issueId}/kaiketsu/kaku`,
		`/if/hourei/${LAW}/torikomi`
	])
		await check(s.author, path);
	await s.propose();
	await s.setDay(15);
	await check(s.reader, `${s.bill}/zenbun`);
	await s.setDay(22);
	await check(s.reader, '/saiketsu/hoka');
});
