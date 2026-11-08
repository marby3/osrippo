// フェーズ3 法案と会期の締めのテスト（Issue #41）。
// 通ったらフェーズ3完了として v0.3 を出す。それまでは test:phase でだけ回す。
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { ORIGIN, loginAs, postIssue, solutionRequest, stubTurnstile } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});

type Width = 'sp' | 'pc';

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
	// 下書き・賛同・発議は登録から7日たったアカウントだけ（Issue #41 決めたこと6）。
	// 登録日は本当の時刻から数えるので、x-test-now の月ではどの利用者も7日を過ぎている。7日の確かめは実装の Issue のテストで行う
	if (name) await loginAs(page, name, 8);
	return { page, headers };
}

/** 時刻を進める */
const setNow = (u: User, now: string) => u.page.context().setExtraHTTPHeaders({ ...u.headers, 'x-test-now': now });

const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
const either = (page: Page, name: string | RegExp) =>
	page.getByRole('link', { name }).or(page.getByRole('button', { name })).or(page.getByRole('tab', { name }));
const escape = (t: string) => t.replace(/[()（）]/g, '\\$&');

/**
 * 法案の状態。スマホは「いま：質疑（3週目）」の1行（SpBillSummary）、
 * PCは「いまの段階」の並びの「質疑（いまここ）」（PcBillSummary）。付託の段「委員会へ」が「いまここ」になることはない（決めたこと5）
 */
function status(page: Page, w: Width, sp: string, pc = sp) {
	return w === 'sp'
		? page.getByText(new RegExp(`^いま：\\s*${escape(sp)}$`))
		: page.getByText(new RegExp(`^${escape(pc)}\\s*（いまここ）$`));
}

/** 一覧のタブを開く */
async function openTab(page: Page, tab: '審議中' | '下書き' | '終わった') {
	await page.goto('/houan');
	await hydrated(page);
	await either(page, new RegExp(`^${tab}`)).first().click();
}

/** 題名がそのタブにあり、ほかのタブにはない（「移る」の確かめ） */
async function onlyInTab(page: Page, tab: '審議中' | '下書き' | '終わった', title: string) {
	for (const t of ['審議中', '下書き', '終わった'] as const) {
		await openTab(page, t);
		await expect(page.getByRole('link', { name: title })).toHaveCount(t === tab ? 1 : 0);
	}
}

/** 解決策を引用して改正の法案を書き、下書きを保存する。法案のページのパスを返す */
async function draft(a: Page, solutionId: string, solutionBody: string, title: string, text: string) {
	// 法案は解決策から書き始める。/houan/kaku?kaiketsu=<番号> で、その解決策を引用した状態で開く（Issue #41 テストの作り方）
	await a.goto(`/houan/kaku?kaiketsu=${solutionId}`);
	await hydrated(a);
	await expect(a.getByRole('group', { name: '元になった解決策' })).toContainText(solutionBody);
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

/** 賛同する（取り消しのボタンと混ざらないよう、名前は完全一致） */
async function support(u: Page, bill: string) {
	await u.goto(bill);
	await hydrated(u);
	await expect(either(u, '編集する')).toHaveCount(0);
	await u.getByRole('button', { name: '賛同する', exact: true }).click();
	await expect(u.getByRole('button', { name: '賛同する', exact: true })).toHaveCount(0);
}

test('法案を下書きし、3人の賛同で発議し、会期の終わりに廃案になるまで。発議しない下書きは残る', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const { now, next } = MONTH[w];
	const suffix = `${w}-${Date.now() % 1e8}`;
	const ip = (n: number) => `10.${w === 'sp' ? 30 : 31}.0.${n}`;
	const title = `締めのテスト ${suffix}`;
	const title2 = `持ち越す下書き ${suffix}`;
	const newText = 'この法律は、消費者がいつでも契約をやめられるようにすることを目的とする。';

	// 1. ログインしていなくても一覧を見られる。書くにはログインが要る
	const viewer = await user(browser, ip(9), at(now, 3));
	const v = viewer.page;
	await v.goto('/houan');
	await expect(v.getByRole('heading', { level: 1, name: '法案', exact: true })).toBeVisible();
	for (const tab of ['審議中', '下書き', '終わった']) await expect(either(v, new RegExp(`^${tab}`)).first()).toBeVisible();
	await v.getByRole('link', { name: '法案の書き方を見る' }).click();
	await expect(v.getByRole('heading', { level: 1, name: '法案の書き方' })).toBeVisible();
	await v.goto('/houan/kaku');
	await expect(either(v, 'Googleでログイン')).toBeVisible();

	// 2. A が課題と解決策を書き、その解決策を引用して改正の法案を書く
	const author = await user(browser, ip(1), at(now, 3), `A3-${suffix}`);
	const a = author.page;
	const issueId = await postIssue(a, { title: `法案の元の課題 ${suffix}` });
	const solutionBody = `解約はネットでいつでもできるようにする ${suffix}`;
	const res = await solutionRequest(a, issueId, solutionBody);
	expect(res.status(), await res.text()).toBe(303);
	await a.goto(`/kadai/${issueId}/kaiketsu`);
	const solutionId = ((await a.locator('article').filter({ hasText: solutionBody }).getAttribute('id')) ?? '').replace('kaiketsu-', '');
	expect(solutionId).toMatch(/^\d+$/);

	const bill = await draft(a, solutionId, solutionBody, title, newText);
	await expect(status(a, w, '下書き')).toBeVisible();
	await expect(a.getByText('消費者契約法の一部を改正する法律案', { exact: true })).toBeVisible();
	await expect(a.getByText(solutionBody)).toBeVisible();
	await either(a, /^変更点/).first().click();
	const removed = a.locator('del').first();
	const added = a.locator('ins').first();
	await expect(removed).toHaveCSS('text-decoration-line', /line-through/);
	await expect(removed).toContainText('−');
	await expect(added).toHaveCSS('text-decoration-line', /underline/);
	await expect(added).toContainText('＋');
	await expect(a.locator('ins').filter({ hasText: 'いつでも契約をやめられる' }).first()).toBeVisible();
	await onlyInTab(a, '下書き', title);

	// 5.（準備）発議しない2本目の下書き
	const bill2 = await draft(a, solutionId, solutionBody, title2, 'この法律は、消費者の利益を守ることを目的とする。');

	// 3. B・C・D が賛同する（4日）。A のほかには「編集する」が出ない。3人目のあとで A が発議する
	await a.goto(bill);
	await expect(either(a, '編集する')).toBeVisible();
	for (const [n, name] of [
		[2, 'B'],
		[3, 'C']
	] as const) {
		await support((await user(browser, ip(n), at(now, 4), `${name}3-${suffix}`)).page, bill);
	}
	await setNow(author, at(now, 4));
	await a.goto(bill);
	await expect(a.getByRole('button', { name: '発議する' })).toBeDisabled();
	await expect(a.getByText(/あと1人/)).toBeVisible();

	await support((await user(browser, ip(4), at(now, 4), `D3-${suffix}`)).page, bill);

	await setNow(author, at(now, 5));
	await a.goto(bill);
	await hydrated(a);
	await a.getByRole('button', { name: '発議する' }).click();
	await expect(status(a, w, '発議')).toBeVisible();
	await expect(either(a, '編集する')).toHaveCount(0);
	await onlyInTab(a, '審議中', title);

	// 4. 時刻を進めると状態が変わる
	for (const [day, sp, pc] of [
		[15, '質疑（3週目）', '質疑'],
		[22, '採決（4週目）', '採決']
	] as const) {
		await setNow(viewer, at(now, day));
		await v.goto(bill);
		await expect(status(v, w, sp, pc)).toBeVisible();
	}
	await setNow(viewer, at(next, 1));
	await v.goto(bill);
	await expect(status(v, w, '廃案')).toBeVisible();
	await onlyInTab(v, '終わった', title);

	// 5. 発議しなかった下書きは、次の会期でも下書きのまま残る
	await v.goto(bill2);
	await expect(status(v, w, '下書き')).toBeVisible();
	await onlyInTab(v, '下書き', title2);
});
