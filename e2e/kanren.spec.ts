// Issue #69 関連法案と併合審査。関連の決まりと20件ごとの読み方は src/lib/db/relations.test.ts
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { billRequest, billSupportRequest, createAmendBill, issueWithSolutions, newUser, proposeRequest } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});
test.use({ actionTimeout: 15_000 });

const stamp = () => Date.now() % 1e8;
const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
/** 基準ごと・幅ごとに別の年を使う（2105年までは質疑・評価・修正案のテストが使っている） */
const monthOf = (w: string, group: number) => `${2110 + group * 2 + (w === 'sp' ? 0 : 1)}-05`;
const at = (month: string, day: number) => `${month}-${String(day).padStart(2, '0')}T09:00:00+09:00`;

type User = { page: Page; setNow: (now: string) => Promise<void> };
let nextIp = 1;
async function user(browser: Browser, now: string, name: string, days = 8): Promise<User> {
	const ipAddress = `10.68.${Math.floor(nextIp / 200)}.${(nextIp++ % 200) + 1}`;
	const u = await newUser(browser, { name, ip: ipAddress, days });
	contexts.push(u.context);
	const setNow = (t: string) => u.context.setExtraHTTPHeaders({ 'x-test-ip': ipAddress, 'x-test-now': t });
	await setNow(now);
	return { page: u.page, setNow };
}

/** 第1条を変える法案を発議する */
async function proposed(browser: Browser, now: string, title: string) {
	const label = `${title}-${stamp()}`;
	const a = await user(browser, now, `a-${label}`);
	const { ids } = await issueWithSolutions(a.page, label, [`関連の解決策 ${label}`]);
	const bill = await createAmendBill(a.page, title, ids[0]);
	for (const n of [2, 3, 4]) {
		const u = await user(browser, now, `u${n}-${label}`);
		const res = await billSupportRequest(u.page, bill, { op: 'add', rev: '1' });
		expect(res.status(), await res.text()).toBe(200);
	}
	const res = await proposeRequest(a.page, bill);
	expect(res.status(), await res.text()).toBe(200);
	return { a, bill };
}

const qa = (bill: string) => `${bill}/shitsugi`;
const card = (page: Page, text: string) => page.locator('article').filter({ hasText: text });
const relatedList = (page: Page) => page.getByRole('region', { name: '関連法案' });
const filter = (page: Page) => page.getByRole('navigation', { name: '質疑の絞り込み' }).getByRole('link', { name: '関連法案も' });
async function writeQuestion(u: User, bill: string, text: string) {
	const res = await billRequest(u.page, `${qa(bill)}/kaku`, { body: text, 'cf-turnstile-response': 'test-pass' });
	expect(res.status(), await res.text()).toBe(303);
	await u.page.goto(qa(bill));
	return ((await card(u.page, text).getAttribute('id')) as string).replace('shitsugi-', '');
}

test('基準2：同じ条に触れる法案が互いの概要に題名とリンクで出る。ログインなしで読める。関連法案がなければ欄が出ない', async ({ browser, page }, info) => {
	const w = info.project.name;
	const month = monthOf(w, 1);
	const s = stamp();
	const titleA = `関連A ${s}`;
	const titleB = `関連B ${s}`;
	const a = await proposed(browser, at(month, 5), titleA);
	const b = await proposed(browser, at(month, 6), titleB);
	// 締切のあとの発議は次の会期へ付託されるので、関連にならない
	const later = await proposed(browser, at(month, 20), `別の会期 ${s}`);

	await page.context().setExtraHTTPHeaders({ 'x-test-ip': '10.68.250.1', 'x-test-now': at(month, 7) });
	await page.goto(a.bill);
	await expect(relatedList(page).getByRole('link', { name: titleB })).toBeVisible();
	await page.goto(later.bill);
	await expect(relatedList(page)).toHaveCount(0);
	await page.goto(b.bill);
	await relatedList(page).getByRole('link', { name: titleA }).click();
	await expect(page).toHaveURL(new RegExp(`${a.bill}$`));
});

test('基準3：絞り込み「関連法案も」で両方の質疑が読める。関連法案の質疑は題名とリンクが付き、書くボタンも評価のボタンも読んだ記録もない', async ({ browser }, info) => {
	const w = info.project.name;
	const month = monthOf(w, 2);
	const s = stamp();
	const titleB = `一緒に読むB ${s}`;
	const a = await proposed(browser, at(month, 5), `一緒に読むA ${s}`);
	const b = await proposed(browser, at(month, 6), titleB);
	const later = await proposed(browser, at(month, 20), `関連のない法案 ${s}`);
	const now = at(month, 15);
	const q = await user(browser, now, `q-${s}`);
	const v = await user(browser, now, `v-${s}`);
	const own = `この法案の質疑 ${s}`;
	const other = `関連法案の質疑 ${s}`;
	await writeQuestion(q, a.bill, own);
	const otherId = await writeQuestion(q, b.bill, other);

	// いつもの一覧には、この法案の質疑だけ
	await v.page.goto(qa(a.bill));
	await expect(card(v.page, own)).toBeVisible();
	await expect(card(v.page, other)).toHaveCount(0);

	const reads: string[] = [];
	v.page.on('request', (r) => {
		if (r.method() === 'POST' && r.url().includes('?/read')) reads.push(...new URLSearchParams(r.postData() ?? '').getAll('post'));
	});
	await filter(v.page).click();
	await expect(v.page).toHaveURL(new RegExp(`${qa(a.bill)}\\?kanren=1$`));
	await hydrated(v.page);
	await expect(filter(v.page)).toHaveAttribute('aria-current', 'page');
	await expect(card(v.page, own)).toBeVisible();
	const foreign = card(v.page, other);
	await expect(foreign).toBeVisible();
	// この法案の質疑には押せるボタンがあり、関連法案の質疑にはない
	await expect(card(v.page, own).getByRole('button', { name: '筋が通っている' })).toBeVisible();
	await expect(foreign.getByRole('button')).toHaveCount(0);
	// 法案の題名のリンクから、その法案の質疑へ移って書ける
	const link = foreign.getByRole('link', { name: new RegExp(titleB) });
	await expect(link).toHaveAttribute('href', `${qa(b.bill)}#shitsugi-${otherId}`);
	// 読んだ記録は送らない（この法案の質疑は送る）
	await expect.poll(() => reads.length, { timeout: 6000 }).toBeGreaterThan(0);
	expect(reads).not.toContain(otherId);

	// 関連法案のない法案には絞り込みが出ない
	await v.page.goto(qa(later.bill));
	await expect(filter(v.page)).toHaveCount(0);
	await link.page().goto(qa(a.bill));
	await filter(v.page).click();
	await v.page.getByRole('link', { name: new RegExp(titleB) }).click();
	await expect(v.page).toHaveURL(new RegExp(`${qa(b.bill)}#shitsugi-${otherId}$`));
	await expect(card(v.page, other).getByRole('button', { name: '補足する' })).toBeVisible();
});

test('信頼の境界：?kanren= は 1 のほかは 404。関連法案がない法案、?mati=1 との併用、質疑のないページも 404', async ({ browser, page }, info) => {
	const w = info.project.name;
	const month = monthOf(w, 3);
	const s = stamp();
	const a = await proposed(browser, at(month, 5), `境界A ${s}`);
	await proposed(browser, at(month, 6), `境界B ${s}`);
	const later = await proposed(browser, at(month, 20), `境界C ${s}`);
	await page.context().setExtraHTTPHeaders({ 'x-test-ip': '10.68.250.2', 'x-test-now': at(month, 7) });
	const status = async (path: string) => (await page.request.get(path)).status();
	expect(await status(`${qa(a.bill)}?kanren=1`)).toBe(200);
	expect(await status(`${qa(a.bill)}?kanren=2`)).toBe(404);
	expect(await status(`${qa(a.bill)}?kanren=`)).toBe(404);
	expect(await status(`${qa(a.bill)}?kanren=1&mati=1`)).toBe(404);
	expect(await status(`${qa(a.bill)}?kanren=1&page=2`)).toBe(404);
	expect(await status(`${qa(later.bill)}?kanren=1`)).toBe(404);
});
