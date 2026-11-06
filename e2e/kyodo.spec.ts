// Issue #76 基準6・10と信頼の境界：共同提出者、撤回、統合案の画面。中身は src/lib/db/cosponsors.test.ts
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { billRequest, billSupportRequest, createAmendBill, issueWithSolutions, newUser, proposeRequest } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});
test.use({ actionTimeout: 15_000 });
test.beforeEach(() => test.setTimeout(240_000));

const stamp = () => Date.now() % 1e8;
const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
/** 幅ごとに別の年を使う（2345年までは出し直しのテストが使っている） */
const monthOf = (w: string, group: number) => `${2360 + group * 3 + (w === 'sp' ? 0 : 1)}-05`;
const shift = (month: string, n: number) => month.replace(/-05$/, `-${String(5 + n).padStart(2, '0')}`);
const at = (month: string, day: number) => `${month}-${String(day).padStart(2, '0')}T09:00:00+09:00`;

type User = { page: Page; name: string; setNow: (now: string) => Promise<void> };
async function user(browser: Browser, address: string, now: string, name: string, days = 8): Promise<User> {
	const u = await newUser(browser, { name, ip: address, days });
	contexts.push(u.context);
	const setNow = (t: string) => u.context.setExtraHTTPHeaders({ 'x-test-ip': address, 'x-test-now': t });
	await setNow(now);
	return { page: u.page, name, setNow };
}

function setup(browser: Browser, w: string, group: number) {
	const month = monthOf(w, group);
	const label = `y${group}${w}${stamp()}`;
	let seq = 0;
	const person = (now: string, days = 8) => {
		seq += 1;
		return user(browser, `10.${w === 'sp' ? 98 : 99}.${group}.${seq}`, now, `u${seq}-${label}`, days);
	};
	async function draft(a: User, title: string) {
		const { ids } = await issueWithSolutions(a.page, title, [`解決策 ${title}`]);
		return createAmendBill(a.page, title, ids[0]);
	}
	async function support(path: string, now: string, rev = '1') {
		for (let i = 0; i < 3; i++) {
			const b = await person(now);
			const res = await billSupportRequest(b.page, path, { op: 'add', rev });
			expect(res.status(), await res.text()).toBe(200);
		}
	}
	return { month, label, person, draft, support };
}

const cosponsor = (page: Page, path: string, form: Record<string, string>) => billRequest(page, `${path}?/cosponsor`, form);
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

test('基準6：共同提出者の申し出と承認、名前、編集、権限', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 1);
	const now = at(s.month, 5);
	const a = await s.person(now);
	const title = `共同の法案 ${s.label}`;
	const path = await s.draft(a, title);
	const b = await s.person(now);
	const other = await s.person(now);

	// 申し出る：提出者には押すボタンがなく、ほかの人には説明つきで出る
	await a.page.goto(path);
	await expect(button(a.page, '共同提出者になりたいと申し出る')).toHaveCount(0);
	await b.page.goto(path);
	await hydrated(b.page);
	await expect(b.page.getByText('承認されると賛同は外れます', { exact: false })).toBeVisible();
	await button(b.page, '共同提出者になりたいと申し出る').click();
	await expect(button(b.page, '申し出を取り下げる')).toBeVisible();

	// 申し出の名前は提出者にだけ出る
	await other.page.goto(path);
	await expect(other.page.getByText(b.name)).toHaveCount(0);
	await a.page.goto(path);
	await hydrated(a.page);
	await expect(a.page.getByText(b.name)).toBeVisible();
	// ほかの人が承認を送ると 403
	const form = await a.page.locator('form[action="?/cosponsor"] input[name="id"]').first().getAttribute('value');
	expect((await cosponsor(other.page, path, { op: 'accept', id: form as string })).status()).toBe(403);

	// 承認すると名前が出る
	await button(a.page, '承認する').click();
	await expect(a.page.getByText(`共同提出者 ${b.name}`)).toBeVisible();
	await other.page.goto(path);
	await expect(other.page.getByText(`共同提出者 ${b.name}`)).toBeVisible();

	// 共同提出者は編集でき、賛同のボタンは出ない
	await b.page.goto(path);
	await expect(b.page.getByRole('link', { name: '編集する' })).toBeVisible();
	await expect(button(b.page, '賛同する')).toHaveCount(0);
	await expect(button(b.page, '共同提出者から抜ける')).toBeVisible();
	await b.page.getByRole('link', { name: '編集する' }).click();
	await hydrated(b.page);
	await b.page.getByLabel('題名').fill(`${title} 直した`);
	await b.page.getByRole('button', { name: '下書きを保存する' }).click();
	await expect(b.page.getByRole('heading', { level: 1, name: `${title} 直した` })).toBeVisible();

	// 抜けた人にはボタンが出ない。断られた人にも出ない
	const leaver = await s.person(now);
	await cosponsor(leaver.page, path, { op: 'request' });
	await a.page.goto(path);
	await hydrated(a.page);
	await a.page.getByRole('listitem').filter({ hasText: leaver.name }).getByRole('button', { name: '承認する' }).click();
	await expect(a.page.getByText(leaver.name)).toBeVisible();
	await leaver.page.goto(path);
	await hydrated(leaver.page);
	await leaver.page.getByLabel('抜けると元に戻せません').check();
	await button(leaver.page, '共同提出者から抜ける').click();
	await expect(leaver.page.getByText('共同提出者から抜けた法案です')).toBeVisible();
	await expect(button(leaver.page, '共同提出者になりたいと申し出る')).toHaveCount(0);
	await expect(button(leaver.page, '賛同する')).toHaveCount(0);
	const refused = await s.person(now);
	await cosponsor(refused.page, path, { op: 'request' });
	await a.page.goto(path);
	await hydrated(a.page);
	await a.page.getByRole('listitem').filter({ hasText: refused.name }).getByRole('button', { name: '断る' }).click();
	await refused.page.goto(path);
	await expect(refused.page.getByText('申し出は断られました')).toBeVisible();
	await expect(button(refused.page, '共同提出者になりたいと申し出る')).toHaveCount(0);

	// 登録から7日たっていない人は申し出できない。ログインなしはログインへ
	const fresh = await s.person(now, 0);
	await fresh.page.goto(path);
	await expect(button(fresh.page, '共同提出者になりたいと申し出る')).toHaveCount(0);
	expect((await cosponsor(fresh.page, path, { op: 'request' })).status()).toBe(403);
	const anonymous = await browser.newContext({ baseURL: 'http://localhost:4173', extraHTTPHeaders: { 'x-test-now': now, 'x-test-ip': `10.${w === 'sp' ? 98 : 99}.1.200` } });
	contexts.push(anonymous);
	const noLogin = await anonymous.request.post(`${path}?/cosponsor`, { headers: { origin: 'http://localhost:4173', accept: 'text/html', 'content-type': 'application/x-www-form-urlencoded' }, data: 'op=request', maxRedirects: 0 });
	expect(noLogin.status()).toBe(303);
	expect(noLogin.headers().location).toContain('/login');

	// 発議のあとは名前が残り、ボタンは消え、送ると 409
	await s.support(path, now, '2');
	const proposed = await proposeRequest(a.page, path);
	expect(proposed.status(), await proposed.text()).toBe(200);
	await b.page.goto(path);
	await expect(b.page.getByText(`共同提出者 ${b.name}`)).toBeVisible();
	await expect(button(b.page, '共同提出者から抜ける')).toHaveCount(0);
	await expect(b.page.getByRole('link', { name: '編集する' })).toHaveCount(0);
	expect((await cosponsor(b.page, path, { op: 'leave', confirm: 'on' })).status()).toBe(409);
	expect((await cosponsor(other.page, path, { op: 'request' })).status()).toBe(409);

	const overflow = await a.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
	expect(overflow).toBeLessThanOrEqual(0);
});

test('基準10：撤回と統合案の画面', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 2);
	const now = at(s.month, 5);

	// 撤回：提出者と共同提出者にだけボタンが出て、同意の人数が出る
	const a = await s.person(now);
	const title = `撤回の法案 ${s.label}`;
	const path = await s.draft(a, title);
	const co = await s.person(now);
	await cosponsor(co.page, path, { op: 'request' });
	await a.page.goto(path);
	await hydrated(a.page);
	await button(a.page, '承認する').click();
	await expect(a.page.getByText(`共同提出者 ${co.name}`)).toBeVisible();
	await s.support(path, now);
	const proposed = await proposeRequest(a.page, path);
	expect(proposed.status(), await proposed.text()).toBe(200);

	const other = await s.person(now);
	await other.page.goto(path);
	await expect(button(other.page, '撤回に同意する')).toHaveCount(0);
	await a.page.goto(path);
	await hydrated(a.page);
	await a.page.getByLabel('撤回は元に戻せません').check();
	await button(a.page, '撤回に同意する').click();
	await expect(a.page.getByText('2人中1人が同意')).toBeVisible();
	await expect(button(a.page, '同意を取り消す')).toBeVisible();
	await co.page.goto(path);
	await hydrated(co.page);
	await co.page.getByLabel('撤回は元に戻せません').check();
	await button(co.page, '撤回に同意する').click();
	await expect(co.page.getByText('撤回されました')).toBeVisible();
	await other.page.goto(path);
	await expect(other.page.getByText('撤回されました')).toBeVisible();
	await expect(other.page.getByText('いま：撤回').or(other.page.getByText('撤回（いまここ）')).first()).toBeVisible();
	// 結果のページに撤回と出る
	await other.page.goto(`/saiketsu/${path.replace('/houan/', '')}/kekka`);
	await expect(other.page.getByText('この法案は撤回されました')).toBeVisible();

	// 統合案：相手の番号で作る
	const x = await s.person(now);
	const y = await s.person(now);
	const xTitle = `統合の元X ${s.label}`;
	const yTitle = `統合の元Y ${s.label}`;
	const xPath = await s.draft(x, xTitle);
	const yPath = await s.draft(y, yTitle);
	await x.page.goto(xPath);
	await hydrated(x.page);
	await x.page.getByLabel('相手の法案の番号').fill(yPath.replace('/houan/', ''));
	await button(x.page, '統合案を作る').click();
	await expect(x.page).not.toHaveURL(new RegExp(`${xPath}$`));
	const mPath = new URL(x.page.url()).pathname;
	await expect(x.page.getByRole('main').getByRole('link', { name: xTitle, exact: true })).toHaveAttribute('href', xPath);
	await expect(x.page.getByRole('main').getByRole('link', { name: yTitle, exact: true })).toHaveAttribute('href', yPath);
	await expect(x.page.getByText('同意待ち').first()).toBeVisible();
	await expect(button(x.page, '統合案をやめる')).toBeVisible();
	// 発議の前のリンクは関係者にだけ
	await y.page.goto(yPath);
	await expect(y.page.getByRole('link', { name: xTitle, exact: true })).toBeVisible();
	await other.page.goto(yPath);
	await expect(other.page.getByRole('link', { name: xTitle, exact: true })).toHaveCount(0);

	// 同意は統合案のページで、関係者にだけ出る
	await other.page.goto(mPath);
	await expect(button(other.page, '統合案に同意する')).toHaveCount(0);
	for (const u of [x, y]) {
		await u.page.goto(mPath);
		await hydrated(u.page);
		await u.page.getByLabel('発議されると、元の法案は撤回になります').check();
		await button(u.page, '統合案に同意する').click();
		await expect(button(u.page, '同意を取り消す')).toBeVisible();
	}
	await expect(y.page.getByText(`共同提出者 ${y.name}`)).toBeVisible();

	// 発議すると、元の法案に統合案へのリンクが出る
	await s.support(mPath, now);
	const done = await proposeRequest(x.page, mPath);
	expect(done.status(), await done.text()).toBe(200);
	await other.page.goto(xPath);
	await expect(other.page.getByText('統合案に統合されました')).toBeVisible();
	await expect(other.page.getByRole('main').getByRole('link', { name: xTitle, exact: true })).toHaveAttribute('href', mPath);
	await other.page.goto(yPath);
	await expect(other.page.getByText('統合案に統合されました')).toBeVisible();
	await other.page.goto(mPath);
	await expect(other.page.getByText('同意待ち')).toHaveCount(0);
	await expect(other.page.getByRole('main').getByRole('link', { name: yTitle, exact: true })).toHaveAttribute('href', yPath);

	// 採決が始まると、撤回のボタンは出ず、送ると断る
	await x.setNow(at(shift(s.month, 0), 22));
	await x.page.goto(mPath);
	await expect(button(x.page, '撤回に同意する')).toHaveCount(0);
	expect((await billRequest(x.page, `${mPath}?/withdraw`, { op: 'consent', confirm: 'on' })).status()).toBe(409);

	const overflow = await x.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
	expect(overflow).toBeLessThanOrEqual(0);
});

test('信頼の境界：共同提出者、撤回、統合案、発議の入力の形', async ({ browser }, info) => {
	const s = setup(browser, info.project.name, 3);
	const now = at(s.month, 5);
	const a = await s.person(now);
	const path = await s.draft(a, `境界の法案 ${s.label}`);
	const post = (action: string, form: Record<string, string>) => billRequest(a.page, `${path}?/${action}`, form);

	for (const form of [{}, { op: 'nope' }, { op: 'accept' }, { op: 'accept', id: 'abc' }, { op: 'decline', id: '-1' }, { op: 'remove', id: '1e3' }, { op: 'remove', id: '1' }, { op: 'leave' }]) {
		expect((await post('cosponsor', form as Record<string, string>)).status(), JSON.stringify(form)).toBe(400);
	}
	for (const form of [{}, { op: 'nope' }, { op: 'consent' }]) expect((await post('withdraw', form as Record<string, string>)).status(), JSON.stringify(form)).toBe(400);
	for (const form of [{}, { op: 'nope' }, { op: 'create' }, { op: 'create', with: 'abc' }, { op: 'consent' }, { op: 'consent', rev: '1' }, { op: 'consent', rev: 'x', confirm: 'on' }]) {
		expect((await post('merge', form as Record<string, string>)).status(), JSON.stringify(form)).toBe(400);
	}
	for (const form of [{}, { rev: 'abc' }, { rev: '0' }]) expect((await post('propose', form as Record<string, string>)).status(), JSON.stringify(form)).toBe(400);
	for (const bad of ['abc', '0', '-1', '1e3', '999999999']) {
		for (const action of ['cosponsor', 'withdraw', 'merge']) expect((await billRequest(a.page, `/houan/${bad}?/${action}`, { op: 'consent' })).status(), `${action} ${bad}`).toBe(404);
	}
});
