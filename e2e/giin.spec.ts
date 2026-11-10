// Issue #149：議員ダッシュボード（SpMember・PcMember。設計書 docs/spec/149.md）。
// 割合の値と可決の一覧の範囲は src/lib/db/bridge.test.ts・src/lib/db/giin.test.ts で確かめる（10人ずつのグループや可決を画面で作るのは重い）
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { ORIGIN, billSupportRequest, createAmendBill, issueWithSolutions, loginAs, postIssue, proposeRequest, reactRequest, stubTurnstile } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});

type Width = 'sp' | 'pc';
/** 幅ごとに別の月を使う */
const MONTH = { sp: '2040-05', pc: '2040-08' } as const;
const at = (month: string, day: number) => `${month}-${String(day).padStart(2, '0')}T09:00:00+09:00`;

type User = { page: Page; name: string; setNow: (now: string) => Promise<void> };

let serial = 0;
async function user(browser: Browser, w: Width, who: string, now: string, role?: 'operator'): Promise<User> {
	const n = ++serial;
	const headers = { 'x-test-ip': `10.149.${w === 'sp' ? 1 : 2}.${n % 250}` };
	const context = await browser.newContext({ baseURL: ORIGIN, extraHTTPHeaders: { ...headers, 'x-test-now': now } });
	contexts.push(context);
	const page = await context.newPage();
	await stubTurnstile(page);
	const name = `${who}${w}${Date.now() % 1e7}${n}`;
	await loginAs(page, name, 8, role);
	return { page, name, setNow: (t) => context.setExtraHTTPHeaders({ ...headers, 'x-test-now': t }) };
}

const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });

/** 運営の画面で認証を付ける。表示する名前を返す */
async function grant(op: Page, target: string, kind: '議員' | '有識者', field = '') {
	const name = `${kind === '議員' ? '試験 議員' : '試験 教授'}${target.slice(-6)}`;
	await op.goto('/kanri');
	await hydrated(op);
	const s = op.getByRole('region', { name: '議員・有識者の認証' });
	await s.getByLabel('表示名').fill(target);
	await s.getByRole('group', { name: '種類' }).getByRole('radio', { name: kind, exact: true }).check();
	await s.getByLabel('表示する名前').fill(name);
	if (field) await s.getByLabel('専門分野').fill(field);
	await Promise.all([op.waitForResponse((r) => r.request().method() === 'POST'), s.getByRole('button', { name: '認証を付ける' }).click()]);
	await op.goto('/kanri');
	await expect(s.getByRole('listitem').filter({ hasText: target })).toHaveCount(1);
	return name;
}

/** 議員を1人用意する */
async function legislator(browser: Browser, w: Width, now: string) {
	const op = await user(browser, w, 'op', now, 'operator');
	const p = await user(browser, w, 'p', now);
	const name = await grant(op.page, p.name, '議員');
	return { op, p, name };
}

/** ダッシュボードの行（スマホはカード、PC は表の行） */
const row = (page: Page, title: string) => page.locator('[data-giin-row]').filter({ has: page.getByRole('link', { name: title, exact: true }) });
const tabs = (page: Page) => page.getByRole('navigation', { name: 'ダッシュボードのタブ' });

test('基準1：議員だけが開ける。ほかの人には 404', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const now = at(MONTH[w], 3);
	const { op, p } = await legislator(browser, w, now);
	const g = await user(browser, w, 'g', now);
	const e = await user(browser, w, 'e', now);
	await grant(op.page, e.name, '有識者', '民法');
	expect((await p.page.goto('/giin'))?.status()).toBe(200);
	for (const [who, u] of [['一般', g], ['有識者', e], ['運営', op]] as const) expect((await u.page.goto('/giin'))?.status(), who).toBe(404);
	const anon = await browser.newContext({ baseURL: ORIGIN });
	contexts.push(anon);
	expect((await (await anon.newPage()).goto('/giin'))?.status(), 'ログインしていない人').toBe(404);
});

test('基準2：議員のヘッダーに「議員用」、ダッシュボードに「認証済み・氏名」', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const now = at(MONTH[w], 3);
	const { p, name } = await legislator(browser, w, now);
	await p.page.goto('/');
	const header = p.page.getByRole('banner');
	await expect(header.getByRole('link', { name: /議員用/ })).toHaveAttribute('href', '/giin');
	await expect(header.getByRole('link', { name: /議員用/ })).toBeVisible();
	await p.page.goto('/giin');
	if (w === 'pc') await expect(header.getByText(`認証済み・${name}`)).toBeVisible();
	else await expect(p.page.getByText(`認証済み議員・${name}`)).toBeVisible();
	// 一般の利用者には出さない
	const g = await user(browser, w, 'g2', now);
	await g.page.goto('/');
	await expect(g.page.getByRole('link', { name: /議員用/ })).toHaveCount(0);
});

test('基準3：見出しと説明と注記', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const { p } = await legislator(browser, w, at(MONTH[w], 3));
	await p.page.goto('/giin');
	await expect(p.page.getByRole('heading', { level: 1 })).toHaveText('市民の課題と解決策');
	await expect(p.page.getByText('閲覧・質疑・答弁ができます。投票と評価はできません。')).toBeVisible();
	await expect(p.page.getByText('選挙期間中は、議員の機能が自動で止まります ・ 反応はすべて記録して公開されます')).toBeVisible();
});

test('基準4：タブは「課題 N」「法案 N」「IF世界で可決 N」で、既定は課題', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const { p } = await legislator(browser, w, at(MONTH[w], 3));
	await p.page.goto('/giin');
	await hydrated(p.page);
	const link = (re: RegExp) => tabs(p.page).getByRole('link', { name: re });
	await expect(link(/^課題\s*\d+$/)).toHaveAttribute('aria-current', 'page');
	await expect(link(/^法案\s*\d+$/)).not.toHaveAttribute('aria-current', 'page');
	await link(/^法案\s*\d+$/).click();
	await expect(link(/^法案\s*\d+$/)).toHaveAttribute('aria-current', 'page');
	await expect(link(/^IF世界で可決\s*\d+$/)).toBeVisible();
	// 形の違う URL は 404
	for (const q of ['tab=x', 'sort=bridge', 'page=1', 'kaiketsu=x']) expect((await p.page.goto(`/giin?${q}`))?.status(), q).toBe(404);
});

test('基準5：課題のタブに、課題名・わかる・立場を超えた支持・いちばんの解決策。絞り込みと並び', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const now = at(MONTH[w], 4);
	const a = await user(browser, w, 'a', now);
	const tag = `${w}${Date.now() % 1e7}`;
	// 解決策のある課題（2つめの解決策に「わかる」を2つ）と、解決策のない新しい課題
	const { issueId, ids, title } = await issueWithSolutions(a.page, `149-${tag}`, [`少ない解決策 ${tag}`, `多い解決策 ${tag}`]);
	for (const who of ['r1', 'r2']) {
		const r = await user(browser, w, who, now);
		expect((await reactRequest(r.page, issueId, { solution: ids[1], kind: 'support', op: 'add' })).status()).toBeLessThan(400);
	}
	const bare = `解決策のない課題 149-${tag}`;
	await postIssue(a.page, { title: bare });
	const { p } = await legislator(browser, w, now);

	await p.page.goto('/giin?sort=new');
	const r = row(p.page, title);
	await expect(r).toBeVisible();
	await expect(r.getByRole('link', { name: title, exact: true })).toHaveAttribute('href', `/kadai/${issueId}`);
	// 立場を超えた支持は、人数が足りないので「—」
	if (w === 'sp') {
		await expect(r).toContainText(/わかる 1(?!\d)/);
		await expect(r).toContainText('立場を超えた支持 —');
		await expect(r).toContainText(`いちばんの解決策：多い解決策 ${tag}`);
	} else {
		for (const h of ['課題', 'わかる', '立場を超えた支持', 'いちばんの解決策']) await expect(p.page.getByRole('columnheader', { name: h, exact: true })).toBeVisible();
		await expect(r.getByRole('cell', { name: '1', exact: true })).toBeVisible();
		await expect(r.getByRole('cell', { name: '—', exact: true })).toBeVisible();
		await expect(r.getByRole('cell', { name: `多い解決策 ${tag}`, exact: true })).toBeVisible();
	}
	await expect(row(p.page, bare)).toContainText('まだありません');
	// 新しい順：あとで書いた課題が先
	const order = await p.page.locator('[data-giin-row] a[href^="/kadai/"]').evaluateAll((as) => as.map((x) => x.textContent?.trim()));
	expect(order.indexOf(bare)).toBeLessThan(order.indexOf(title));

	// 絞り込み「解決策あり」：解決策のない課題は出ない
	await p.page.goto('/giin?sort=new&kaiketsu=ari');
	await expect(row(p.page, title)).toBeVisible();
	await expect(row(p.page, bare)).toHaveCount(0);
	// 絞り込みと並びは画面から選べる
	await p.page.goto('/giin');
	await expect(p.page.getByRole('link', { name: 'すべて', exact: true })).toHaveAttribute('aria-current', 'page');
	await expect(p.page.getByRole('link', { name: '解決策あり', exact: true })).toHaveAttribute('href', '/giin?kaiketsu=ari');
	await expect(p.page.getByRole('link', { name: '法案になった', exact: true })).toHaveAttribute('href', '/giin?houan=ari');
	await expect(p.page.getByLabel('並び順')).toHaveValue('bridge');
});

test('基準6：法案のタブに、審議中の法案と、いまの段と元の課題', async ({ browser }, info) => {
	test.setTimeout(120_000);
	const w = info.project.name as Width;
	const month = MONTH[w];
	const a = await user(browser, w, 'a6', at(month, 5));
	const tag = `${w}${Date.now() % 1e7}`;
	const { ids, title: issueTitle } = await issueWithSolutions(a.page, `149b-${tag}`, [`窓口を作る ${tag}`]);
	const billTitle = `ダッシュボードの法案 ${tag}`;
	const bill = await createAmendBill(a.page, billTitle, ids[0]);
	for (const who of ['b6', 'c6', 'd6']) {
		const s = await user(browser, w, who, at(month, 5));
		expect((await billSupportRequest(s.page, bill, { op: 'add', rev: '1' })).status()).toBe(200);
	}
	expect((await proposeRequest(a.page, bill)).status()).toBe(200);
	const { p } = await legislator(browser, w, at(month, 16));
	await p.page.goto('/giin?tab=houan');
	const r = row(p.page, billTitle);
	await expect(r.getByRole('link', { name: billTitle, exact: true })).toHaveAttribute('href', bill);
	await expect(r).toContainText('質疑');
	await expect(r).toContainText(issueTitle);
});

test('基準7：IF世界で可決のタブ。可決した法案がなければ「まだありません」', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const { p } = await legislator(browser, w, at(MONTH[w], 3));
	await p.page.goto('/giin?tab=kaketsu');
	await expect(tabs(p.page).getByRole('link', { name: /^IF世界で可決\s*\d+$/ })).toHaveAttribute('aria-current', 'page');
	const count = Number(/(\d+)$/.exec((await tabs(p.page).getByRole('link', { name: /^IF世界で可決/ }).innerText()).trim())![1]);
	if (count === 0) await expect(p.page.getByText('まだありません')).toBeVisible();
	else {
		const first = p.page.locator('[data-giin-row]').first();
		await expect(first.getByRole('link').first()).toHaveAttribute('href', /^\/saiketsu\/\d+\/kekka$/);
		await expect(first.locator('a[href^="/if/hourei/"]').first()).toBeVisible();
	}
});
