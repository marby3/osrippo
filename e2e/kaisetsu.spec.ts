// Issue #152：専門家の解説。通報で見えなくなる条件（関わった人の通報を数えないなど）は src/lib/db/commentaries.test.ts
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { ORIGIN, billSupportRequest, createAmendBill, issueWithSolutions, loginAs, proposeRequest, stubTurnstile } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});

test.use({ actionTimeout: 15_000 });

type Width = 'sp' | 'pc';
/** 基準ごと・幅ごとの月（法案の発議と、選挙の期間がぶつからないように） */
const MONTHS: Record<string, Record<Width, string>> = {
	c1: { sp: '2047-01', pc: '2047-02' },
	c2: { sp: '2047-03', pc: '2047-04' },
	c3: { sp: '2047-05', pc: '2047-06' },
	c4: { sp: '2047-07', pc: '2047-08' },
	c5: { sp: '2047-09', pc: '2047-10' },
	c6: { sp: '2047-11', pc: '2047-12' }
};
const at = (month: string, day: number) => `${month}-${String(day).padStart(2, '0')}T09:00:00+09:00`;
const nextMonth = (month: string) => {
	const [y, m] = month.split('-').map(Number);
	return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};
const jaDay = (month: string, day: number) => `${Number(month.slice(0, 4))}年${Number(month.slice(5))}月${day}日`;

type User = { page: Page; name: string; setNow: (now: string) => Promise<void> };

let serial = 0;
async function user(browser: Browser, w: Width, who: string, now: string, opts: { role?: 'operator'; days?: number } = {}): Promise<User> {
	const n = ++serial;
	const headers = { 'x-test-ip': `10.152.${w === 'sp' ? 1 : 2}.${n % 250}` };
	const context = await browser.newContext({ baseURL: ORIGIN, extraHTTPHeaders: { ...headers, 'x-test-now': now } });
	contexts.push(context);
	const page = await context.newPage();
	await stubTurnstile(page);
	const name = `${who}${w}${Date.now() % 1e7}${n}`;
	if (who !== 'anon') await loginAs(page, name, opts.days ?? 8, opts.role);
	return { page, name, setNow: (t) => context.setExtraHTTPHeaders({ ...headers, 'x-test-now': t }) };
}

const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });

async function posted(u: Page, act: () => Promise<void>) {
	await Promise.all([u.waitForResponse((r) => r.request().method() === 'POST'), act()]);
	await u.waitForLoadState('networkidle');
}

/** 運営の画面で認証を付ける。表示する名前を返す */
async function grant(op: Page, target: string, kind: '議員' | '有識者', field = '') {
	const name = `${kind === '議員' ? '解説 議員' : '解説 教授'}${target.slice(-6)}`;
	await op.goto('/kanri');
	await hydrated(op);
	const s = op.getByRole('region', { name: '議員・有識者の認証' });
	await s.getByLabel('表示名').fill(target);
	await s.getByRole('group', { name: '種類' }).getByRole('radio', { name: kind, exact: true }).check();
	await s.getByLabel('表示する名前').fill(name);
	if (field) await s.getByLabel('専門分野').fill(field);
	await posted(op, () => s.getByRole('button', { name: '認証を付ける' }).click());
	await op.goto('/kanri');
	await expect(s.getByRole('listitem').filter({ hasText: target })).toHaveCount(1);
	return name;
}

/** 5日に A が法案を発議する（B・C・D が賛同）。有識者 E を用意する */
async function setup(browser: Browser, w: Width, month: string) {
	const a = await user(browser, w, 'a', at(month, 5));
	const tag = `${w}${Date.now() % 1e7}`;
	const { ids } = await issueWithSolutions(a.page, `152-${tag}`, [`解決策 ${tag}`]);
	const bill = await createAmendBill(a.page, `解説の法案 ${tag}`, ids[0]);
	for (const who of ['b', 'c', 'd']) {
		const s = await user(browser, w, who, at(month, 5));
		expect((await billSupportRequest(s.page, bill, { op: 'add', rev: '1' })).status()).toBe(200);
	}
	expect((await proposeRequest(a.page, bill)).status()).toBe(200);
	const op = await user(browser, w, 'op', at(month, 5), { role: 'operator' });
	const e = await user(browser, w, 'e', at(month, 10));
	const expert = await grant(op.page, e.name, '有識者', '消費者法');
	return { a, op, e, expert, bill, solutionId: ids[0], tag };
}

const section = (page: Page) => page.getByRole('region', { name: '専門家の解説' });

/** 法案のページ（概要）で解説を書く */
async function write(u: Page, bill: string, body: string) {
	await u.goto(bill);
	await hydrated(u);
	const s = section(u);
	await s.getByLabel('解説の内容').fill(body);
	await posted(u, () => s.getByRole('button', { name: '解説を送る' }).click());
}

const post = (page: Page, path: string, form: Record<string, string>) =>
	page.request.post(path, { form, headers: { origin: ORIGIN, accept: 'text/html' }, maxRedirects: 0 });

test('基準1：有識者は発議された法案の概要のタブで解説を書ける。1つの法案に1人1件', async ({ browser }, info) => {
	test.setTimeout(150_000);
	const w = info.project.name as Width;
	const month = MONTHS.c1[w];
	const { e, expert, bill, tag } = await setup(browser, w, month);
	const body = `消費者契約法の第1条を変えると、次のような効果があります ${tag}`;
	await write(e.page, bill, body);
	await e.page.goto(bill);
	const article = section(e.page).getByRole('article').filter({ hasText: body });
	await expect(article).toContainText(expert);
	await expect(article).toContainText('有識者（消費者法）');
	await expect(article).toContainText(jaDay(month, 10));
	// 2件めは書けない（書く欄の代わりに、直すボタン）
	await expect(section(e.page).getByRole('button', { name: '解説を送る' })).toHaveCount(0);
	await expect(section(e.page).getByRole('button', { name: '解説を直す' })).toBeVisible();
	// 2000字まで
	const tooLong = await post(e.page, `${bill}?/commentary`, { body: 'あ'.repeat(2001), 'cf-turnstile-response': 'test-pass' });
	expect(tooLong.status()).toBe(400);
});

test('基準2：書いた人は採決の締切まで直せ、「直しました（日付）」と出る。締切のあとは直せない', async ({ browser }, info) => {
	test.setTimeout(150_000);
	const w = info.project.name as Width;
	const month = MONTHS.c2[w];
	const { e, bill, tag } = await setup(browser, w, month);
	await write(e.page, bill, `最初の解説 ${tag}`);
	await e.setNow(at(month, 20));
	await e.page.goto(bill);
	await hydrated(e.page);
	const s = section(e.page);
	await s.getByRole('button', { name: '解説を直す' }).click();
	await s.getByLabel('解説の内容').fill(`直した解説 ${tag}`);
	await posted(e.page, () => s.getByRole('button', { name: '解説を送る' }).click());
	await e.page.goto(bill);
	await expect(s).toContainText(`直した解説 ${tag}`);
	await expect(s).not.toContainText(`最初の解説 ${tag}`);
	await expect(s).toContainText(`直しました（${jaDay(month, 20)}）`);
	// 次の月の1日（採決の締切のあと）
	await e.setNow(at(nextMonth(month), 1));
	await e.page.goto(bill);
	await expect(s.getByRole('button', { name: '解説を直す' })).toHaveCount(0);
	expect((await post(e.page, `${bill}?/commentary`, { body: `締切のあと ${tag}`, 'cf-turnstile-response': 'test-pass' })).status()).toBe(409);
});

test('基準3：だれでも見られる。立場と評価のボタンは出さない。解説がなければ「まだ解説はありません」', async ({ browser }, info) => {
	test.setTimeout(150_000);
	const w = info.project.name as Width;
	const month = MONTHS.c3[w];
	const { e, expert, bill, tag } = await setup(browser, w, month);
	const viewer = await user(browser, w, 'anon', at(month, 11));
	await viewer.page.goto(bill);
	await expect(section(viewer.page)).toContainText('まだ解説はありません');
	await write(e.page, bill, `だれでも見られる解説 ${tag}`);
	await viewer.page.goto(bill);
	const s = section(viewer.page);
	await expect(s).toContainText(`だれでも見られる解説 ${tag}`);
	await expect(s).toContainText(expert);
	await expect(s.getByRole('button', { name: /筋が通っている|考えが変わった/ })).toHaveCount(0);
	await expect(s).not.toContainText(/賛成寄り|反対寄り/);
});

test('基準4：有識者でない人には書く欄を出さず、送っても断る。発議の前の法案には書けない', async ({ browser }, info) => {
	test.setTimeout(150_000);
	const w = info.project.name as Width;
	const month = MONTHS.c4[w];
	const { a, op, e, bill, solutionId, tag } = await setup(browser, w, month);
	const g = await user(browser, w, 'g', at(month, 10));
	const p = await user(browser, w, 'p', at(month, 10));
	await grant(op.page, p.name, '議員');
	for (const u of [g, p]) {
		await u.page.goto(bill);
		await expect(section(u.page).getByLabel('解説の内容')).toHaveCount(0);
		expect((await post(u.page, `${bill}?/commentary`, { body: `一般の人の解説 ${tag}`, 'cf-turnstile-response': 'test-pass' })).status()).toBe(403);
	}
	// 発議の前の法案（下書き）
	const draft = await createAmendBill(a.page, `下書きの法案 ${tag}`, solutionId);
	await e.page.goto(draft);
	await expect(section(e.page).getByLabel('解説の内容')).toHaveCount(0);
	expect((await post(e.page, `${draft}?/commentary`, { body: `下書きへの解説 ${tag}`, 'cf-turnstile-response': 'test-pass' })).status()).toBe(409);
});

test('基準5：3人の通報で一時的に見えなくなり、運営が表示に戻せる。運営の記録に残る', async ({ browser }, info) => {
	test.setTimeout(150_000);
	const w = info.project.name as Width;
	const month = MONTHS.c5[w];
	const { op, e, bill, tag } = await setup(browser, w, month);
	const body = `通報される解説 ${tag}`;
	await write(e.page, bill, body);
	for (const who of ['r1', 'r2', 'r3']) {
		const r = await user(browser, w, who, at(month, 11));
		await r.page.goto(bill);
		await hydrated(r.page);
		const article = section(r.page).getByRole('article').filter({ hasText: body });
		await article.getByRole('button', { name: '通報する' }).click();
		await article.getByRole('radio', { name: '宣伝・荒らし' }).check();
		await posted(r.page, () => article.getByRole('button', { name: '通報を送る' }).click());
	}
	const viewer = await user(browser, w, 'anon', at(month, 11));
	await viewer.page.goto(bill);
	await expect(section(viewer.page)).not.toContainText(body);

	await op.setNow(at(month, 11));
	await op.page.goto('/kanri');
	await hydrated(op.page);
	const reported = op.page.getByRole('region', { name: '通報を受けた専門家の解説' }).getByRole('article').filter({ hasText: body });
	await reported.getByLabel('表示に戻すメモ').fill('問題のない解説');
	await posted(op.page, () => reported.getByRole('button', { name: '表示に戻す' }).click());
	await viewer.page.goto(bill);
	await expect(section(viewer.page)).toContainText(body);
	await viewer.page.goto('/unei');
	await expect(viewer.page.getByRole('main')).toContainText('専門家の解説');
});

test('基準6：立候補した有識者は、選挙の期間中は解説を書けず、名前とバッジを出さない', async ({ browser }, info) => {
	test.setTimeout(150_000);
	const w = info.project.name as Width;
	const month = MONTHS.c6[w];
	const { op, e, expert, bill, tag } = await setup(browser, w, month);
	const body = `選挙の前の解説 ${tag}`;
	await write(e.page, bill, body);
	// 選挙を登録し、E に立候補の印を付ける（12日〜18日）
	await op.setNow(at(month, 11));
	await op.page.goto('/kanri');
	await hydrated(op.page);
	const elections = op.page.getByRole('region', { name: '選挙期間' });
	const electionName = `解説の選挙 ${tag}`;
	await elections.getByLabel('選挙の名前').fill(electionName);
	await elections.getByLabel('公示日').fill(`${month}-12`);
	await elections.getByLabel('投票日').fill(`${month}-18`);
	await posted(op.page, () => elections.getByRole('button', { name: '選挙を登録する' }).click());
	await op.page.goto('/kanri');
	const item = elections.getByRole('listitem').filter({ hasText: electionName });
	await item.getByLabel('立候補した有識者の表示名').fill(e.name);
	await posted(op.page, () => item.getByRole('button', { name: '印を付ける' }).click());

	await e.setNow(at(month, 15));
	await e.page.goto(bill);
	await expect(section(e.page)).toContainText('選挙期間中は、解説を書けません');
	await expect(section(e.page).getByRole('button', { name: '解説を直す' })).toHaveCount(0);
	expect((await post(e.page, `${bill}?/commentary`, { body: `選挙の中の解説 ${tag}`, 'cf-turnstile-response': 'test-pass' })).status()).toBe(403);
	const viewer = await user(browser, w, 'anon', at(month, 15));
	await viewer.page.goto(bill);
	await expect(section(viewer.page)).toContainText(body);
	await expect(section(viewer.page)).not.toContainText(expert);
	await expect(section(viewer.page)).not.toContainText('有識者（消費者法）');
});
