// Issue #158：議員にできないこと（設計書 docs/spec/158.md）。今月の参加者の数え方と議員になる前の票は src/lib/db/legislators.test.ts
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import {
	ORIGIN,
	billRequest,
	billSupportRequest,
	createAmendBill,
	issueWithSolutions,
	loginAs,
	postIssueRequest,
	proposeRequest,
	reactRequest,
	reportRequest,
	solutionRequest,
	stubTurnstile,
	supportRequest
} from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});

type Width = 'sp' | 'pc';
/** 幅ごとに別の月を使う（法案の発議と採決の期間がぶつからないように） */
const MONTH = { sp: '2039-05', pc: '2039-08' } as const;
const at = (month: string, day: number) => `${month}-${String(day).padStart(2, '0')}T09:00:00+09:00`;
const LEGISLATOR = '議員のアカウントではできません。閲覧と質疑ができます。';

type User = { page: Page; name: string; setNow: (now: string) => Promise<void> };

let serial = 0;
async function user(browser: Browser, w: Width, who: string, now: string, role?: 'operator'): Promise<User> {
	const n = ++serial;
	const headers = { 'x-test-ip': `10.158.${w === 'sp' ? 1 : 2}.${n % 250}` };
	const context = await browser.newContext({ baseURL: ORIGIN, extraHTTPHeaders: { ...headers, 'x-test-now': now } });
	contexts.push(context);
	const page = await context.newPage();
	await stubTurnstile(page);
	const name = `${who}${w}${Date.now() % 1e7}${n}`;
	await loginAs(page, name, 8, role);
	return { page, name, setNow: (t) => context.setExtraHTTPHeaders({ ...headers, 'x-test-now': t }) };
}

const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });

/** 運営の画面で認証を付ける */
async function grant(op: Page, target: string, kind: '議員' | '有識者', field = '') {
	await op.goto('/kanri');
	await hydrated(op);
	const s = op.getByRole('region', { name: '議員・有識者の認証' });
	await s.getByLabel('表示名').fill(target);
	await s.getByRole('group', { name: '種類' }).getByRole('radio', { name: kind, exact: true }).check();
	await s.getByLabel('表示する名前').fill(`${kind} ${target}`);
	if (field) await s.getByLabel('専門分野').fill(field);
	await Promise.all([op.waitForResponse((r) => r.request().method() === 'POST'), s.getByRole('button', { name: '認証を付ける' }).click()]);
	await op.goto('/kanri');
	await expect(s.getByRole('listitem').filter({ hasText: target })).toHaveCount(1);
}

/** フォームと同じ POST */
const post = (page: Page, path: string, form: Record<string, string>) =>
	page.request.post(path, { form, headers: { origin: ORIGIN, accept: 'text/html' }, maxRedirects: 0 });

/** A が課題と解決策を書き、法案を発議する（B・C・D が賛同） */
async function proposedBill(browser: Browser, w: Width, month: string) {
	const a = await user(browser, w, 'a', at(month, 5));
	const tag = `${w}${Date.now() % 1e7}`;
	const { issueId, ids } = await issueWithSolutions(a.page, `158-${tag}`, [`窓口を作る ${tag}`]);
	const bill = await createAmendBill(a.page, `議員の制限の法案 ${tag}`, ids[0]);
	for (const who of ['b', 'c', 'd']) {
		const s = await user(browser, w, who, at(month, 5));
		expect((await billSupportRequest(s.page, bill, { op: 'add', rev: '1' })).status()).toBe(200);
	}
	expect((await proposeRequest(a.page, bill)).status()).toBe(200);
	return { a, issueId, solutionId: ids[0], bill, billId: bill.replace('/houan/', ''), tag };
}

test('基準1：議員には参加のボタンを出さず文言を出す。画面を通さずに送っても断る', async ({ browser }, info) => {
	test.setTimeout(150_000);
	const w = info.project.name as Width;
	const month = MONTH[w];
	const { a, issueId, solutionId, bill, billId, tag } = await proposedBill(browser, w, month);
	// 賛同を集めている下書き（賛同のボタンは発議の前の下書きにだけ出る）
	const draft = await createAmendBill(a.page, `賛同を集める下書き ${tag}`, String(solutionId));
	const op = await user(browser, w, 'op', at(month, 5), 'operator');
	const p = await user(browser, w, 'p', at(month, 5));
	await grant(op.page, p.name, '議員');

	// 画面：課題の「わかる」がなく、課題を書く画面と法案を書く画面に文言
	await p.page.goto(`/kadai/${issueId}`);
	await expect(p.page.getByRole('main').getByRole('button', { name: /^わかる/ })).toHaveCount(0);
	await expect(p.page.getByText(LEGISLATOR).first()).toBeVisible();
	// 解決策の「わかる」「考えが変わった」も押せない（数だけ）
	await expect(p.page.getByRole('main').locator('form[action="?/react"]')).toHaveCount(0);
	for (const path of ['/kadai/kaku', '/houan/kaku']) {
		await p.page.goto(path);
		await expect(p.page.getByText(LEGISLATOR).first(), path).toBeVisible();
	}
	// 法案のページ（賛同を集めている下書き）：賛同のボタンがなく、文言が出る
	await p.page.goto(draft);
	await expect(p.page.locator('form[action="?/support"]')).toHaveCount(0);
	await expect(p.page.getByText(LEGISLATOR).first()).toBeVisible();

	// 送っても断る（403）
	const refused = async (label: string, res: Promise<{ status(): number }>) => expect((await res).status(), label).toBe(403);
	await refused('課題の投稿', postIssueRequest(p.page, { title: `議員の課題 ${tag}` }));
	await refused('課題のわかる', supportRequest(p.page, issueId, 'add'));
	await refused('解決策の投稿', solutionRequest(p.page, issueId, `議員の解決策 ${tag}`));
	await refused('解決策のわかる', reactRequest(p.page, issueId, { solution: String(solutionId), kind: 'support', op: 'add' }));
	await refused('法案の下書き', billRequest(p.page, '/houan/kaku', { kind: 'amend', title: `議員の法案 ${tag}` }));
	await refused('賛同', billSupportRequest(p.page, bill, { op: 'add', rev: '1' }));
	await refused('考え', post(p.page, `${bill}/shitsugi?/stance`, { stance: 'support' }));
	await refused('評価', post(p.page, `${bill}/shitsugi?/evaluate`, { post: '1', kind: 'reasonable', op: 'add' }));
	await refused('立候補', post(p.page, '/iinkai?/stand', { 'cf-turnstile-response': 'test-pass' }));
	await refused('解任の署名', post(p.page, '/iinkai?/recall', { 'cf-turnstile-response': 'test-pass' }));
	await refused('修正案の賛同', post(p.page, `${bill}/shusei?/support`, { amendment: '1', revision: '1', op: 'add' }));

	// 採決の期間：割り当てがなく（0 / 0）、文言が出る。投票は断る
	await p.setNow(at(month, 22));
	await p.page.goto('/saiketsu');
	await expect(p.page.getByText(/割り当て法案\s*0\s*\/\s*0/)).toBeVisible();
	await expect(p.page.getByText(LEGISLATOR).first()).toBeVisible();
	await refused('投票', post(p.page, `/saiketsu/${billId}?/vote`, { choice: 'yes', 'cf-turnstile-response': 'test-pass' }));
	// 投票の画面：票を選ぶ欄がなく、文言が出る
	await p.page.goto(`/saiketsu/${billId}`);
	await expect(p.page.getByRole('radio')).toHaveCount(0);
	await expect(p.page.getByText(LEGISLATOR).first()).toBeVisible();
});

test('基準4：議員になる前の「わかる」は数え続け、取り消せる。提出者として撤回に同意できる', async ({ browser }, info) => {
	test.setTimeout(150_000);
	const w = info.project.name as Width;
	const month = MONTH[w];
	// A が課題に「わかる」を付け、法案を発議したあとで議員になる
	const { a, issueId, solutionId, bill, tag } = await proposedBill(browser, w, month);
	expect((await supportRequest(a.page, issueId, 'add')).status()).toBeLessThan(400);
	// 議員になる前に書いた下書き
	const draft = await createAmendBill(a.page, `議員になる前の下書き ${tag}`, String(solutionId));
	const supports = async () => {
		await a.page.goto(`/kadai/${issueId}`);
		return Number(/わかる\s*(\d+)/.exec(await a.page.getByRole('main').innerText())![1]);
	};
	const before = await supports();
	const op = await user(browser, w, 'op4', at(month, 6), 'operator');
	await a.setNow(at(month, 6));
	await grant(op.page, a.name, '議員');

	// 議員になっても、前に付けた「わかる」は数える
	expect(await supports()).toBe(before);
	// 取り消しは前にした参加の後始末なので、できる
	expect((await supportRequest(a.page, issueId, 'remove')).status()).toBeLessThan(400);
	expect(await supports()).toBe(before - 1);
	// 付け直しは新しい参加なので、断る
	expect((await supportRequest(a.page, issueId, 'add')).status()).toBe(403);
	// 議員になる前の下書きも、発議・直す・統合のボタンを出さず、文言を出す
	await a.page.goto(draft);
	await expect(a.page.locator('form[action="?/propose"], form[action="?/merge"]')).toHaveCount(0);
	await expect(a.page.getByRole('link', { name: '編集する' })).toHaveCount(0);
	await expect(a.page.getByText(LEGISLATOR).first()).toBeVisible();
	// 提出者としての撤回の同意はできる（ほかに共同提出者がいないので、撤回される）
	expect((await billRequest(a.page, `${bill}?/withdraw`, { op: 'consent', confirm: 'on' })).status()).toBe(200);
});

test('基準2：議員は法案の質疑を書け、通報できる', async ({ browser }, info) => {
	test.setTimeout(150_000);
	const w = info.project.name as Width;
	const month = MONTH[w];
	const { issueId, bill, tag } = await proposedBill(browser, w, month);
	const op = await user(browser, w, 'op', at(month, 5), 'operator');
	const p = await user(browser, w, 'p', at(month, 15));
	await grant(op.page, p.name, '議員');

	await p.page.goto(bill);
	await hydrated(p.page);
	await p.page.getByRole('navigation', { name: '法案のページ' }).getByRole('link', { name: /^質疑/ }).click();
	await p.page.getByRole('link', { name: '質疑を書く' }).or(p.page.getByRole('button', { name: '質疑を書く' })).first().click();
	const question = `議員からの質疑 ${tag}`;
	await p.page.getByLabel('質疑の内容').fill(question);
	await Promise.all([p.page.waitForResponse((r) => r.request().method() === 'POST' && !r.url().includes('?/read')), p.page.getByRole('button', { name: '送る' }).click()]);
	await p.page.goto(`${bill}/shitsugi`);
	await expect(p.page.locator('article').filter({ hasText: question })).toBeVisible();

	expect((await reportRequest(p.page, issueId, { reason: 'spam' })).status()).toBe(200);
});

test('基準5：有識者は「わかる」を付けられる。議員の認証を取り消すと付けられる', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const month = MONTH[w];
	const a = await user(browser, w, 'a5', at(month, 3));
	const tag = `${w}${Date.now() % 1e7}`;
	const { issueId } = await issueWithSolutions(a.page, `158e-${tag}`, [`説明を増やす ${tag}`]);
	const op = await user(browser, w, 'op5', at(month, 3), 'operator');
	const e = await user(browser, w, 'e5', at(month, 3));
	const p = await user(browser, w, 'p5', at(month, 3));
	await grant(op.page, e.name, '有識者', '消費者法');
	await grant(op.page, p.name, '議員');

	expect((await supportRequest(e.page, issueId, 'add')).status()).toBeLessThan(400);
	expect((await supportRequest(p.page, issueId, 'add')).status()).toBe(403);

	// 取り消すと、一般の参加者と同じ
	await op.page.goto('/kanri');
	const row = op.page.getByRole('region', { name: '議員・有識者の認証' }).getByRole('listitem').filter({ hasText: p.name });
	await Promise.all([op.page.waitForResponse((r) => r.request().method() === 'POST'), row.getByRole('button', { name: '取り消す' }).click()]);
	await p.page.goto(`/kadai/${issueId}`);
	await expect(p.page.getByText(LEGISLATOR)).toHaveCount(0);
	expect((await supportRequest(p.page, issueId, 'add')).status()).toBeLessThan(400);
});
