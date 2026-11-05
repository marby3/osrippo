// Issue #95 基準3と信頼の境界：現実の改正の取り込みの一覧のページ。中身の判定は src/lib/db/import-real.test.ts。
// データはテストのサーバーだけの /test-import で作る（委員会の外の法令なので、共有の3法に触らない）
import { expect, test, type APIRequestContext } from '@playwright/test';

const stamp = () => Date.now() % 1e8;
const textOf = (n: number, tail = '') => String.fromCodePoint(0x4e00 + n * 97).repeat(30) + tail;

const send = async (request: APIRequestContext, data: unknown) => {
	const res = await request.post('/test-import', { data });
	expect(res.status(), await res.text()).toBe(200);
	return res.json();
};

test('基準3：取り込みの一覧のページに、変わった条とぶつかった条文が出て、IF世界の法令ページの印は法案で消える', async ({ page, request, browser }, info) => {
	const w = info.project.name;
	const lawId = `T95${w}${stamp()}`;
	const title = `取り込みのテストの法律${lawId}`;
	const base = [1, 2, 3, 4, 5, 6].map((n) => ({ num: String(n), text: textOf(n) }));
	await send(request, { op: 'create', lawId, title, revision: { id: `${lawId}_base`, date: '2017-01-01', articles: base } });
	const { billId } = await send(request, {
		op: 'bill',
		lawId,
		title: `法案${lawId}`,
		changes: [
			{ num: '2', op: 'amend', text: 'IF世界の第2条の本文' },
			{ num: '3', op: 'delete' },
			{ num: '4', op: 'amend', text: 'IF世界の第4条の本文' }
		]
	});

	// 取り込みがまだない
	await page.goto(`/if/hourei/${lawId}/torikomi`);
	await expect(page.locator('[data-if-band]')).toBeVisible();
	await expect(page.getByText('架空の法令')).toBeVisible();
	await expect(page.getByRole('heading', { name: '現実の改正の取り込み' })).toBeVisible();
	await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
	await expect(page.getByText('取り込んだ現実の改正はまだありません')).toBeVisible();

	await send(request, {
		op: 'revise',
		lawId,
		revision: {
			id: `${lawId}_r1`,
			date: '2020-04-01',
			amendmentTitle: '第一の改正法',
			articles: [
				{ num: '1', text: textOf(1, 'を改める') },
				{ num: '2', text: textOf(2, 'を改める') },
				{ num: '3', text: textOf(3, 'を改める') },
				{ num: '6', text: textOf(6) },
				{ num: '7', text: textOf(5) }
			]
		}
	});
	// 条文の変更がない取り込み（附則だけの改正）
	await send(request, {
		op: 'revise',
		lawId,
		revision: {
			id: `${lawId}_r2`,
			date: '2021-04-01',
			amendmentTitle: '第二の改正法',
			articles: [
				{ num: '1', text: textOf(1, 'を改める') },
				{ num: '2', text: textOf(2, 'を改める') },
				{ num: '3', text: textOf(3, 'を改める') },
				{ num: '6', text: textOf(6) },
				{ num: '7', text: textOf(5) }
			]
		}
	});

	await page.goto(`/if/hourei/${lawId}/torikomi`);
	const imports = page.locator('[data-import]');
	await expect(imports).toHaveCount(2);
	// 新しい順
	await expect(imports.nth(0)).toContainText('2021年4月1日');
	await expect(imports.nth(0)).toContainText('第二の改正法');
	await expect(imports.nth(0)).toContainText('条文の変更はありません');
	const first = imports.nth(1);
	await expect(first).toContainText('2020年4月1日');
	await expect(first).toContainText('第一の改正法');
	// 変わった条（番号が変わった条は前後の番号）
	await expect(first.locator('[data-changed]')).toContainText(['第1条']);
	await expect(first.getByText('第5条→第7条')).toBeVisible();

	// ぶつかった条文は現実と IF世界を番号つきで並べる
	const conflicts = first.locator('[data-conflict]');
	await expect(conflicts).toHaveCount(3);
	const second = conflicts.filter({ hasText: '第2条' });
	await expect(second).toContainText('現実の法律');
	await expect(second).toContainText(textOf(2, 'を改める'));
	await expect(second).toContainText('IF世界の法律');
	await expect(second).toContainText('IF世界の第2条の本文');
	await expect(second.getByRole('link', { name: `法案${lawId}` })).toHaveAttribute('href', `/houan/${billId}`);
	// IF世界で削除した条、現実でなくなった条
	await expect(conflicts.filter({ hasText: '第3条' })).toContainText('IF世界では削除されています');
	await expect(conflicts.filter({ hasText: '第4条' })).toContainText('現実の法律ではなくなりました');
	await expect(conflicts.filter({ hasText: '第4条' })).toContainText('IF世界の第4条の本文');

	// 画面の幅をはみ出さない
	const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
	expect(overflow).toBeLessThanOrEqual(0);

	// IF世界の法令ページのリンクと印
	await page.goto(`/if/hourei/${lawId}`);
	await expect(page.locator('#jo-2')).toContainText('現実の改正とぶつかっています');
	await expect(page.locator('#jo-1')).not.toContainText('現実の改正とぶつかっています');
	await expect(page.locator('#jo-1')).toContainText('を改める');
	await page.getByRole('link', { name: '現実の改正の取り込み' }).click();
	await expect(page).toHaveURL(new RegExp(`/if/hourei/${lawId}/torikomi$`));

	// あとの法案でその条を変えると印が消える。一覧には当時の記録が残る
	await send(request, { op: 'bill', lawId, title: `調整${lawId}`, changes: [{ num: '2', op: 'amend', text: 'IF世界で調整した第2条の本文' }] });
	await page.goto(`/if/hourei/${lawId}`);
	await expect(page.locator('#jo-2')).toContainText('IF世界で調整した第2条の本文');
	await expect(page.locator('#jo-2')).not.toContainText('現実の改正とぶつかっています');
	await expect(page.locator('#jo-4')).toContainText('現実の改正とぶつかっています');
	await page.goto(`/if/hourei/${lawId}/torikomi`);
	await expect(page.locator('[data-conflict]').filter({ hasText: '第2条' })).toContainText('IF世界の第2条の本文');

	// 新法のページにはない。テストのサーバーの外には /test-import がない
	expect((await request.get('/if/hourei/if-999999/torikomi')).status()).toBe(404);
	const other = await browser.newContext({ baseURL: 'http://localhost:4174' });
	expect((await other.request.post('/test-import', { data: { op: 'create' } })).status()).toBe(404);
	await other.close();
});

test('信頼の境界：取り込みの一覧の番号と ?page= の形が違えば 404', async ({ request }, info) => {
	const lawId = `T95b${info.project.name}${stamp()}`;
	await send(request, { op: 'create', lawId, title: `境界のテストの法律${lawId}`, revision: { id: `${lawId}_base`, date: '2017-01-01', articles: [{ num: '1', text: textOf(1) }] } });
	expect((await request.get(`/if/hourei/${lawId}/torikomi`)).status()).toBe(200);
	for (const bad of ['nosuch', 'if-1', '%00', "x'--", 'a'.repeat(300)]) expect((await request.get(`/if/hourei/${bad}/torikomi`)).status(), bad).toBe(404);
	for (const page of ['0', '1', '-1', 'abc', '1e3', '2', '99999']) expect((await request.get(`/if/hourei/${lawId}/torikomi?page=${page}`)).status(), page).toBe(404);
});
