// Issue #153：答弁イベントの告知と一覧。質問と答弁は #181
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { ORIGIN, billSupportRequest, createAmendBill, issueWithSolutions, loginAs, proposeRequest, stubTurnstile } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});

test.use({ actionTimeout: 15_000 });

type Width = 'sp' | 'pc';
/** 基準ごと・幅ごとの月（選挙の期間がほかの基準とぶつからないように） */
const MONTHS: Record<string, Record<Width, string>> = {
	c1: { sp: '2049-01', pc: '2049-02' },
	c2: { sp: '2049-03', pc: '2049-04' },
	c3: { sp: '2049-05', pc: '2049-06' },
	c4: { sp: '2049-07', pc: '2049-08' },
	c5: { sp: '2049-09', pc: '2049-10' },
	c6: { sp: '2049-11', pc: '2049-12' },
	c7: { sp: '2050-01', pc: '2050-02' }
};
const at = (month: string, day: number, time = '09:00') => `${month}-${String(day).padStart(2, '0')}T${time}:00+09:00`;
const local = (month: string, day: number, time: string) => `${month}-${String(day).padStart(2, '0')}T${time}`;

type User = { page: Page; name: string; setNow: (now: string) => Promise<void> };

let serial = 0;
async function user(browser: Browser, w: Width, who: string, now: string, role?: 'operator'): Promise<User> {
	const n = ++serial;
	const headers = { 'x-test-ip': `10.153.${w === 'sp' ? 1 : 2}.${n % 250}` };
	const context = await browser.newContext({ baseURL: ORIGIN, extraHTTPHeaders: { ...headers, 'x-test-now': now } });
	contexts.push(context);
	const page = await context.newPage();
	await stubTurnstile(page);
	const name = `${who}${w}${Date.now() % 1e7}${n}`;
	if (who !== 'anon') await loginAs(page, name, 8, role);
	return { page, name, setNow: (t) => context.setExtraHTTPHeaders({ ...headers, 'x-test-now': t }) };
}

const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });

async function posted(u: Page, act: () => Promise<void>) {
	await Promise.all([u.waitForResponse((r) => r.request().method() === 'POST'), act()]);
	await u.waitForLoadState('networkidle');
}

/** 運営の画面で認証を付ける。表示する名前を返す */
async function grant(op: Page, target: string) {
	const name = `答弁 議員${target.slice(-6)}`;
	await op.goto('/kanri');
	await hydrated(op);
	const s = op.getByRole('region', { name: '議員・有識者の認証' });
	await s.getByLabel('表示名').fill(target);
	await s.getByRole('group', { name: '種類' }).getByRole('radio', { name: '議員', exact: true }).check();
	await s.getByLabel('表示する名前').fill(name);
	await posted(op, () => s.getByRole('button', { name: '認証を付ける' }).click());
	await op.goto('/kanri');
	await expect(s.getByRole('listitem').filter({ hasText: target })).toHaveCount(1);
	return name;
}

/** 3日に A が課題を書き、P を議員にする */
async function setup(browser: Browser, w: Width, month: string) {
	const now = at(month, 3);
	const a = await user(browser, w, 'a', now);
	const tag = `${w}${Date.now() % 1e7}`;
	const { issueId, ids, title } = await issueWithSolutions(a.page, `153-${tag}`, [`解決策 ${tag}`]);
	const op = await user(browser, w, 'op', now, 'operator');
	const p = await user(browser, w, 'p', now);
	const name = await grant(op.page, p.name);
	return { a, op, p, name, issueId, solutionId: ids[0], issueTitle: title, tag };
}

/** 告知の画面で告知する（ダッシュボードから入る） */
async function announce(p: Page, f: { kind: '課題' | '法案'; id: number | string; title: string; starts: string; ends: string }) {
	await p.goto('/giin');
	await p.getByRole('link', { name: '答弁イベントを告知する' }).click();
	await expect(p).toHaveURL(/\/toben\/kaku$/);
	await hydrated(p);
	await p.getByRole('group', { name: '対象' }).getByRole('radio', { name: f.kind, exact: true }).check();
	await p.getByLabel('対象の番号').fill(String(f.id));
	await p.getByLabel('題', { exact: true }).fill(f.title);
	await p.getByLabel('開始').fill(f.starts);
	await p.getByLabel('終了').fill(f.ends);
	await posted(p, () => p.getByRole('button', { name: '告知する' }).click());
}

const section = (page: Page, name: string) => page.getByRole('region', { name });
const post = (page: Page, path: string, form: Record<string, string>) =>
	page.request.post(path, { form, headers: { origin: ORIGIN, accept: 'text/html' }, maxRedirects: 0 });

test('基準1：議員はダッシュボードから告知できる。終了は開始から2時間まで、開始は3日以上あと。おかしな入力は断る', async ({ browser }, info) => {
	test.setTimeout(150_000);
	const w = info.project.name as Width;
	const month = MONTHS.c1[w];
	const { p, issueId, tag } = await setup(browser, w, month);
	const alert = () => p.page.getByRole('main').getByRole('alert');
	await announce(p.page, { kind: '課題', id: issueId, title: `長すぎる回 ${tag}`, starts: local(month, 10, '14:00'), ends: local(month, 10, '16:30') });
	await expect(alert()).toHaveText('終了は開始から2時間までにしてください');
	await announce(p.page, { kind: '課題', id: issueId, title: `近すぎる回 ${tag}`, starts: local(month, 5, '14:00'), ends: local(month, 5, '15:00') });
	await expect(alert()).toHaveText('開始は告知の3日あと以降にしてください');
	await announce(p.page, { kind: '課題', id: 99999999, title: `ない課題の回 ${tag}`, starts: local(month, 10, '14:00'), ends: local(month, 10, '15:00') });
	await expect(alert()).toHaveText('対象の課題・法案が見つかりません');
	await announce(p.page, { kind: '課題', id: issueId, title: '', starts: local(month, 10, '14:00'), ends: local(month, 10, '15:00') });
	await expect(alert()).toHaveText('題を入れてください');

	const title = `自転車の通行区分について答えます ${tag}`;
	await announce(p.page, { kind: '課題', id: issueId, title, starts: local(month, 10, '14:00'), ends: local(month, 10, '16:00') });
	await expect(p.page).toHaveURL(/\/toben\/\d+$/);
	await expect(p.page.getByRole('heading', { level: 1 })).toHaveText(title);
});

test('基準2：/toben の一覧は「これから」「開催中」「終わった」に分かれ、題・議員・対象・日時を出す', async ({ browser }, info) => {
	test.setTimeout(150_000);
	const w = info.project.name as Width;
	const month = MONTHS.c2[w];
	const { p, name, issueId, issueTitle, tag } = await setup(browser, w, month);
	const title = `一覧の回 ${tag}`;
	await announce(p.page, { kind: '課題', id: issueId, title, starts: local(month, 10, '14:00'), ends: local(month, 10, '15:00') });
	const viewer = await user(browser, w, 'anon', at(month, 4));
	const row = (part: string) => section(viewer.page, part).getByRole('listitem').filter({ hasText: title });
	await viewer.page.goto('/toben');
	await expect(row('これから')).toContainText(name);
	await expect(row('これから')).toContainText('認証済み議員');
	await expect(row('これから').getByRole('link', { name: issueTitle })).toHaveAttribute('href', `/kadai/${issueId}`);
	await expect(row('これから')).toContainText(`${Number(month.slice(0, 4))}年${Number(month.slice(5))}月10日 14時00分`);
	await viewer.setNow(at(month, 10, '14:30'));
	await viewer.page.goto('/toben');
	await expect(row('開催中')).toHaveCount(1);
	await expect(row('これから')).toHaveCount(0);
	await viewer.setNow(at(month, 10, '15:00'));
	await viewer.page.goto('/toben');
	await expect(row('終わった')).toHaveCount(1);
	await expect(row('開催中')).toHaveCount(0);
});

test('基準3：イベントのページに題・議員・対象へのリンク・日時・いまの状態', async ({ browser }, info) => {
	test.setTimeout(150_000);
	const w = info.project.name as Width;
	const month = MONTHS.c3[w];
	const { p, name, issueId, issueTitle, tag } = await setup(browser, w, month);
	const title = `ページの回 ${tag}`;
	await announce(p.page, { kind: '課題', id: issueId, title, starts: local(month, 10, '14:00'), ends: local(month, 10, '15:00') });
	await expect(p.page).toHaveURL(/\/toben\/\d+$/);
	const path = new URL(p.page.url()).pathname;
	const viewer = await user(browser, w, 'anon', at(month, 4));
	const main = viewer.page.getByRole('main');
	await viewer.page.goto(path);
	await expect(viewer.page.getByRole('heading', { level: 1 })).toHaveText(title);
	await expect(main).toContainText(name);
	await expect(main.getByRole('link', { name: issueTitle })).toHaveAttribute('href', `/kadai/${issueId}`);
	await expect(main).toContainText('告知中');
	await viewer.setNow(at(month, 10, '14:30'));
	await viewer.page.goto(path);
	await expect(main).toContainText('開催中');
	await viewer.setNow(at(month, 10, '15:01'));
	await viewer.page.goto(path);
	await expect(main).toContainText('終わりました');
	expect((await viewer.page.request.get('/toben/99999999')).status()).toBe(404);
});

test('基準4：課題のページと法案のページに、これからと開催中の答弁イベントを出す', async ({ browser }, info) => {
	test.setTimeout(180_000);
	const w = info.project.name as Width;
	const month = MONTHS.c4[w];
	const { a, p, issueId, solutionId, tag } = await setup(browser, w, month);
	// 法案を発議しておく（3日）
	const bill = await createAmendBill(a.page, `答弁の法案 ${tag}`, solutionId);
	for (const who of ['b', 'c', 'd']) {
		const s = await user(browser, w, who, at(month, 3));
		expect((await billSupportRequest(s.page, bill, { op: 'add', rev: '1' })).status()).toBe(200);
	}
	expect((await proposeRequest(a.page, bill)).status()).toBe(200);
	const issueEvent = `課題の回 ${tag}`;
	const billEvent = `法案の回 ${tag}`;
	await announce(p.page, { kind: '課題', id: issueId, title: issueEvent, starts: local(month, 10, '14:00'), ends: local(month, 10, '15:00') });
	await announce(p.page, { kind: '法案', id: bill.replace('/houan/', ''), title: billEvent, starts: local(month, 11, '14:00'), ends: local(month, 11, '15:00') });
	const viewer = await user(browser, w, 'anon', at(month, 4));
	await viewer.page.goto(`/kadai/${issueId}`);
	await expect(section(viewer.page, '答弁イベント').getByRole('link', { name: issueEvent })).toHaveAttribute('href', /^\/toben\/\d+$/);
	await viewer.page.goto(bill);
	await expect(section(viewer.page, '答弁イベント').getByRole('link', { name: billEvent })).toBeVisible();
	// 終わったら出さない
	await viewer.setNow(at(month, 12));
	await viewer.page.goto(`/kadai/${issueId}`);
	await expect(section(viewer.page, '答弁イベント')).toHaveCount(0);
});

test('基準5：告知した議員は開始の前なら取り消せ、「取り消しました」と残る', async ({ browser }, info) => {
	test.setTimeout(150_000);
	const w = info.project.name as Width;
	const month = MONTHS.c5[w];
	const { p, issueId, tag } = await setup(browser, w, month);
	const title = `取り消す回 ${tag}`;
	await announce(p.page, { kind: '課題', id: issueId, title, starts: local(month, 10, '14:00'), ends: local(month, 10, '15:00') });
	await expect(p.page).toHaveURL(/\/toben\/\d+$/);
	const path = new URL(p.page.url()).pathname;
	await posted(p.page, () => p.page.getByRole('button', { name: '取り消す' }).click());
	await p.page.goto(path);
	await expect(p.page.getByRole('main')).toContainText('取り消しました');
	await p.page.goto('/toben');
	await expect(section(p.page, '終わった').getByRole('listitem').filter({ hasText: title })).toContainText('取り消しました');
	// 開始のあとは取り消せない
	const other = `取り消せない回 ${tag}`;
	await announce(p.page, { kind: '課題', id: issueId, title: other, starts: local(month, 10, '16:00'), ends: local(month, 10, '17:00') });
	await expect(p.page).toHaveURL(/\/toben\/\d+$/);
	const otherPath = new URL(p.page.url()).pathname;
	await p.setNow(at(month, 10, '16:30'));
	await p.page.goto(otherPath);
	await expect(p.page.getByRole('button', { name: '取り消す' })).toHaveCount(0);
	expect((await post(p.page, `${otherPath}?/cancel`, {})).status()).toBe(409);
});

test('基準6：選挙期間にかかるイベントは告知できず、告知のあとで選挙が登録されたら「選挙期間のため中止」。期間中の議員は告知できない', async ({ browser }, info) => {
	test.setTimeout(180_000);
	const w = info.project.name as Width;
	const month = MONTHS.c6[w];
	const { op, p, name, issueId, tag } = await setup(browser, w, month);
	// 先に告知した回（20日）
	const before = `選挙の前に告知した回 ${tag}`;
	await announce(p.page, { kind: '課題', id: issueId, title: before, starts: local(month, 20, '14:00'), ends: local(month, 20, '15:00') });
	await expect(p.page).toHaveURL(/\/toben\/\d+$/);
	const path = new URL(p.page.url()).pathname;
	// 選挙を登録する（15日〜25日）
	await op.page.goto('/kanri');
	await hydrated(op.page);
	const elections = section(op.page, '選挙期間');
	await elections.getByLabel('選挙の名前').fill(`答弁の選挙 ${tag}`);
	await elections.getByLabel('公示日').fill(`${month}-15`);
	await elections.getByLabel('投票日').fill(`${month}-25`);
	await posted(op.page, () => elections.getByRole('button', { name: '選挙を登録する' }).click());
	// 期間にかかる回は告知できない
	await announce(p.page, { kind: '課題', id: issueId, title: `期間にかかる回 ${tag}`, starts: local(month, 16, '14:00'), ends: local(month, 16, '15:00') });
	await expect(p.page.getByRole('main').getByRole('alert')).toHaveText('選挙期間にかかるので告知できません');
	// 先に告知した回は中止と出る（名前は出さない）
	const viewer = await user(browser, w, 'anon', at(month, 16));
	await viewer.page.goto(path);
	await expect(viewer.page.getByRole('main')).toContainText('選挙期間のため中止');
	await expect(viewer.page.getByRole('main')).not.toContainText(name);
	await viewer.page.goto('/toben');
	await expect(viewer.page.getByRole('main').getByRole('listitem').filter({ hasText: before })).toContainText('選挙期間のため中止');
	// 期間中の議員は告知できない
	await p.setNow(at(month, 16));
	expect((await post(p.page, '/toben/kaku', { kind: 'issue', target: String(issueId), title: `期間中の告知 ${tag}`, starts: local(month, 28, '14:00'), ends: local(month, 28, '15:00') })).status()).toBe(403);
});

test('基準7：告知と取り消しは議員だけ。ほかの人には出さず、送っても断る', async ({ browser }, info) => {
	test.setTimeout(150_000);
	const w = info.project.name as Width;
	const month = MONTHS.c7[w];
	const { op, p, issueId, tag } = await setup(browser, w, month);
	const title = `議員だけの回 ${tag}`;
	await announce(p.page, { kind: '課題', id: issueId, title, starts: local(month, 10, '14:00'), ends: local(month, 10, '15:00') });
	await expect(p.page).toHaveURL(/\/toben\/\d+$/);
	const path = new URL(p.page.url()).pathname;
	const g = await user(browser, w, 'g', at(month, 4));
	const q = await user(browser, w, 'q', at(month, 4));
	await grant(op.page, q.name);
	expect((await g.page.goto('/toben/kaku'))?.status()).toBe(404);
	// 告知の画面は議員でない人には存在しない扱い（操作が断ったあと、画面の読み込みが 404 を返す）。告知はできていない
	const refused = `一般の人の告知 ${tag}`;
	expect((await post(g.page, '/toben/kaku', { kind: 'issue', target: String(issueId), title: refused, starts: local(month, 10, '14:00'), ends: local(month, 10, '15:00') })).status()).toBe(404);
	await g.page.goto('/toben');
	await expect(g.page.getByRole('main')).not.toContainText(refused);
	// ほかの議員は取り消せない
	for (const u of [g, q]) {
		await u.page.goto(path);
		await expect(u.page.getByRole('button', { name: '取り消す' })).toHaveCount(0);
		expect((await post(u.page, `${path}?/cancel`, {})).status()).toBe(403);
	}
});
