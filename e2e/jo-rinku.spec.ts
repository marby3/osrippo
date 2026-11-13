// Issue #165：本文の「特商法9条」を条へのリンクにする（受入基準は Issue #198 の「#165」の節の基準3・4）
// 見つけ方（名前と条の番号）は src/lib/domain/law/refs.test.ts。ここでは画面のリンクと条のカード、信頼の境界を確かめる
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { ORIGIN, newUser, postIssue, solutionRequest } from './helpers';

const TOKUSHOHO = '351AC0000000057';
const MINPO = '129AC0000000089';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});

const ip = (w: string, group: number, n: number) => `10.${w === 'sp' ? 160 : 161}.${group}.${n}`;
const stamp = () => Date.now() % 1e8;
const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });

async function user(browser: Browser, name: string, ipAddress: string): Promise<Page> {
	const u = await newUser(browser, { name, ip: ipAddress });
	contexts.push(u.context);
	return u.page;
}

test('基準3：リンクを押す前に、条文の小さなカードで本文を読める', async ({ browser }, info) => {
	const w = info.project.name;
	const s = stamp();
	const author = await user(browser, `jr3-${w}-${s}`, ip(w, 3, 1));
	const issueId = await postIssue(author, {
		title: `条へのリンク ${w}-${s}`,
		example: '定期購入の解約は、特商法9条のクーリング・オフとは別に考えるのですか。'
	});
	const res = await solutionRequest(author, issueId, `民法第1条の考え方で整理する ${s}`);
	expect(res.status(), await res.text()).toBe(303);

	await author.goto(`/kadai/${issueId}`);
	await hydrated(author);
	const link = author.getByRole('link', { name: '特商法9条' });
	await expect(link).toHaveAttribute('href', `/hourei/${TOKUSHOHO}/9`);

	// 押すと、ページを離れずに条のカードが開く
	await link.click();
	const card = author.getByRole('dialog', { name: /第9条/ });
	await expect(card).toBeVisible();
	await expect(card).toContainText('特定商取引に関する法律');
	await expect(card).toContainText('（訪問販売における契約の申込みの撤回等）');
	await expect(card).toContainText('（以下この条から第九条の三までにおいて「申込者等」という。）');
	await expect(card).toContainText('現実の法律');
	await expect(card.getByRole('link', { name: 'この条を開く' })).toHaveAttribute('href', `/hourei/${TOKUSHOHO}/9`);
	expect(new URL(author.url()).pathname).toBe(`/kadai/${issueId}`);
	await card.getByRole('button', { name: '閉じる' }).first().click();
	await expect(card).toBeHidden();

	// 解決策の本文の、読める法律の条も同じ
	await author.getByRole('link', { name: '民法第1条' }).click();
	const minpo = author.getByRole('dialog', { name: /第1条/ });
	await expect(minpo).toBeVisible();
	await expect(minpo).toContainText('私権は、公共の福祉に適合しなければならない。');
	await expect(minpo.getByRole('link', { name: 'この条を開く' })).toHaveAttribute('href', `/hourei/${MINPO}/1`);
	// カードの「この条を開く」で条だけのページへ移る
	await minpo.getByRole('link', { name: 'この条を開く' }).click();
	await expect(author).toHaveURL(new RegExp(`/hourei/${MINPO}/1$`));

	// スクリプトが動かないときは、ふつうのリンクとして条だけのページへ移る
	const noJs = await browser.newContext({ javaScriptEnabled: false, baseURL: ORIGIN });
	contexts.push(noJs);
	const p = await noJs.newPage();
	await p.goto(`/kadai/${issueId}`);
	await p.getByRole('link', { name: '特商法9条' }).click();
	await expect(p).toHaveURL(new RegExp(`/hourei/${TOKUSHOHO}/9$`));
	await expect(p.getByRole('heading', { level: 1, name: /第9条/ })).toBeVisible();
});

test('基準4：本文に HTML やスクリプトを書いても、そのまま文字として出る', async ({ browser }, info) => {
	const w = info.project.name;
	const s = stamp();
	const author = await user(browser, `jr4-${w}-${s}`, ip(w, 4, 1));
	const html = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';
	const issueId = await postIssue(author, {
		title: `信頼の境界 ${w}-${s}`,
		example: `${html}特商法9条<b>太字</b>`
	});
	const solution = `<a href="javascript:window.__xss=3">特商法9条</a>の<i>斜体</i> ${s}`;
	const res = await solutionRequest(author, issueId, solution);
	expect(res.status(), await res.text()).toBe(303);

	for (const path of [`/kadai/${issueId}`, `/kadai/${issueId}/kaiketsu`]) {
		await author.goto(path);
		await hydrated(author);
		const main = author.getByRole('main');
		// 書いたとおりの文字が出て、要素にはならない
		if (path === `/kadai/${issueId}`) {
			await expect(main).toContainText(`${html}特商法9条<b>太字</b>`);
			// 本文の中の条はリンクになる（リンクの文字だけが要素になる）
			await expect(main.getByRole('link', { name: '特商法9条', exact: true }).first()).toHaveAttribute('href', `/hourei/${TOKUSHOHO}/9`);
		}
		await expect(main).toContainText(solution);
		await expect(main.locator('img[src="x"], b, i, script:not([type]), a[href^="javascript"]')).toHaveCount(0);
		expect(await author.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
	}
});
