// Issue #49 賛同と発議（設計書 docs/spec/49.md）。人数と会期の組み合わせは src/lib/db/bill-supports.test.ts
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { billRequest, billSupportRequest, createAmendBill, issueWithSolutions, newUser, proposeRequest } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});

type Width = 'sp' | 'pc';
const ip = (project: string, group: number, n: number) => `10.${project === 'sp' ? 46 : 47}.${group}.${n}`;
const stamp = () => Date.now() % 1e8;
const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });

async function user(browser: Browser, name: string, ipAddress: string, opts: { days?: number; country?: string } = {}): Promise<Page> {
	const u = await newUser(browser, { name, ip: ipAddress, days: opts.days ?? 8, country: opts.country });
	contexts.push(u.context);
	return u.page;
}

/** 提出者 a と、a の下書きを作る */
async function draftBy(browser: Browser, name: string, ipAddress: string, label: string) {
	const a = await user(browser, name, ipAddress);
	const { ids } = await issueWithSolutions(a, label, [`賛同の解決策 ${label}`]);
	const title = `賛同を集める法案 ${label}`;
	return { a, title, bill: await createAmendBill(a, title, ids[0]), solution: ids[0] };
}

const press = async (u: Page, bill: string, name: string) => {
	await u.goto(bill);
	await hydrated(u);
	await u.getByRole('button', { name, exact: true }).click();
};
const support = async (u: Page, bill: string) => {
	await press(u, bill, '賛同する');
	await expect(u.getByRole('button', { name: '賛同を取り消す' })).toBeVisible();
};

test('基準1：ほかの人は賛同して取り消せる。ログインしていなければログインへ。名前は出さない', async ({ browser, page }, info) => {
	const p = info.project.name;
	const s = stamp();
	const { bill } = await draftBy(browser, `s1-a-${p}-${s}`, ip(p, 1, 1), `s1-${p}-${s}`);
	const name = `s1-b-${p}-${s}`;
	const b = await user(browser, name, ip(p, 1, 2));

	await b.goto(bill);
	await expect(b.getByText('賛同 0人')).toBeVisible();
	await support(b, bill);
	await expect(b.getByText('賛同 1人')).toBeVisible();
	await expect(b.getByText(name)).toHaveCount(0);
	await b.getByRole('button', { name: '賛同を取り消す' }).click();
	await expect(b.getByText('賛同 0人')).toBeVisible();
	await expect(b.getByRole('button', { name: '賛同する', exact: true })).toBeVisible();

	await page.goto(bill);
	await page.getByRole('button', { name: '賛同する', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Googleでログイン' }).or(page.getByRole('link', { name: 'Googleでログイン' }))).toBeVisible();
});

test('基準2：登録から7日たっていなければ、いつから賛同できるかを出し、送っても賛同にも発議にもならない', async ({ browser }, info) => {
	const p = info.project.name;
	const s = stamp();
	const { bill } = await draftBy(browser, `s2-a-${p}-${s}`, ip(p, 2, 1), `s2-${p}-${s}`);
	const fresh = await user(browser, `s2-new-${p}-${s}`, ip(p, 2, 2), { days: 6 });

	await fresh.goto(bill);
	await expect(fresh.getByText(/登録から7日たつと、賛同と発議ができます。\d+月\d+日 \d+時\d{2}分からできます。/)).toBeVisible();
	await expect(fresh.getByRole('button', { name: '賛同する', exact: true })).toHaveCount(0);
	expect((await billSupportRequest(fresh, bill, { op: 'add', rev: '1' })).status()).toBe(403);
	expect((await proposeRequest(fresh, bill)).status()).toBe(403);
	await fresh.goto(bill);
	await expect(fresh.getByText('賛同 0人')).toBeVisible();
});

test('基準3：提出者には賛同のボタンが出ず、送っても数えない。「発議する」は届くまで押せず、あと何人かを出す', async ({ browser }, info) => {
	const p = info.project.name;
	const s = stamp();
	const { a, bill } = await draftBy(browser, `s3-a-${p}-${s}`, ip(p, 3, 1), `s3-${p}-${s}`);

	await a.goto(bill);
	await expect(a.getByRole('button', { name: '賛同する', exact: true })).toHaveCount(0);
	await expect(a.getByRole('button', { name: '発議する' })).toBeDisabled();
	await expect(a.getByText('発議にはあと3人')).toBeVisible();
	expect((await billSupportRequest(a, bill, { op: 'add', rev: '1' })).status()).toBe(403);
	expect((await proposeRequest(a, bill)).status()).toBe(409);
	await a.goto(bill);
	await expect(a.getByText('賛同 0人')).toBeVisible();
	await expect(a.getByText('発議にはあと3人')).toBeVisible();

	// ほかの人には「発議する」が出ず、送っても発議にならない
	const b = await user(browser, `s3-b-${p}-${s}`, ip(p, 3, 2));
	await b.goto(bill);
	await expect(b.getByRole('button', { name: '発議する' })).toHaveCount(0);
	expect((await proposeRequest(b, bill)).status()).toBe(403);
});

test('基準4：賛同が届くと発議でき、状態・編集・賛同のボタン・一覧のタブが変わる。発議のあとは賛同も取り消しも保存も断る', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const s = stamp();
	const { a, bill, title, solution } = await draftBy(browser, `s4-a-${w}-${s}`, ip(w, 4, 1), `s4-${w}-${s}`);
	const [b, c, d] = await Promise.all([2, 3, 4].map((n) => user(browser, `s4-${n}-${w}-${s}`, ip(w, 4, n))));
	for (const u of [b, c]) await support(u, bill);
	await a.goto(bill);
	await expect(a.getByText('発議にはあと1人')).toBeVisible();
	await expect(a.getByRole('button', { name: '発議する' })).toBeDisabled();
	await support(d, bill);

	await press(a, bill, '発議する');
	await expect(w === 'sp' ? a.getByText(/^いま：\s*発議$/) : a.getByText(/^発議\s*（いまここ）$/)).toBeVisible();
	await expect(a.getByRole('link', { name: '編集する' })).toHaveCount(0);
	await expect(a.getByRole('button', { name: '発議する' })).toHaveCount(0);
	await expect(a.getByText('賛同 3人')).toBeVisible();

	const late = await user(browser, `s4-late-${w}-${s}`, ip(w, 4, 5));
	await late.goto(bill);
	await expect(late.getByText('賛同 3人')).toBeVisible();
	await expect(late.getByRole('button', { name: '賛同する', exact: true })).toHaveCount(0);
	await d.goto(bill);
	await expect(d.getByRole('button', { name: '賛同を取り消す' })).toHaveCount(0);

	expect((await billSupportRequest(late, bill, { op: 'add', rev: '1' })).status()).toBe(409);
	expect((await billSupportRequest(d, bill, { op: 'remove', rev: '1' })).status()).toBe(409);
	expect((await proposeRequest(a, bill)).status()).toBe(409);
	expect((await billRequest(a, `${bill}/kaku`, { kind: 'amend', title: '発議のあと', solution, rev: '1', 'cf-turnstile-response': 'test-pass' })).status()).toBe(403);
	await late.goto(bill);
	await expect(late.getByText('賛同 3人')).toBeVisible();

	await a.goto('/houan');
	await expect(a.getByRole('link', { name: title, exact: true })).toBeVisible();
	await a.goto('/houan?tab=shitagaki');
	await expect(a.getByRole('link', { name: title, exact: true })).toHaveCount(0);
});

test('基準6：保存すると賛同は0人に戻る。直す画面で先に知らせ、開いたあとで直された法案への賛同は断る', async ({ browser }, info) => {
	const p = info.project.name;
	const s = stamp();
	const { a, bill, title } = await draftBy(browser, `s6-a-${p}-${s}`, ip(p, 6, 1), `s6-${p}-${s}`);
	const [b, c] = await Promise.all([2, 3].map((n) => user(browser, `s6-${n}-${p}-${s}`, ip(p, 6, n))));
	await support(b, bill);

	// 賛同がないときは知らせない。いまは1人なので知らせる
	await a.goto(`${bill}/kaku`);
	await hydrated(a);
	await expect(a.getByText('保存すると、いまの賛同 1人は数えなくなります。集め直しになります。')).toBeVisible();

	// c は直される前の版を開いている
	await c.goto(bill);
	await hydrated(c);
	await a.getByLabel('題名').fill(`${title} 直した`);
	await a.getByRole('button', { name: '下書きを保存する' }).click();
	await expect(a.getByRole('heading', { level: 1, name: `${title} 直した` })).toBeVisible();
	await expect(a.getByText('賛同 0人')).toBeVisible();

	await c.getByRole('button', { name: '賛同する', exact: true }).click();
	await expect(c.getByRole('alert')).toContainText('この法案は直されました。読み直してから賛同してください。');
	await c.goto(bill);
	await expect(c.getByText('賛同 0人')).toBeVisible();

	// 賛同していた人も、直された法案に賛同し直せる
	await support(b, bill);
	await expect(b.getByText('賛同 1人')).toBeVisible();
	await a.goto(`${bill}/kaku`);
	await hydrated(a);
	await expect(a.getByText('保存すると、いまの賛同 1人は数えなくなります。集め直しになります。')).toBeVisible();

	const none = await draftBy(browser, `s6-none-${p}-${s}`, ip(p, 6, 4), `s6n-${p}-${s}`);
	await none.a.goto(`${none.bill}/kaku`);
	await hydrated(none.a);
	await expect(none.a.getByText('保存すると、いまの賛同')).toHaveCount(0);
});

test('基準8：日本からだけ、締め出しのあいだはできない。24時間に30回・5分に10回・同じ法案に同じ回線から3アカウントまで', async ({ browser }, info) => {
	test.setTimeout(180_000);
	const p = info.project.name;
	const s = stamp();
	const { bill } = await draftBy(browser, `s8-a-${p}-${s}`, ip(p, 8, 1), `s8-${p}-${s}`);

	const us = await user(browser, `s8-us-${p}-${s}`, ip(p, 8, 2), { country: 'US' });
	const outside = await billSupportRequest(us, bill, { op: 'add', rev: '1' });
	expect(outside.status()).toBe(403);
	expect(await outside.text()).toContain('日本国内からのみ参加できます');
	expect((await proposeRequest(us, bill)).status()).toBe(403);

	// 同じ法案に同じ回線から3アカウントまで。回線の上限は違反に数えない
	for (let n = 1; n <= 4; n++) {
		const u = await user(browser, `s8-ip${n}-${p}-${s}`, ip(p, 8, 3));
		const res = await billSupportRequest(u, bill, { op: 'add', rev: '1' });
		if (n < 4) expect(res.status(), String(n)).toBeLessThan(400);
		else {
			expect(res.status()).toBe(429);
			expect(await res.text()).toContain('この回線からは、この法案にこれ以上賛同できません');
		}
	}

	// 5分に10回、24時間に30回（付けるのも取り消すのも1回）。ほかのテストと混ざらない時刻で数える
	const heavy = `s8-heavy-${p}-${s}`;
	const h = await user(browser, heavy, ip(p, 8, 4));
	const at = (minute: number) =>
		h.context().setExtraHTTPHeaders({ 'x-test-ip': ip(p, 8, 4), 'x-test-now': `${p === 'sp' ? '2033-03-10' : '2033-04-10'}T09:${String(minute).padStart(2, '0')}:00+09:00` });
	let supported = false;
	const toggle = async () => {
		const res = await billSupportRequest(h, bill, { op: supported ? 'remove' : 'add', rev: '1' });
		if (res.status() < 400) supported = !supported;
		return res;
	};
	await at(0);
	for (let i = 0; i < 10; i++) expect((await toggle()).status(), `burst ${i}`).toBeLessThan(400);
	const burst = await toggle();
	expect(burst.status()).toBe(429);
	expect(await burst.text()).toContain('短いあいだに賛同を何度も押しました');
	for (const minute of [6, 12]) {
		await at(minute);
		for (let i = 0; i < 10; i++) expect((await toggle()).status(), `${minute} ${i}`).toBeLessThan(400);
	}
	await at(18);
	const day = await toggle();
	expect(day.status()).toBe(429);
	expect(await day.text()).toContain('賛同は24時間に30回まで押せます');

	// 3回目の違反で締め出す
	expect((await toggle()).status()).toBe(429);
	const banned = await toggle();
	expect(banned.status()).toBe(429);
	expect(await banned.text()).toContain('制限を何度も超えたため');
	expect((await proposeRequest(h, bill)).status()).toBe(429);
});

test('基準9：一覧に賛同の数を出す。スマホは段階の行、PC は「賛同」の列', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const s = stamp();
	const a = await user(browser, `s9-a-${w}-${s}`, ip(w, 9, 1));
	// ほかのテストの下書きより新しい時刻で書く（1ページ目に出るように）
	await a.context().setExtraHTTPHeaders({ 'x-test-ip': ip(w, 9, 1), 'x-test-now': `${w === 'sp' ? '2034-01-10' : '2034-02-10'}T09:00:00+09:00` });
	const { ids } = await issueWithSolutions(a, `s9-${w}-${s}`, [`一覧の解決策 ${w}-${s}`]);
	const title = `賛同の数を出す法案 ${w}-${s}`;
	const bill = await createAmendBill(a, title, ids[0]);
	await support(await user(browser, `s9-b-${w}-${s}`, ip(w, 9, 2)), bill);

	await a.goto('/houan?tab=shitagaki');
	const row = a.getByRole('row').filter({ has: a.getByRole('link', { name: title, exact: true }) });
	if (w === 'pc') {
		await expect(a.getByRole('columnheader', { name: '賛同' })).toBeVisible();
		await expect(row.getByRole('cell', { name: '1人', exact: true })).toBeVisible();
	} else {
		await expect(row).toContainText('下書き ・ 賛同 1人');
	}
});

test('信頼の境界：賛同のフォームの op と rev が決まった形でなければ 400 で、賛同にならない', async ({ browser }, info) => {
	const p = info.project.name;
	const s = stamp();
	const { bill } = await draftBy(browser, `sb-a-${p}-${s}`, ip(p, 10, 1), `sb-${p}-${s}`);
	const b = await user(browser, `sb-b-${p}-${s}`, ip(p, 10, 2));
	const forms: Record<string, string>[] = [
		{ rev: '1' },
		{ op: '', rev: '1' },
		{ op: 'toggle', rev: '1' },
		{ op: 'add' },
		{ op: 'add', rev: '' },
		{ op: 'add', rev: 'abc' },
		{ op: 'add', rev: '0' },
		{ op: 'add', rev: '-1' },
		{ op: 'add', rev: '1.5' }
	];
	for (const form of forms) expect((await billSupportRequest(b, bill, form)).status(), JSON.stringify(form)).toBe(400);
	await b.goto(bill);
	await expect(b.getByText('賛同 0人')).toBeVisible();
});

test('信頼の境界：賛同と発議の送り先の法案の番号が違う・ないときは 404', async ({ browser }, info) => {
	const p = info.project.name;
	const b = await user(browser, `sc-b-${p}-${stamp()}`, ip(p, 11, 1));
	for (const id of ['abc', '0', '01', '-1', '1.5', '99999999']) {
		expect((await billSupportRequest(b, `/houan/${id}`, { op: 'add', rev: '1' })).status(), id).toBe(404);
		expect((await proposeRequest(b, `/houan/${id}`)).status(), id).toBe(404);
	}
});
