// Issue #125：課題の「法案あり」の絞り込みと印、「この課題から生まれた法案」
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { createAmendBill, issueWithSolutions, newUser, ORIGIN } from './helpers';

const sp = (name: string) => name === 'sp';
type Box = { x: number; y: number; width: number; height: number };
const box = async (target: Locator): Promise<Box> => (await target.boundingBox())!;

/** 法案のある課題と、解決策だけの課題。題名に同じ目印の言葉を入れ、探す欄で2つだけに絞れるようにする */
async function issues(browser: Browser, w: string, n: number) {
	// 探す欄で確実に当たるよう、目印はカタカナだけ（数字はカタカナに置きかえる）
	const kana = (x: string) => [...x].map((c) => 'アイウエオカキクケコ'[Number(c)]).join('');
	const mark = `メジルシ${kana(`${sp(w) ? 1 : 2}${n}${Date.now() % 1e7}`)}`;
	const writer = await newUser(browser, { name: `kh${w}${n}${Date.now() % 1e7}`, ip: `10.125.${n}.${sp(w) ? 1 : 2}`, days: 8 });
	const a = await issueWithSolutions(writer.page, `${mark} あり`, [`解決策 ${mark} あり`]);
	const bill = await createAmendBill(writer.page, `生まれた法案 ${mark}`, a.ids[0]);
	const b = await issueWithSolutions(writer.page, `${mark} なし`, [`解決策 ${mark} なし`]);
	await writer.context.close();
	const reader = await newUser(browser, { name: `kr${w}${n}${Date.now() % 1e7}`, ip: `10.125.${n}.${sp(w) ? 3 : 4}`, days: 8 });
	return { page: reader.page, mark, a, b, bill, billTitle: `生まれた法案 ${mark}` };
}

// スマホは表の行を縦に並べ替えるので、役割（row）ではなく tr で探す
const row = (page: Page, title: string) => page.locator('tr', { has: page.getByRole('link', { name: title, exact: true }) });

test('基準1：「法案あり」を選ぶと法案のある課題だけになり、探す言葉と並びは残る。スクリプトなしでも絞り込める', async ({ browser }, info) => {
	const w = info.project.name;
	const s = await issues(browser, w, 1);
	const context = await browser.newContext({ baseURL: ORIGIN, javaScriptEnabled: false, viewport: s.page.viewportSize()! });
	const page = await context.newPage();
	await page.goto(`/kadai?sort=new&q=${encodeURIComponent(s.mark)}`);
	await expect(row(page, s.a.title)).toHaveCount(1);
	await expect(row(page, s.b.title)).toHaveCount(1);
	const filters = page.getByRole('navigation', { name: '表示する課題', exact: true });
	await filters.getByRole('link', { name: '法案あり', exact: true }).click();
	await expect(page).toHaveURL(/houan=ari/);
	await expect(page).toHaveURL(/sort=new/);
	await expect(page).toHaveURL(new RegExp(`q=${encodeURIComponent(s.mark)}`));
	await expect(filters.getByRole('link', { name: '法案あり', exact: true })).toHaveAttribute('aria-current', 'page');
	await expect(row(page, s.a.title)).toHaveCount(1);
	await expect(row(page, s.b.title)).toHaveCount(0);
	await context.close();
});

test('基準2：スマホは行に「・ 法案あり」を太字で、PC は「法案」の列に「あり」（太字）か「なし」', async ({ browser }, info) => {
	const w = info.project.name;
	const s = await issues(browser, w, 2);
	await s.page.goto(`/kadai?sort=new&q=${encodeURIComponent(s.mark)}`);
	const withBill = row(s.page, s.a.title);
	const without = row(s.page, s.b.title);
	if (sp(w)) {
		const mark = withBill.getByText('法案あり', { exact: true });
		await expect(mark).toBeVisible();
		await expect(mark).toHaveCSS('font-weight', '700');
		// 法案のない課題には印を出さない（題名の「法案の元の課題」は課題を作る関数の題名）
		await expect(without.getByText(/法案(あり|なし)/)).toBeHidden();
	} else {
		await expect(s.page.getByRole('columnheader', { name: '法案', exact: true })).toBeVisible();
		const yes = withBill.getByRole('cell', { name: 'あり', exact: true });
		await expect(yes).toBeVisible();
		await expect(yes).toHaveCSS('font-weight', '700');
		await expect(without.getByRole('cell', { name: 'なし', exact: true })).toBeVisible();
	}
});

test('基準3：法案があると「この課題から生まれた法案 N本」の行を出す。PC は右の列の「わかる」の下、スマホは「解決策を書く」の下。通報より上', async ({ browser }, info) => {
	const w = info.project.name;
	const s = await issues(browser, w, 3);
	await s.page.goto(`/kadai/${s.a.issueId}`);
	// 通報の欄はスクリプトが動くと閉じた形（ボタンだけ）になるので、動いてから測る
	await s.page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
	const link = s.page.getByRole('link', { name: 'この課題から生まれた法案 1本', exact: true });
	await expect(link).toBeVisible();
	await expect(link.locator('svg')).toHaveCount(1);
	const l = await box(link);
	const report = await box(s.page.getByRole('button', { name: 'この課題を通報する', exact: true }));
	expect(l.y + l.height).toBeLessThanOrEqual(report.y);
	if (sp(w)) {
		const write = await box(s.page.getByRole('link', { name: '解決策を書く', exact: true }));
		expect(l.y).toBeGreaterThanOrEqual(write.y + write.height);
	} else {
		const support = await box(s.page.getByRole('button', { name: /^わかる \d+$/ }));
		expect(l.x).toBeGreaterThan(support.x - 32);
		expect(l.y).toBeGreaterThan(support.y + support.height);
	}
	// 法案のない課題には出さない
	await s.page.goto(`/kadai/${s.b.issueId}`);
	await expect(s.page.getByRole('link', { name: /この課題から生まれた法案/ })).toHaveCount(0);
});

test('基準4：押すと、この課題から生まれた法案の一覧に移り、種類の札・題名（法案のページへ）・いまの状態を出す', async ({ browser }, info) => {
	const s = await issues(browser, info.project.name, 4);
	await s.page.goto(`/kadai/${s.a.issueId}`);
	await s.page.getByRole('link', { name: 'この課題から生まれた法案 1本', exact: true }).click();
	await expect(s.page).toHaveURL(new RegExp(`/kadai/${s.a.issueId}/houan$`));
	const item = s.page.getByRole('main').getByRole('listitem').filter({ hasText: s.billTitle });
	await expect(item).toHaveCount(1);
	await expect(item.getByText('改正', { exact: true })).toBeVisible();
	await expect(item.getByText('下書き', { exact: true })).toBeVisible();
	await item.getByRole('link', { name: s.billTitle, exact: true }).click();
	await expect(s.page).toHaveURL(new RegExp(`${s.bill}$`));
});
