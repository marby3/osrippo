// Issue #164：法律の別名 URL（略称）と、条だけのページ（受入基準は Issue #198 の「#164」の節）
// 条文の本文は法令用語の説明（役務 など）が間に入るので、説明の付かない言葉の続きで確かめる
import { expect, test } from '@playwright/test';

const TOKUSHOHO = '351AC0000000057';
const MINPO = '129AC0000000089';
const ARTICLE = `/hourei/${TOKUSHOHO}/9`;

test('基準1：別名の URL は本来の URL へ 301 で送り、別名のない法律はいまの URL のまま', async ({ page, request }) => {
	for (const [alias, lawId] of [
		['tokushoho', TOKUSHOHO],
		['shohishakeiyaku', '412AC0000000061'],
		['keihyoho', '337AC0000000134']
	]) {
		const res = await request.get(`/hourei/${alias}`, { maxRedirects: 0 });
		expect(res.status(), alias).toBe(301);
		expect(new URL(res.headers()['location'], 'http://localhost').pathname, alias).toBe(`/hourei/${lawId}`);
	}
	// 条だけのページも、別名で来たら本来の URL へ
	const article = await request.get('/hourei/tokushoho/9', { maxRedirects: 0 });
	expect(article.status()).toBe(301);
	expect(new URL(article.headers()['location'], 'http://localhost').pathname).toBe(ARTICLE);

	await page.goto('/hourei/tokushoho');
	expect(new URL(page.url()).pathname).toBe(`/hourei/${TOKUSHOHO}`);
	await expect(page.getByRole('heading', { level: 1, name: '特定商取引に関する法律' })).toBeVisible();

	// 別名のない法律
	const plain = await request.get(`/hourei/${MINPO}`, { maxRedirects: 0 });
	expect(plain.status()).toBe(200);
});

test('基準2：条だけのページに、その条の本文と、前の条・次の条・法令全体へのリンク、この条の URL が出る。ない条は 404', async ({ page, request, browser }) => {
	await page.goto(ARTICLE);
	await expect(page.getByRole('heading', { level: 1, name: /第9条/ })).toBeVisible();
	await expect(page.getByText('（訪問販売における契約の申込みの撤回等）')).toBeVisible();
	await expect(page.getByRole('main')).toContainText('（以下この条から第九条の三までにおいて「申込者等」という。）');
	await expect(page.getByRole('link', { name: /前の条.*第8条の2/ })).toHaveAttribute('href', `/hourei/${TOKUSHOHO}/8_2`);
	await expect(page.getByRole('link', { name: /次の条.*第9条の2/ })).toHaveAttribute('href', `/hourei/${TOKUSHOHO}/9_2`);
	await expect(page.getByRole('link', { name: '法律全体を読む' })).toHaveAttribute('href', `/hourei/${TOKUSHOHO}#jo-9`);
	// 共有しやすいよう、別名のある法律は別名の URL を出す（開くと本来の URL へ送る）
	await expect(page.getByRole('textbox', { name: 'この条の URL' })).toHaveValue(/\/hourei\/tokushoho\/9$/);

	await page.getByRole('link', { name: /次の条/ }).click();
	await expect(page).toHaveURL(new RegExp(`/hourei/${TOKUSHOHO}/9_2$`));
	await expect(page.getByRole('heading', { level: 1, name: /第9条の2/ })).toBeVisible();

	// 最初の条には前の条がない
	await page.goto(`/hourei/${TOKUSHOHO}/1`);
	await expect(page.getByRole('heading', { level: 1, name: /第1条/ })).toBeVisible();
	await expect(page.getByRole('link', { name: /前の条/ })).toHaveCount(0);
	await expect(page.getByRole('link', { name: /次の条.*第2条/ })).toBeVisible();

	// スクリプトなしでも URL が読める
	const noJs = await browser.newContext({ javaScriptEnabled: false });
	const p = await noJs.newPage();
	await p.goto(`http://localhost:4173${ARTICLE}`);
	await expect(p.getByRole('textbox', { name: 'この条の URL' })).toHaveValue(/\/hourei\/tokushoho\/9$/);
	await noJs.close();

	expect((await request.get(`/hourei/${TOKUSHOHO}/9999`)).status()).toBe(404);
	expect((await request.get(`/hourei/NOSUCHLAW/9`)).status()).toBe(404);
});

test('基準3：IF世界の条だけのページに、紫の斜線の帯、「架空の法令」、noindex が付く', async ({ page, request }) => {
	await page.goto(`/if/hourei/${TOKUSHOHO}/9`);
	await expect(page.locator('[data-if-band]')).toBeVisible();
	await expect(page.getByText('架空の法令', { exact: true })).toBeVisible();
	await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
	await expect(page.getByRole('heading', { level: 1, name: /第9条/ })).toBeVisible();
	await expect(page.getByRole('main')).toContainText('（以下この条から第九条の三までにおいて「申込者等」という。）');
	await expect(page.getByRole('link', { name: /次の条.*第9条の2/ })).toHaveAttribute('href', `/if/hourei/${TOKUSHOHO}/9_2`);
	expect((await request.get(`/if/hourei/${TOKUSHOHO}/9999`)).status()).toBe(404);
});

test('基準4：読める法律でも条だけのページが開く', async ({ page, request }) => {
	await page.goto(`/hourei/${MINPO}/1`);
	await expect(page.getByRole('heading', { level: 1, name: /第1条/ })).toBeVisible();
	await expect(page.getByRole('main')).toContainText('私権は、公共の福祉に適合しなければならない。');
	await expect(page.getByText('読める法律（最新の版だけ）')).toBeVisible();
	await expect(page.getByRole('link', { name: /次の条.*第2条/ })).toHaveAttribute('href', `/hourei/${MINPO}/2`);
	await expect(page.getByRole('link', { name: '法律全体を読む' })).toHaveAttribute('href', `/hourei/${MINPO}#jo-1`);
	await expect(page.getByRole('textbox', { name: 'この条の URL' })).toHaveValue(new RegExp(`/hourei/${MINPO}/1$`));
	expect((await request.get(`/hourei/${MINPO}/99999`)).status()).toBe(404);
});

test('信頼の境界：形の違う条の番号や別名は 404 で、送り先を作らない', async ({ request }) => {
	const bad = ['abc', '9_', '_9', '9__2', '-1', '9.0', '9a', '%EF%BC%99', '%3Cscript%3E', '9%00', '9%2F..%2F1', '1'.repeat(300)];
	for (const num of bad) {
		for (const base of [`/hourei/${TOKUSHOHO}`, `/if/hourei/${TOKUSHOHO}`, `/hourei/${MINPO}`, '/hourei/tokushoho']) {
			// 別名で来た形の正しい番号は本来の URL へ送ってから 404 になるので、送り先まで追う
			const res = await request.get(`${base}/${num}`);
			expect(res.status(), `${base}/${num}`).toBe(404);
		}
	}
	// 表にない別名、大文字、法令ID の形でない文字は送らない
	for (const path of ['/hourei/nosuchalias', '/hourei/TOKUSHOHO', '/hourei/tokushoho%2F9', '/hourei/%3Cscript%3E/9']) {
		const res = await request.get(path, { maxRedirects: 0 });
		expect(res.status(), path).toBe(404);
	}
});
