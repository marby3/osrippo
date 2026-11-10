// Issue #130：ホームの「注目の課題」（SpHome・PcHome）
import { expect, test, type Browser, type Page } from '@playwright/test';
import { newUser, postIssue } from './helpers';

const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
const section = (page: Page) => page.getByRole('region', { name: '注目の課題' });
/** 見えている行の課題の番号（スマホで隠れている4件目は入れない） */
const visibleIds = async (page: Page) =>
	(await section(page).getByRole('link', { name: /.+/ }).filter({ visible: true }).evaluateAll((as) => as.map((a) => a.getAttribute('href')))).filter((h) =>
		/^\/kadai\/\d+$/.test(h ?? '')
	);
/** 課題の一覧の行の課題の番号（上から） */
const listIds = async (page: Page) =>
	page.evaluate(() => [...document.querySelectorAll('main a[href^="/kadai/"]')].map((a) => a.getAttribute('href')).filter((h) => /^\/kadai\/\d+$/.test(h ?? '')));

/** 課題を4件書いておく（このファイルだけを流しても4件以上ある） */
async function fourIssues(browser: Browser, w: string, n: number) {
	const u = await newUser(browser, { name: `chumoku${n}${w}${Date.now() % 1e7}`, ip: `10.130.${n}.${w === 'sp' ? 1 : 2}`, days: 8 });
	for (let i = 1; i <= 4; i++) await postIssue(u.page, { title: `注目の課題のテスト ${n}-${i} ${w}${Date.now() % 1e7}` });
	await u.context.close();
}

test('基準1：ログインしていなくても、ホームに「注目の課題」と、課題名のリンクと「わかる N」の行を出す', async ({ browser, page }, info) => {
	await fourIssues(browser, info.project.name, 1);
	await page.goto('/');
	await hydrated(page);
	await expect(section(page).getByRole('heading', { name: '注目の課題', exact: true })).toBeVisible();
	const first = section(page).getByRole('listitem').first();
	await expect(first.getByRole('link')).toHaveAttribute('href', /^\/kadai\/\d+$/);
	await expect(first.getByText(/^わかる \d+$/)).toBeVisible();
	// リンクの文字は、その課題のページの課題名
	const title = (await first.getByRole('link').innerText()).trim();
	await first.getByRole('link').click();
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
});

test('基準2：課題の一覧の「最近『わかる』が増えている順」の上から、スマホは3件・PC は4件', async ({ browser, page }, info) => {
	test.setTimeout(120_000);
	const w = info.project.name;
	await fourIssues(browser, w, 2);
	const count = w === 'sp' ? 3 : 4;
	// ほかのテストが同時に課題を書くことがあるので、両方を読み直して一致を待つ
	await expect
		.poll(async () => {
			await page.goto('/');
			const home = await visibleIds(page);
			await page.goto('/kadai?sort=rising');
			const list = (await listIds(page)).slice(0, count);
			return JSON.stringify(home) === JSON.stringify(list) && home.length === count;
		}, { timeout: 60_000 })
		.toBe(true);
});

test('基準3：「課題をもっと見る」は、課題の一覧の「最近『わかる』が増えている順」へ', async ({ browser, page }, info) => {
	await fourIssues(browser, info.project.name, 3);
	await page.goto('/');
	await hydrated(page);
	await section(page).getByRole('link', { name: '課題をもっと見る', exact: true }).click();
	await expect(page).toHaveURL(/\/kadai\?sort=rising$/);
});

test('基準4：表示できる課題が1件もなければ、欄を出さない（課題のないサーバー）', async ({ browser }) => {
	// フラグのないサーバー（4174番）の DB は表だけで、課題がない
	const context = await browser.newContext({ baseURL: 'http://localhost:4174' });
	const page = await context.newPage();
	await page.goto('/');
	await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
	await expect(page.getByRole('heading', { name: '注目の課題' })).toHaveCount(0);
	await context.close();
});

test('基準5：スマホは割り当てのカードの下・探す欄の上、PC は左の列の今の会期の下・探す欄の上で、見出しの行の右に「課題をもっと見る」', async ({ browser }, info) => {
	const w = info.project.name;
	await fourIssues(browser, w, 5);
	const u = await newUser(browser, { name: `chumoku5b${w}${Date.now() % 1e7}`, ip: `10.130.5.${w === 'sp' ? 3 : 4}`, days: 8 });
	await u.page.goto('/');
	await hydrated(u.page);
	await expect(section(u.page)).toBeVisible();
	await expect(u.page.getByRole('region', { name: /^あなたの割り当て法案/ })).toBeVisible();
	const box = async (p: Promise<{ x: number; y: number; width: number; height: number } | null>) => (await p)!;
	const s = await box(section(u.page).boundingBox());
	const session = await box(u.page.getByRole('region', { name: /^いまは/ }).boundingBox());
	const assignment = await box(u.page.getByRole('region', { name: /^あなたの割り当て法案/ }).boundingBox());
	const search = await box(u.page.locator('main form[action="/kensaku"]').boundingBox());
	expect(s.y + s.height).toBeLessThanOrEqual(search.y);
	if (w === 'sp') {
		expect(s.y).toBeGreaterThanOrEqual(assignment.y + assignment.height);
	} else {
		expect(s.y).toBeGreaterThanOrEqual(session.y + session.height);
		expect(s.x + s.width).toBeLessThanOrEqual(assignment.x);
		const heading = await box(section(u.page).getByRole('heading', { name: '注目の課題' }).boundingBox());
		const more = await box(section(u.page).getByRole('link', { name: '課題をもっと見る' }).boundingBox());
		expect(more.x).toBeGreaterThan(heading.x + heading.width);
		expect(Math.abs(more.y + more.height / 2 - (heading.y + heading.height / 2))).toBeLessThan(12);
	}
	await u.context.close();
});
