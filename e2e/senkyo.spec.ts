// Issue #151：選挙期間の登録と、議員の機能の自動停止。期間の計算は src/lib/domain/election.test.ts。
// 選挙はサイト全体に効くので、テストごと・幅ごとに別の月（2046年）を使い、ほかのテストの議員とぶつからないようにする
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { ORIGIN, billSupportRequest, createAmendBill, issueWithSolutions, loginAs, proposeRequest, stubTurnstile } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});

test.use({ actionTimeout: 15_000 });

type Width = 'sp' | 'pc';
/** 基準ごと・幅ごとの月 */
const MONTHS: Record<string, Record<Width, string>> = {
	c1: { sp: '2046-01', pc: '2046-02' },
	c2: { sp: '2046-03', pc: '2046-04' },
	c3: { sp: '2046-05', pc: '2046-06' },
	c4: { sp: '2046-07', pc: '2046-08' },
	c5: { sp: '2046-09', pc: '2046-10' },
	c6: { sp: '2046-11', pc: '2046-12' }
};
const at = (month: string, day: number, time = '09:00') => `${month}-${String(day).padStart(2, '0')}T${time}:00+09:00`;
const date = (month: string, day: number) => `${month}-${String(day).padStart(2, '0')}`;
const jaDay = (month: string, day: number) => `${Number(month.slice(0, 4))}年${Number(month.slice(5))}月${day}日`;
const STOPPED = '選挙期間中は、議員の機能が止まっています';
const HIDDEN = '議員（選挙期間中のため名前を出していません）';

type User = { page: Page; name: string; setNow: (now: string) => Promise<void> };

let serial = 0;
async function user(browser: Browser, w: Width, who: string, now: string, role?: 'operator' | 'moderator'): Promise<User> {
	const n = ++serial;
	const headers = { 'x-test-ip': `10.151.${w === 'sp' ? 1 : 2}.${n % 250}` };
	const context = await browser.newContext({ baseURL: ORIGIN, extraHTTPHeaders: { ...headers, 'x-test-now': now } });
	contexts.push(context);
	const page = await context.newPage();
	await stubTurnstile(page);
	const name = `${who}${w}${Date.now() % 1e7}${n}`;
	if (who !== 'anon') await loginAs(page, name, 8, role);
	return { page, name, setNow: (t) => context.setExtraHTTPHeaders({ ...headers, 'x-test-now': t }) };
}

const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });

/** 書き込みの応答が返り、読み直しが終わるまで待つ */
async function posted(u: Page, act: () => Promise<void>) {
	await Promise.all([u.waitForResponse((r) => r.request().method() === 'POST'), act()]);
	await u.waitForLoadState('networkidle');
}

/** 運営の画面で認証を付ける。表示する名前を返す */
async function grant(op: Page, target: string, kind: '議員' | '有識者', field = '') {
	const name = `${kind === '議員' ? '選挙 議員' : '選挙 教授'}${target.slice(-6)}`;
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

const electionSection = (page: Page) => page.getByRole('region', { name: '選挙期間' });

/** 運営の画面で選挙を登録する */
async function register(op: Page, name: string, notice: string, vote: string) {
	await op.goto('/kanri');
	await hydrated(op);
	const s = electionSection(op);
	await s.getByLabel('選挙の名前').fill(name);
	await s.getByLabel('公示日').fill(notice);
	await s.getByLabel('投票日').fill(vote);
	await posted(op, () => s.getByRole('button', { name: '選挙を登録する' }).click());
}

/** 課題を書いた人 A と、議員 P */
async function setup(browser: Browser, w: Width, month: string, day = 3) {
	const now = at(month, day);
	const a = await user(browser, w, 'a', now);
	const tag = `${w}${Date.now() % 1e7}`;
	const { issueId, ids, title } = await issueWithSolutions(a.page, `151-${tag}`, [`解決策 ${tag}`]);
	const op = await user(browser, w, 'op', now, 'operator');
	const p = await user(browser, w, 'p', now);
	const name = await grant(op.page, p.name, '議員');
	return { a, op, p, name, issueId, solutionId: ids[0], title, tag };
}

const reactions = (page: Page) => page.getByRole('region', { name: '議員の反応' });
const post = (page: Page, path: string, form: Record<string, string>) =>
	page.request.post(path, { form, headers: { origin: ORIGIN, accept: 'text/html' }, maxRedirects: 0 });

test('基準1：運営が選挙を登録し、一覧に出て、始まる前なら取り消せる。おかしな入力と運営以外は断る', async ({ browser }, info) => {
	test.setTimeout(120_000);
	const w = info.project.name as Width;
	const month = MONTHS.c1[w];
	const op = await user(browser, w, 'op1', at(month, 1), 'operator');
	const tag = `${w}${Date.now() % 1e7}`;
	const name = `試験の総選挙 ${tag}`;
	await register(op.page, name, date(month, 10), date(month, 20));
	const item = electionSection(op.page).getByRole('listitem').filter({ hasText: name });
	await expect(item).toContainText(`${jaDay(month, 10)}〜${jaDay(month, 20)}`);

	await register(op.page, `逆の選挙 ${tag}`, date(month, 20), date(month, 10));
	await expect(electionSection(op.page).getByRole('alert')).toHaveText('投票日は公示日と同じか、あとの日にしてください');
	await register(op.page, '', date(month, 10), date(month, 20));
	await expect(electionSection(op.page).getByRole('alert')).toHaveText('選挙の名前を入れてください');

	await op.page.goto('/kanri');
	await posted(op.page, () => item.getByRole('button', { name: '取り消す' }).click());
	await op.page.goto('/kanri');
	await expect(item).toHaveCount(0);

	const mod = await user(browser, w, 'mod1', at(month, 1), 'moderator');
	await mod.page.goto('/kanri');
	await expect(electionSection(mod.page)).toHaveCount(0);
	expect((await post(mod.page, '/kanri?/electionAdd', { name: `運営協力者の選挙 ${tag}`, notice: date(month, 10), vote: date(month, 20) })).status()).toBe(404);
});

test('基準2：公示日の 0時から投票日の終わりまでが選挙期間', async ({ browser }, info) => {
	test.setTimeout(120_000);
	const w = info.project.name as Width;
	const month = MONTHS.c2[w];
	const { op, p } = await setup(browser, w, month);
	await register(op.page, `境目の選挙 ${w}${Date.now() % 1e7}`, date(month, 10), date(month, 20));
	const stopped = async (now: string) => {
		await p.setNow(now);
		await p.page.goto('/giin');
		return (await p.page.getByText(STOPPED).count()) > 0;
	};
	expect(await stopped(at(month, 9, '23:59')), '公示日の前').toBe(false);
	expect(await stopped(at(month, 10, '00:00')), '公示日の 0時').toBe(true);
	expect(await stopped(at(month, 20, '23:59')), '投票日の終わり').toBe(true);
	expect(await stopped(at(month, 21, '00:00')), '投票日の翌日').toBe(false);
});

test('基準3：選挙期間中の議員は「拾った」と質疑ができない。ボタンの代わりに文言を出し、送っても断る', async ({ browser }, info) => {
	test.setTimeout(150_000);
	const w = info.project.name as Width;
	const month = MONTHS.c3[w];
	const { a, op, p, issueId, solutionId, tag } = await setup(browser, w, month, 5);
	// 質疑のために法案を発議しておく（5日）
	const bill = await createAmendBill(a.page, `選挙期間の法案 ${tag}`, solutionId);
	for (const who of ['b', 'c', 'd']) {
		const s = await user(browser, w, who, at(month, 5));
		expect((await billSupportRequest(s.page, bill, { op: 'add', rev: '1' })).status()).toBe(200);
	}
	expect((await proposeRequest(a.page, bill)).status()).toBe(200);
	await register(op.page, `止める選挙 ${tag}`, date(month, 10), date(month, 20));

	await p.setNow(at(month, 16));
	await p.page.goto('/giin');
	await expect(p.page.getByText(STOPPED).first()).toBeVisible();
	await expect(p.page.getByRole('button', { name: '検討中にする' })).toHaveCount(0);
	await p.page.goto(`/kadai/${issueId}`);
	await expect(reactions(p.page).getByText(STOPPED)).toBeVisible();
	await expect(reactions(p.page).getByRole('button')).toHaveCount(0);
	expect((await post(p.page, `/kadai/${issueId}?/hirotta`, { kind: 'considering', op: 'add' })).status()).toBe(403);
	// 質疑（16日は質疑の期間）
	await p.page.goto(`${bill}/shitsugi`);
	await expect(p.page.getByText(STOPPED).first()).toBeVisible();
	await expect(p.page.getByRole('link', { name: '質疑を書く' }).or(p.page.getByRole('button', { name: '質疑を書く' }))).toHaveCount(0);
	expect((await post(p.page, `${bill}/shitsugi/kaku`, { body: `選挙期間の質疑 ${tag}`, 'cf-turnstile-response': 'test-pass' })).status()).toBe(403);
});

test('基準4：選挙期間中は議員の名前をだれの画面にも出さない。反応は残す。本人のヘッダーには出す', async ({ browser }, info) => {
	test.setTimeout(150_000);
	const w = info.project.name as Width;
	const month = MONTHS.c4[w];
	const { a, op, p, name, issueId, solutionId, tag } = await setup(browser, w, month, 5);
	const bill = await createAmendBill(a.page, `名前を隠す法案 ${tag}`, solutionId);
	for (const who of ['b', 'c', 'd']) {
		const s = await user(browser, w, who, at(month, 5));
		expect((await billSupportRequest(s.page, bill, { op: 'add', rev: '1' })).status()).toBe(200);
	}
	expect((await proposeRequest(a.page, bill)).status()).toBe(200);
	// 5日に「検討中」、15日（質疑の期間）に質疑を書く。選挙は16日〜18日
	await p.page.goto(`/kadai/${issueId}`);
	await posted(p.page, () => reactions(p.page).getByRole('button', { name: '検討中にする' }).click());
	await p.setNow(at(month, 15));
	await p.page.goto(bill);
	await hydrated(p.page);
	await p.page.getByRole('navigation', { name: '法案のページ' }).getByRole('link', { name: /^質疑/ }).click();
	await p.page.getByRole('link', { name: '質疑を書く' }).or(p.page.getByRole('button', { name: '質疑を書く' })).first().click();
	const question = `選挙の前の質疑 ${tag}`;
	await p.page.getByLabel('質疑の内容').fill(question);
	await posted(p.page, () => p.page.getByRole('button', { name: '送る' }).click());
	await register(op.page, `名前の選挙 ${tag}`, date(month, 16), date(month, 18));

	const viewer = await user(browser, w, 'anon', at(month, 17));
	await viewer.page.goto(`/kadai/${issueId}`);
	await expect(reactions(viewer.page)).toContainText('検討中');
	await expect(reactions(viewer.page)).toContainText(HIDDEN);
	await expect(viewer.page.getByRole('main')).not.toContainText(name);
	await viewer.page.goto(`${bill}/shitsugi`);
	const card = viewer.page.locator('article').filter({ hasText: question });
	await expect(card).toContainText(HIDDEN);
	await expect(card).not.toContainText(name);
	// 本人のヘッダー（PC）・帯（スマホ）には出す
	await p.setNow(at(month, 17));
	await p.page.goto('/giin');
	await expect(p.page.getByText(new RegExp(`認証済み(議員)?・${name}`)).first()).toBeVisible();
});

test('基準5：立候補した有識者に印を付けると、その選挙の期間中は名前とバッジを出さない', async ({ browser }, info) => {
	test.setTimeout(150_000);
	const w = info.project.name as Width;
	const month = MONTHS.c5[w];
	const op = await user(browser, w, 'op5', at(month, 3), 'operator');
	const e = await user(browser, w, 'e5', at(month, 3));
	const expert = await grant(op.page, e.name, '有識者', '消費者法');
	const tag = `${w}${Date.now() % 1e7}`;
	const { ids } = await issueWithSolutions(e.page, `151e-${tag}`, [`解決策 ${tag}`]);
	const bill = await createAmendBill(e.page, `有識者の法案 ${tag}`, ids[0]);
	const electionName = `立候補の選挙 ${tag}`;
	await register(op.page, electionName, date(month, 10), date(month, 20));
	await op.page.goto('/kanri');
	const item = electionSection(op.page).getByRole('listitem').filter({ hasText: electionName });
	await item.getByLabel('立候補した有識者の表示名').fill(e.name);
	await posted(op.page, () => item.getByRole('button', { name: '印を付ける' }).click());
	await op.page.goto('/kanri');
	await expect(item).toContainText(expert);

	await e.setNow(at(month, 15));
	await e.page.goto(bill);
	await expect(e.page.getByRole('main')).not.toContainText(expert);
	await expect(e.page.getByRole('main')).not.toContainText('有識者（消費者法）');
	await e.setNow(at(month, 21));
	await e.page.goto(bill);
	await expect(e.page.getByRole('main')).toContainText(expert);
	await expect(e.page.getByRole('main')).toContainText('有識者（消費者法）');
});

test('基準6：投票日の翌日からは、止めたものと名前の表示が元に戻る', async ({ browser }, info) => {
	test.setTimeout(120_000);
	const w = info.project.name as Width;
	const month = MONTHS.c6[w];
	const { op, p, name, issueId } = await setup(browser, w, month);
	await p.page.goto(`/kadai/${issueId}`);
	await posted(p.page, () => reactions(p.page).getByRole('button', { name: '検討中にする' }).click());
	await register(op.page, `戻る選挙 ${w}${Date.now() % 1e7}`, date(month, 10), date(month, 20));
	const viewer = await user(browser, w, 'anon', at(month, 15));
	await viewer.page.goto(`/kadai/${issueId}`);
	await expect(reactions(viewer.page)).toContainText(HIDDEN);

	await viewer.setNow(at(month, 21, '00:00'));
	await viewer.page.goto(`/kadai/${issueId}`);
	await expect(reactions(viewer.page)).toContainText(`検討中：${name}（認証済み議員）`);
	await expect(reactions(viewer.page)).not.toContainText(HIDDEN);
	await p.setNow(at(month, 21, '00:00'));
	await p.page.goto(`/kadai/${issueId}`);
	await expect(reactions(p.page).getByRole('button', { name: '検討中を外す' })).toBeVisible();
	expect((await post(p.page, `/kadai/${issueId}?/hirotta`, { kind: 'considering', op: 'remove' })).status()).toBe(200);
});
