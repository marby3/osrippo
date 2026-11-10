// Issue #129：法令用語のふりがなと「表示の設定」。一覧の当て方は src/lib/domain/law/glossary.test.ts
import { expect, test, type Browser, type Page } from '@playwright/test';
import { createAmendBill, issueWithSolutions, newUser } from './helpers';

const LAW = '351AC0000000057';
const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
/** 第17条（電話勧誘販売の再勧誘の禁止）：「役務」「勧誘」がある */
const article17 = (page: Page) => page.locator('[id="jo-17"]');
const rubyOf = (page: Page, base: string) => page.locator('ruby', { hasText: base });
/** 読み仮名は CSS で描く（文の文字には入らない）ので、描いた中身を読む */
const reading = (rt: ReturnType<Page['locator']>) => rt.evaluate((el) => getComputedStyle(el, '::before').content.replace(/^"|"$/g, ''));
const htmlFontSize = (page: Page) => page.evaluate(() => getComputedStyle(document.documentElement).fontSize);

/** 特定商取引法 第17条の「当該売買契約又は当該役務提供契約の締結について」を消す法案（変更点のページ） */
async function billChanges(browser: Browser, w: string) {
	const u = await newUser(browser, { name: `furi${w}${Date.now() % 1e7}`, ip: `10.129.0.${w === 'sp' ? 1 : 2}`, days: 8 });
	const { articles } = (await (await u.page.request.get(`/houan/kaku/joubun?law=${LAW}`)).json()) as { articles: { num: string; caption: string }[] };
	const caption = articles.find((a) => a.num === '17')!.caption;
	const { ids } = await issueWithSolutions(u.page, `ふりがなの法案 ${w}${Date.now() % 1e7}`, ['解決策']);
	const bill = await createAmendBill(
		u.page,
		`ふりがなの法案 ${w}`,
		ids[0],
		{ 'body.0': '販売業者又は役務提供事業者は、電話勧誘販売に係る売買契約又は役務提供契約を締結しない旨の意思を表示した者に対し、勧誘をしてはならない。' },
		{ law: LAW, num: '17', caption, label: '第17条' }
	);
	return { ...u, bill };
}

test('基準1・2：法令のページ（現実と IF世界）、法案の変更点と条文全体で、一覧の言葉に読み仮名が付く', async ({ browser }, info) => {
	test.setTimeout(120_000);
	const { page, context, bill } = await billChanges(browser, info.project.name);
	for (const path of [`/hourei/${LAW}`, `/if/hourei/${LAW}`]) {
		await page.goto(path);
		expect(await reading(article17(page).locator('ruby', { hasText: '役務' }).first().locator('rt'))).toBe('えきむ');
		expect(await reading(article17(page).locator('ruby', { hasText: '勧誘' }).first().locator('rt'))).toBe('かんゆう');
	}
	await page.goto(`${bill}/henkou`);
	expect(await reading(page.locator('ins ruby, del ruby, .text ruby').filter({ hasText: '勧誘' }).first().locator('rt'))).toBe('かんゆう');
	await page.goto(`${bill}/zenbun`);
	expect(await reading(rubyOf(page, '役務').first().locator('rt'))).toBe('えきむ');
	await context.close();
});

test('基準3：法令のページの法令名に、e-Gov の読み仮名が付く', async ({ page }) => {
	for (const path of [`/hourei/${LAW}`, `/if/hourei/${LAW}`]) {
		await page.goto(path);
		expect(await reading(page.getByRole('heading', { level: 1 }).locator('rt'))).toBe('とくていしょうとりひきにかんするほうりつ');
	}
});

test('基準4：法令のページの「表示の設定」で文字の大きさとふりがなを選べる（スクリプトなしでも）', async ({ browser }) => {
	for (const javaScriptEnabled of [true, false]) {
		const context = await browser.newContext({ javaScriptEnabled, baseURL: 'http://localhost:4173' });
		const page = await context.newPage();
		await page.goto(`/hourei/${LAW}`);
		if (javaScriptEnabled) await hydrated(page);
		expect(await htmlFontSize(page)).toBe('16px');
		await page.getByText('表示の設定', { exact: true }).click();
		await page.getByRole('group', { name: '文字の大きさ' }).getByLabel('大きい', { exact: true }).check();
		await page.getByRole('group', { name: 'ふりがな' }).getByLabel('付けない', { exact: true }).check();
		await page.getByRole('button', { name: '保存する' }).click();
		await expect(page).toHaveURL(new RegExp(`/hourei/${LAW}$`));
		await expect.poll(() => htmlFontSize(page), String(javaScriptEnabled)).toBe('18px');
		await expect(article17(page).locator('rt').first()).toBeHidden();
		await context.close();
	}
});

test('基準5：設定はブラウザに覚え、ほかの画面にも効き、最初から設定のとおりに描く', async ({ browser }) => {
	const context = await browser.newContext({ baseURL: 'http://localhost:4173' });
	const page = await context.newPage();
	await page.goto(`/hourei/${LAW}`);
	await page.getByText('表示の設定', { exact: true }).click();
	await page.getByRole('group', { name: '文字の大きさ' }).getByLabel('とても大きい', { exact: true }).check();
	await page.getByRole('group', { name: 'ふりがな' }).getByLabel('付けない', { exact: true }).check();
	await page.getByRole('button', { name: '保存する' }).click();
	await expect.poll(() => htmlFontSize(page)).toBe('20px');
	// ほかの画面（課題の一覧、IF世界の法令のページ）にも効く
	await page.goto('/kadai');
	expect(await htmlFontSize(page)).toBe('20px');
	await page.goto(`/if/hourei/${LAW}`);
	await expect(article17(page).locator('rt').first()).toBeHidden();
	await expect(page.getByRole('heading', { level: 1 }).locator('rt')).toBeHidden();
	// サーバーが描いた HTML に設定が入っている（いったん標準で出てから変わらない）
	const html = await (await page.request.get('/kadai')).text();
	expect(html).toMatch(/<html[^>]*data-text-size="xl"/);
	expect(html).toMatch(/<html[^>]*data-ruby="off"/);
	// 標準に戻せる
	await page.goto(`/hourei/${LAW}`);
	await page.getByText('表示の設定', { exact: true }).click();
	await page.getByRole('group', { name: '文字の大きさ' }).getByLabel('標準', { exact: true }).check();
	await page.getByRole('group', { name: 'ふりがな' }).getByLabel('付ける', { exact: true }).check();
	await page.getByRole('button', { name: '保存する' }).click();
	await expect.poll(() => htmlFontSize(page)).toBe('16px');
	await expect(article17(page).locator('rt').first()).toBeVisible();
	await context.close();
});

test('基準6：読み仮名を付けても、消した部分は取り消し線と「−」、足した部分は下線と「＋」のまま', async ({ browser }, info) => {
	test.setTimeout(120_000);
	const { page, context, bill } = await billChanges(browser, `${info.project.name}6`);
	await page.goto(`${bill}/henkou`);
	// 消した「当該売買契約又は当該役務提供契約の締結について」の中の「役務」にも読み仮名が付き、「−」と取り消し線は残る
	const removed = page.locator('del', { has: page.locator('ruby', { hasText: '役務' }) }).first();
	await expect(removed).toBeVisible();
	expect((await removed.textContent())!.startsWith('−')).toBe(true);
	expect(await removed.evaluate((el) => getComputedStyle(el).textDecorationLine)).toContain('line-through');
	expect(await reading(removed.locator('ruby rt').first())).toBe('えきむ');
	await context.close();
});
