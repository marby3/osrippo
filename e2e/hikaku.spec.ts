// Issue #12 2時点の比較ページ
import { expect, test, type Page } from '@playwright/test';

const PAGE = '/hourei/412AC0000000061/hikaku';
const rev = (s: string) => `412AC0000000061_${s}`;
const R20230105 = rev('20230105_504AC0000000099');
const R20230601 = rev('20230601_504AC0000000059');

async function compare(page: Page, mae: string, ato: string) {
	await page.goto(PAGE);
	await page.getByLabel('前の版').selectOption(mae);
	await page.getByLabel('後の版').selectOption(ato);
	await page.getByRole('button', { name: '比べる' }).click();
}

const article = (page: Page, name: string) => page.getByRole('article', { name, exact: true });

test('基準1：版の選択欄と「比べる」があり、初めは現在の版とその1つ前を比べている', async ({ page }) => {
	await page.goto(PAGE);
	const mae = page.getByLabel('前の版');
	const ato = page.getByLabel('後の版');
	await expect(mae).toHaveValue(rev('20250601_504AC0000000068'));
	await expect(ato).toHaveValue(rev('20260624_508AC0000000046'));
	await expect(mae.getByRole('option')).toHaveCount(19);
	await expect(ato.getByRole('option', { name: /2028年12月23日.*施行予定/ })).toHaveCount(1);
	await expect(ato.getByRole('option', { name: /2023年6月1日.*消費者契約法及び消費者の財産的被害の集団的な回復/ })).toHaveCount(1);
	await expect(page.getByRole('button', { name: '比べる' })).toBeVisible();
	// 2025-06-01 → 2026-06-24 は本則が変わっていない
	await expect(page.getByText('変わった条はありません')).toBeVisible();
});

test('基準2：変わった条だけが並ぶ（新しく入った条、なくなった条を含む）', async ({ page }) => {
	await compare(page, R20230105, R20230601);
	await expect(page.getByRole('article')).toHaveCount(12);
	for (const name of ['第3条', '第4条', '第12条の2', '第13条']) await expect(article(page, name)).toBeVisible();
	await expect(article(page, '第1条')).toHaveCount(0);
	await expect(article(page, '第12条の3')).toContainText('新しく入った条');
	await expect(article(page, '第12条の3').locator('ins')).toContainText('＋');

	await page.goto(
		'/hourei/351AC0000000057/hikaku?mae=351AC0000000057_20170602_428AC0000000060&ato=351AC0000000057_20171201_428AC0000000060'
	);
	await expect(article(page, '第70条の3')).toContainText('なくなった条');
	await expect(article(page, '第70条の3').locator('del')).toContainText('−');
});

test('基準3：削除は取り消し線と「−」、追加は下線と「＋」', async ({ page }) => {
	await compare(page, R20230105, R20230601);
	const art4 = article(page, '第4条');
	const removed = art4.locator('del').first();
	const added = art4.locator('ins').first();
	await expect(removed).toHaveCSS('text-decoration-line', /line-through/);
	await expect(removed).toContainText('−');
	await expect(added).toHaveCSS('text-decoration-line', /underline/);
	await expect(added).toContainText('＋');
});

test('基準4：スマホは改正前→改正後の縦並び、PCは改正後が左の新旧対照表', async ({ page }, info) => {
	await compare(page, R20230105, R20230601);
	const art4 = article(page, '第4条');
	const before = (await art4.getByRole('region', { name: '改正前' }).boundingBox())!;
	const after = (await art4.getByRole('region', { name: '改正後' }).boundingBox())!;
	if (info.project.name === 'sp') {
		expect(before.y + before.height).toBeLessThanOrEqual(after.y);
	} else {
		expect(after.x + after.width).toBeLessThanOrEqual(before.x);
		expect(Math.abs(after.y - before.y)).toBeLessThan(2);
	}
});

test('基準5：前の版に新しいほうを選んでも、古い順に入れ替えて比べる', async ({ page }) => {
	await compare(page, R20230601, R20230105);
	await expect(page.getByLabel('前の版')).toHaveValue(R20230105);
	await expect(page.getByLabel('後の版')).toHaveValue(R20230601);
	await expect(article(page, '第12条の3')).toContainText('新しく入った条');
	// 表示中と同じ組を逆に選び直しても、選択欄が結果とそろう
	await page.getByLabel('前の版').selectOption(R20230601);
	await page.getByLabel('後の版').selectOption(R20230105);
	await page.getByRole('button', { name: '比べる' }).click();
	await expect(page.getByLabel('前の版')).toHaveValue(R20230105);
	await expect(page.getByLabel('後の版')).toHaveValue(R20230601);
});

test('基準6：その法令にない版を指定すると 404', async ({ page }) => {
	for (const mae of ['nai', '351AC0000000057_20171201_428AC0000000060', "'%20OR%201=1--"]) {
		const res = await page.goto(`${PAGE}?mae=${mae}&ato=${R20230601}`);
		expect(res?.status(), mae).toBe(404);
	}
	expect((await page.goto('/hourei/000AC0000000000/hikaku'))?.status()).toBe(404);
});

test('基準7：法令ページから比較ページへ行ける', async ({ page }) => {
	await page.goto('/hourei/412AC0000000061');
	await page.getByRole('link', { name: '2つの版を比べる' }).click();
	await expect(page).toHaveURL(/\/hourei\/412AC0000000061\/hikaku/);
});
