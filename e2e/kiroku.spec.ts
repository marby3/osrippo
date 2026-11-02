// Issue #16 法令ページ：条ごとの「変わった記録」
import { expect, test, type Page } from '@playwright/test';

const article = (page: Page, name: string) => page.getByRole('article', { name, exact: true });

async function open(page: Page, lawId: string, name: string) {
	await page.goto(`/hourei/${lawId}`);
	// ボタンはスクリプトで動くので、ハイドレーションが済むまで待つ
	await page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
	await article(page, name).getByRole('button', { name: '変わった記録を見る' }).click();
	const record = page.getByRole('region', { name: `${name}が変わった記録` });
	await expect(record).toBeVisible();
	return record;
}

test('基準1：改正された条にだけ出て、スマホは条の下、PCは右の欄に開く', async ({ page }, info) => {
	await page.goto('/hourei/412AC0000000061');
	await expect(article(page, '第2条').getByRole('button', { name: '変わった記録を見る' })).toHaveCount(0);
	const record = await open(page, '412AC0000000061', '第4条');
	const art4 = (await article(page, '第4条').boundingBox())!;
	const box = (await record.boundingBox())!;
	if (info.project.name === 'sp') {
		await expect(article(page, '第4条').getByRole('region', { name: '第4条が変わった記録' })).toBeVisible();
	} else {
		await expect(article(page, '第4条').getByRole('region')).toHaveCount(0);
		expect(box.x).toBeGreaterThanOrEqual(art4.x + art4.width);
	}
});

test('基準2：施行済みの改正が新しい順に、施行日と法令番号で並び、最後に2017年4月より前の行', async ({ page }) => {
	const items = (await open(page, '412AC0000000061', '第4条')).getByRole('listitem');
	await expect(items).toHaveCount(7);
	await expect(items.nth(0)).toContainText('2023年6月1日 施行');
	await expect(items.nth(0)).toContainText('令和四年法律第五十九号');
	await expect(items.nth(1)).toContainText('2023年1月5日 施行');
	await expect(items.nth(1)).toContainText('令和四年法律第九十九号');
	await expect(items.nth(5)).toContainText('2017年6月2日 施行');
	await expect(items.last()).toContainText('2017年4月より前');
	await expect(items.last()).toContainText('条文ごとの記録は準備中');
});

test('基準3：いちばん上に最新の改正の変更点が記号つきで出る', async ({ page }) => {
	const record = await open(page, '412AC0000000061', '第4条');
	const removed = record.locator('del').first();
	const added = record.locator('ins').first();
	await expect(removed).toHaveCSS('text-decoration-line', /line-through/);
	await expect(removed).toContainText('−');
	await expect(added).toHaveCSS('text-decoration-line', /underline/);
	await expect(added).toContainText('＋');
});

test('基準4：番号が変わった条も前の番号の時期までつながる', async ({ page }) => {
	// 特定商取引法 第15条の3 は 2017-12-01 に第15条の2から繰り下がった
	const items = (await open(page, '351AC0000000057', '第15条の3')).getByRole('listitem');
	await expect(items).toHaveCount(3);
	await expect(items.nth(0)).toContainText('2020年4月1日 施行');
	await expect(items.nth(1)).toContainText('2017年12月1日 施行');
	await expect(items.nth(1)).not.toContainText('当時は');
	await expect(items.last()).toContainText('2017年4月より前');
	await expect(items.last()).toContainText('（当時は第15条の2）');
});

test('記録の URL が崩れていたり、ない条・法令なら 404', async ({ request }) => {
	for (const path of [
		'/hourei/412AC0000000061/kiroku/99999',
		'/hourei/412AC0000000061/kiroku/2',
		'/hourei/412AC0000000061/kiroku/%E7%AC%AC4%E6%9D%A1',
		'/hourei/000AC0000000000/kiroku/4'
	]) {
		expect((await request.get(path)).status(), path).toBe(404);
	}
});
