// Issue #75 基準4と信頼の境界：廃案・否決の法案からの出し直しの画面。中身は src/lib/db/resubmit.test.ts
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { billRequest, billSupportRequest, createAmendBill, ifTarget, issueWithSolutions, newUser, postIssue, proposeRequest } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});
test.use({ actionTimeout: 15_000 });
// 投票する人を10人作るので重い
test.beforeEach(() => test.setTimeout(300_000));

const stamp = () => Date.now() % 1e8;
const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
/** 幅ごとに別の年を使う（2319年までは確認のテストが使っている） */
const monthOf = (w: string, group: number) => `${2330 + group * 3 + (w === 'sp' ? 0 : 1)}-05`;
const shift = (month: string, n: number) => month.replace(/-05$/, `-${String(5 + n).padStart(2, '0')}`);
const at = (month: string, day: number) => `${month}-${String(day).padStart(2, '0')}T09:00:00+09:00`;
/** IF_LAW の、このテストの可決する条（kakunin.spec.ts は 41 まで） */
const slot = (w: string) => 44 + (w === 'sp' ? 0 : 1);

type User = { page: Page; setNow: (now: string) => Promise<void> };
async function user(browser: Browser, address: string, now: string, name?: string): Promise<User> {
	const u = await newUser(browser, { name, ip: address, days: 8 });
	contexts.push(u.context);
	const setNow = (t: string) => u.context.setExtraHTTPHeaders({ 'x-test-ip': address, 'x-test-now': t });
	await setNow(now);
	return { page: u.page, setNow };
}

function setup(browser: Browser, w: string, group: number) {
	const month = monthOf(w, group);
	const label = `d${group}-${w}-${stamp()}`;
	let seq = 0;
	const person = (now: string) => {
		seq += 1;
		return user(browser, `10.${w === 'sp' ? 96 : 97}.${group}.${seq}`, now, `u${seq}-${label}`);
	};
	const anonymous = (now: string) => {
		seq += 1;
		return user(browser, `10.${w === 'sp' ? 96 : 97}.${group}.${seq}`, now);
	};
	async function support(path: string, now: string) {
		for (let i = 0; i < 3; i++) {
			const b = await person(now);
			const res = await billSupportRequest(b.page, path, { op: 'add', rev: '1' });
			expect(res.status(), await res.text()).toBe(200);
		}
	}
	async function bill(title: string, a: User, target?: Awaited<ReturnType<typeof ifTarget>>) {
		const { ids } = await issueWithSolutions(a.page, title, [`解決策 ${title}`]);
		const path = await createAmendBill(a.page, title, ids[0], target ? { 'body.0': `本文 ${title}` } : {}, target);
		await support(path, at(month, 5));
		const res = await proposeRequest(a.page, path);
		expect(res.status(), await res.text()).toBe(200);
		return path;
	}
	return { month, label, person, anonymous, bill, support };
}

const resubmit = (page: Page, path: string) => billRequest(page, `${path}?/resubmit`, {});

test('基準4：提出者にだけボタンが出て、押すと新しい下書きへ移り、元の法案のリンクが出る', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 1);
	const after = at(shift(s.month, 1), 2);
	const a = await s.person(at(s.month, 5));
	const title = `出し直しの法案 ${s.label}`;
	const path = await s.bill(title, a);
	const other = await s.person(after);
	const anonymous = await s.anonymous(after);

	// 審議中はボタンが出ず、送っても断る
	await a.page.goto(path);
	await expect(a.page.getByRole('button', { name: '出し直す' })).toHaveCount(0);
	expect((await resubmit(a.page, path)).status()).toBe(409);

	// 定足数に届かず廃案になった。提出者にだけボタンが出る
	await a.setNow(after);
	await a.page.goto(path);
	await expect(a.page.getByRole('button', { name: '出し直す' })).toBeVisible();
	await other.page.goto(path);
	await expect(other.page.getByRole('button', { name: '出し直す' })).toHaveCount(0);
	expect((await resubmit(other.page, path)).status()).toBe(403);
	const noLogin = await anonymous.page.request.post(`${path}?/resubmit`, { headers: { origin: 'http://localhost:4173', accept: 'text/html', 'content-type': 'application/x-www-form-urlencoded' }, data: '', maxRedirects: 0 });
	expect(noLogin.status()).toBe(303);
	expect(noLogin.headers().location).toContain('/login');

	// 結果のページのリンクは提出者にだけ
	const kekka = `/saiketsu/${path.replace('/houan/', '')}/kekka`;
	await other.page.goto(kekka);
	await expect(other.page.getByRole('link', { name: '法案のページで出し直す' })).toHaveCount(0);
	await a.page.goto(kekka);
	await a.page.getByRole('link', { name: '法案のページで出し直す' }).click();
	await expect(a.page).toHaveURL(new RegExp(`${path}$`));

	// 押すと新しい下書きへ移る。賛同は0で、元の法案のリンクが出る
	await hydrated(a.page);
	await a.page.getByRole('button', { name: '出し直す' }).click();
	await expect(a.page).not.toHaveURL(new RegExp(`${path}$`));
	const copy = new URL(a.page.url()).pathname;
	await expect(a.page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
	await expect(a.page.getByText('賛同 0人')).toBeVisible();
	const link = a.page.getByRole('main').getByRole('link', { name: title, exact: true });
	await expect(a.page.getByText('元の法案：')).toBeVisible();
	await expect(link).toHaveAttribute('href', path);
	await expect(a.page.getByText('共同起草')).toHaveCount(0);

	// もう一度開くと、作らずリンクになる。送っても同じ下書きへ移る
	await a.page.goto(path);
	await expect(a.page.getByRole('button', { name: '出し直す' })).toHaveCount(0);
	await expect(a.page.getByRole('link', { name: '出し直した法案を開く' })).toHaveAttribute('href', copy);
	await other.page.goto(path);
	await expect(other.page.getByRole('link', { name: '出し直した法案を開く' })).toHaveCount(0);
	const again = await resubmit(a.page, path);
	expect(again.status()).toBe(303);
	expect(again.headers().location).toBe(copy);

	// 発議のあとも元の法案のリンクは残る
	await s.support(copy, after);
	const proposed = await proposeRequest(a.page, copy);
	expect(proposed.status(), await proposed.text()).toBe(200);
	await a.page.goto(copy);
	await expect(a.page.getByText('元の法案：')).toBeVisible();
	await a.page.goto(path);
	await expect(a.page.getByRole('link', { name: '出し直した法案を開く' })).toHaveAttribute('href', copy);

	// 可決の法案は出し直せない（上の法案の会期は結果が確定しているので、別の年の会期で確かめる）
	const y = setup(browser, w, 3);
	const p = await y.person(at(y.month, 5));
	const passed = await y.bill(`可決の法案 ${y.label}`, p, await ifTarget(p.page, slot(w)));
	const id = passed.replace('/houan/', '');
	for (let i = 0; i < 10; i++) {
		const v = await y.person(at(shift(y.month, -1), 10));
		await postIssue(v.page, { title: `前の月の課題 ${y.label} ${i}` });
		await v.setNow(at(y.month, 22));
		const res = await billRequest(v.page, `/saiketsu/${id}?/vote`, { choice: 'yes', 'cf-turnstile-response': 'test-pass' });
		expect(res.status(), await res.text()).toBe(200);
	}
	await p.setNow(at(shift(y.month, 1), 2));
	await p.page.goto(`/saiketsu/${id}/kekka`);
	await expect(p.page.getByRole('main').getByText('可決', { exact: true })).toBeVisible();
	await p.page.goto(passed);
	await expect(p.page.getByRole('button', { name: '出し直す' })).toHaveCount(0);
	expect((await resubmit(p.page, passed)).status()).toBe(409);
	await p.page.goto(`/saiketsu/${id}/kekka`);
	await expect(p.page.getByRole('link', { name: '法案のページで出し直す' })).toHaveCount(0);

	const overflow = await a.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
	expect(overflow).toBeLessThanOrEqual(0);
});

test('信頼の境界：出し直しの法案の番号の形が違えば 404', async ({ browser }, info) => {
	const s = setup(browser, info.project.name, 2);
	const a = await s.person(at(s.month, 5));
	for (const bad of ['abc', '0', '-1', '1e3', '999999999'])
		expect((await resubmit(a.page, `/houan/${bad}`)).status(), bad).toBe(404);
});
