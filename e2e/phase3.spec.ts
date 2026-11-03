// フェーズ3 法案と会期の締めのテスト（Issue #41）。
// 通ったらフェーズ3完了として v0.3 を出す。それまでは test:phase でだけ回す。
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { ORIGIN, loginAs, postIssue, solutionRequest, stubTurnstile } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});

/**
 * 幅ごとに別の月を使う（どちらも前の月に誰も何もしていない月）。DB は2つの幅で共有するので、
 * 会期の切り替えが混ざらないように playwright.phase.config.ts は workers: 1 にする（Issue #41 テストの作り方）
 */
const MONTH = { sp: { now: '2030-05', next: '2030-06' }, pc: { now: '2030-09', next: '2030-10' } } as const;
const at = (month: string, day: number) => `${month}-${String(day).padStart(2, '0')}T09:00:00+09:00`;

type User = { page: Page; headers: Record<string, string> };

/** サーバーの「いま」を x-test-now で決めた利用者。name がなければログインしない */
async function user(browser: Browser, ip: string, now: string, name?: string): Promise<User> {
	const headers = { 'x-test-ip': ip };
	const context = await browser.newContext({ baseURL: ORIGIN, extraHTTPHeaders: { ...headers, 'x-test-now': now } });
	contexts.push(context);
	const page = await context.newPage();
	await stubTurnstile(page);
	// 下書き・賛同・発議は登録から7日たったアカウントだけ（Issue #41 決めたこと6）
	if (name) await loginAs(page, name, 8);
	return { page, headers };
}

/** 時刻を進める */
const setNow = (u: User, now: string) => u.page.context().setExtraHTTPHeaders({ ...u.headers, 'x-test-now': now });

const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
const either = (page: Page, name: string | RegExp) =>
	page.getByRole('link', { name }).or(page.getByRole('button', { name })).or(page.getByRole('tab', { name }));
const status = (page: Page, s: string) => page.getByText(new RegExp(`^いま：\\s*${s.replace(/[()（）]/g, '\\$&')}$`));

/** 一覧のタブを開いて、題名のリンクがあるか */
async function inTab(page: Page, tab: '審議中' | '下書き' | '終わった', title: string) {
	await page.goto('/houan');
	await hydrated(page);
	await either(page, new RegExp(`^${tab}`)).first().click();
	await expect(page.getByRole('link', { name: title })).toBeVisible();
}

/** 解決策を引用して改正の法案を書き、下書きを保存する。法案のページの URL を返す */
async function draft(a: Page, solutionId: string, title: string, text: string) {
	// 法案は解決策から書き始める（解決策を引用した状態で開く）
	await a.goto(`/houan/kaku?kaiketsu=${solutionId}`);
	await hydrated(a);
	await a.getByRole('radio', { name: '改正' }).check();
	await a.getByLabel('題名').fill(title);
	await a.getByLabel('対象の法令').selectOption({ label: '消費者契約法' });
	await a.getByLabel('変える条').selectOption({ label: '第1条（目的）' });
	await a.getByLabel('変更後の条文').fill(text);
	await a.getByLabel('誰が困っているか').fill('定期購入の解約ができずに困っている人');
	await a.getByLabel('副作用').fill('事業者の解約窓口の負担が増える');
	await a.getByRole('button', { name: '下書きを保存する' }).click();
	await expect(a.getByRole('heading', { level: 1, name: title })).toBeVisible();
	expect(a.url()).toMatch(/\/houan\/\d+$/);
	return new URL(a.url()).pathname;
}

test('法案を下書きし、3人の賛同で発議し、会期の終わりに廃案になるまで。発議しない下書きは残る', async ({ browser }, info) => {
	const p = info.project.name as 'sp' | 'pc';
	const { now, next } = MONTH[p];
	const s = Date.now() % 1e8;
	const ip = (n: number) => `10.${p === 'sp' ? 30 : 31}.0.${n}`;
	const title = `締めのテスト ${p}-${s}`;
	const title2 = `持ち越す下書き ${p}-${s}`;

	// 1. ログインしていなくても一覧を見られる。書くにはログインが要る
	const viewer = await user(browser, ip(9), at(now, 3));
	const v = viewer.page;
	await v.goto('/houan');
	await expect(v.getByRole('heading', { level: 1, name: '法案', exact: true })).toBeVisible();
	for (const tab of ['審議中', '下書き', '終わった']) await expect(either(v, new RegExp(`^${tab}`)).first()).toBeVisible();
	await v.getByRole('link', { name: '法案を書く' }).click();
	await expect(either(v, 'Googleでログイン')).toBeVisible();

	// 2. A が課題と解決策を書き、その解決策を引用して改正の法案を書く
	const a = (await user(browser, ip(1), at(now, 3), `A3-${p}-${s}`)).page;
	const issueId = await postIssue(a, { title: `法案の元の課題 ${p}-${s}` });
	const solutionBody = `解約はネットでいつでもできるようにする ${p}-${s}`;
	const res = await solutionRequest(a, issueId, solutionBody);
	expect(res.status(), await res.text()).toBe(303);
	await a.goto(`/kadai/${issueId}/kaiketsu`);
	const solutionId = ((await a.locator('article').filter({ hasText: solutionBody }).getAttribute('id')) ?? '').replace('kaiketsu-', '');
	expect(solutionId).toMatch(/^\d+$/);

	const bill = await draft(a, solutionId, title, 'この法律は、消費者がいつでも契約をやめられるようにすることを目的とする。');
	await expect(status(a, '下書き')).toBeVisible();
	await expect(a.getByText('消費者契約法の一部を改正する法律案')).toBeVisible();
	await expect(a.getByText(solutionBody)).toBeVisible();
	await either(a, /^変更点/).first().click();
	const removed = a.locator('del').first();
	const added = a.locator('ins').first();
	await expect(removed).toHaveCSS('text-decoration-line', /line-through/);
	await expect(removed).toContainText('−');
	await expect(added).toHaveCSS('text-decoration-line', /underline/);
	await expect(added).toContainText('＋');
	await inTab(a, '下書き', title);

	// 5.（準備）発議しない2本目の下書き
	const bill2 = await draft(a, solutionId, title2, 'この法律は、消費者の利益を守ることを目的とする。');

	// 3. B・C・D が賛同する。A のほかには「編集する」が出ない。3人目のあとで A が発議する
	await a.goto(bill);
	await expect(either(a, '編集する')).toBeVisible();
	for (const [n, name] of [
		[2, 'B'],
		[3, 'C']
	] as const) {
		const u = (await user(browser, ip(n), at(now, 4), `${name}3-${p}-${s}`)).page;
		await u.goto(bill);
		await hydrated(u);
		await expect(either(u, '編集する')).toHaveCount(0);
		await u.getByRole('button', { name: '賛同する' }).click();
		await expect(u.getByRole('button', { name: '賛同する' })).toHaveCount(0);
	}
	await a.goto(bill);
	await expect(a.getByRole('button', { name: '発議する' })).toBeDisabled();
	await expect(a.getByText(/あと1人/)).toBeVisible();

	const d = (await user(browser, ip(4), at(now, 5), `D3-${p}-${s}`)).page;
	await d.goto(bill);
	await hydrated(d);
	await d.getByRole('button', { name: '賛同する' }).click();
	await expect(d.getByRole('button', { name: '賛同する' })).toHaveCount(0);

	await a.goto(bill);
	await hydrated(a);
	await a.getByRole('button', { name: '発議する' }).click();
	await expect(status(a, '発議')).toBeVisible();
	await expect(either(a, '編集する')).toHaveCount(0);
	await inTab(a, '審議中', title);

	// 4. 時刻を進めると状態が変わる
	for (const [day, s2] of [
		[15, '質疑（3週目）'],
		[22, '採決（4週目）']
	] as const) {
		await setNow(viewer, at(now, day));
		await v.goto(bill);
		await expect(status(v, s2)).toBeVisible();
	}
	await setNow(viewer, at(next, 1));
	await v.goto(bill);
	await expect(status(v, '廃案')).toBeVisible();
	await inTab(v, '終わった', title);

	// 5. 発議しなかった下書きは、次の会期でも下書きのまま残る
	await v.goto(bill2);
	await expect(status(v, '下書き')).toBeVisible();
	await inTab(v, '下書き', title2);
});
