// Issue #157：議員・有識者の認証（設計書 docs/spec/157.md）。期限の計算と、委員長・理事に付けさせないことは src/lib/domain/verification.test.ts
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { ORIGIN, billSupportRequest, createAmendBill, issueWithSolutions, loginAs, proposeRequest, stubTurnstile } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});

type Width = 'sp' | 'pc';
/** 幅ごとに別の月を使う（法案の発議と質疑の期間がぶつからないように） */
const MONTH = { sp: { first: '2037-05', second: '2037-06' }, pc: { first: '2037-08', second: '2037-09' } } as const;
const at = (month: string, day: number) => `${month}-${String(day).padStart(2, '0')}T09:00:00+09:00`;
/** month の年を n 年進める */
const plusYears = (month: string, n: number) => `${Number(month.slice(0, 4)) + n}${month.slice(4)}`;
/** 「2038年5月3日まで」 */
const until = (month: string, day: number) => `${Number(month.slice(0, 4))}年${Number(month.slice(5))}月${day}日まで`;

type User = { page: Page; name: string; setNow: (now: string) => Promise<void> };

let serial = 0;
/** サーバーの「いま」を x-test-now で決めた利用者 */
async function user(browser: Browser, w: Width, who: string, now: string, role?: 'moderator' | 'operator'): Promise<User> {
	const n = ++serial;
	const headers = { 'x-test-ip': `10.157.${w === 'sp' ? 1 : 2}.${n % 250}` };
	const context = await browser.newContext({ baseURL: ORIGIN, extraHTTPHeaders: { ...headers, 'x-test-now': now } });
	contexts.push(context);
	const page = await context.newPage();
	await stubTurnstile(page);
	const name = `${who}${w}${Date.now() % 1e7}${n}`;
	await loginAs(page, name, 8, role);
	return { page, name, setNow: (t) => context.setExtraHTTPHeaders({ ...headers, 'x-test-now': t }) };
}

const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
const section = (page: Page) => page.getByRole('region', { name: '議員・有識者の認証' });

/** 書き込みの応答が返るまで待つ。ok なら成功の応答であることも確かめる（断るときは理由の文で確かめる） */
async function posted(u: Page, act: () => Promise<void>, ok = true) {
	// 質疑のタブの「読んだ」の POST（?/read）は待たない
	const [res] = await Promise.all([u.waitForResponse((r) => r.request().method() === 'POST' && !r.url().includes('?/read')), act()]);
	if (ok) expect(res.status()).toBeLessThan(400);
}

/** 運営の画面で認証を付ける */
async function grant(op: Page, target: string, kind: '議員' | '有識者', name: string, field = '') {
	await op.goto('/kanri');
	await hydrated(op);
	const s = section(op);
	await s.getByLabel('表示名').fill(target);
	await s.getByRole('group', { name: '種類' }).getByRole('radio', { name: kind, exact: true }).check();
	await s.getByLabel('表示する名前').fill(name);
	if (field) await s.getByLabel('専門分野').fill(field);
	await posted(op, () => s.getByRole('button', { name: '認証を付ける' }).click(), false);
}

/** 一覧のその人の行 */
const listed = (op: Page, name: string) => section(op).getByRole('listitem').filter({ hasText: name });

/** 運営の画面の操作と同じ POST */
const verifyRequest = (page: Page, action: string, form: Record<string, string>) =>
	page.request.post(`/kanri?/${action}`, { form, headers: { origin: ORIGIN, accept: 'text/html' }, maxRedirects: 0 });

test('基準1：運営が表示名で選んで付ける。ない表示名・運営協力者・認証のある人には理由を出して付けない', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const now = at(MONTH[w].first, 3);
	const op = await user(browser, w, 'op1', now, 'operator');
	const p = await user(browser, w, 'p1', now);
	const mod = await user(browser, w, 'mod1', now, 'moderator');
	const name = `試験 太郎 ${p.name}`;

	await grant(op.page, p.name, '議員', name);
	await expect(listed(op.page, name)).toContainText('議員');

	await grant(op.page, `いない人${p.name}`, '議員', '架空 花子');
	await expect(section(op.page).getByRole('alert')).toHaveText('その表示名の利用者はいません');
	await grant(op.page, mod.name, '議員', '架空 花子');
	await expect(section(op.page).getByRole('alert')).toHaveText('運営・運営協力者のアカウントには付けられません');
	await grant(op.page, p.name, '有識者', '大学教授', '民法');
	await expect(section(op.page).getByRole('alert')).toHaveText('すでに認証があります');
	await expect(listed(op.page, name)).toHaveCount(1);
	// 有識者は専門分野が要る
	const q = await user(browser, w, 'q1', now);
	await grant(op.page, q.name, '有識者', '大学教授');
	await expect(section(op.page).getByRole('alert')).toHaveText('有識者は専門分野を入れてください');
	// 形の違う入力を送っても付かない（ほかの種類、空の名前）
	for (const form of [
		{ target: q.name, kind: 'admin', name: '架空 花子', field: '' },
		{ target: q.name, kind: 'legislator', name: '   ', field: '' }
	]) {
		const res = await verifyRequest(op.page, 'verifyGrant', form);
		expect(res.status(), form.kind).toBe(400);
	}
	await op.page.goto('/kanri');
	await expect(section(op.page).getByRole('listitem').filter({ hasText: '架空 花子' })).toHaveCount(0);
	await expect(listed(op.page, q.name)).toHaveCount(0);
});

test('基準2：欄は運営にだけ出す。運営協力者と一般の利用者が送っても 404', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const now = at(MONTH[w].first, 3);
	const mod = await user(browser, w, 'mod2', now, 'moderator');
	const p = await user(browser, w, 'p2', now);
	// 運営には出て、送れる（下の 404 が「操作がない」ためではないことを確かめる）
	const op = await user(browser, w, 'op2', now, 'operator');
	await op.page.goto('/kanri');
	await expect(section(op.page)).toBeVisible();
	expect((await verifyRequest(op.page, 'verifyGrant', { target: `いない人${p.name}`, kind: 'legislator', name: '試験 次郎' })).status()).not.toBe(404);

	const res = await mod.page.goto('/kanri');
	expect(res?.status()).toBe(200);
	await expect(section(mod.page)).toHaveCount(0);
	await expect(mod.page.getByRole('main')).not.toContainText('議員・有識者の認証');
	const form = { target: p.name, kind: 'legislator', name: '試験 次郎' };
	for (const u of [mod, p]) for (const action of ['verifyGrant', 'verifyRenew', 'verifyRevoke']) expect((await verifyRequest(u.page, action, form)).status(), `${action}`).toBe(404);
});

test('基準3：期限が出る。延ばすと延ばした日から1年、取り消すと消えて付け直せる。期限が切れると一覧から消える', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const month = MONTH[w].first;
	const op = await user(browser, w, 'op3', at(month, 3), 'operator');
	const p = await user(browser, w, 'p3', at(month, 3));
	const name = `試験 三郎 ${p.name}`;
	await grant(op.page, p.name, '議員', name);
	await expect(listed(op.page, name)).toContainText(until(plusYears(month, 1), 3));

	// 3か月たってから延ばす
	const later = `${month.slice(0, 4)}-${String(Number(month.slice(5)) + 3).padStart(2, '0')}`;
	await op.setNow(at(later, 10));
	await op.page.goto('/kanri');
	await posted(op.page, () => listed(op.page, name).getByRole('button', { name: '1年延ばす' }).click());
	await op.page.goto('/kanri');
	await expect(listed(op.page, name)).toContainText(until(plusYears(later, 1), 10));

	await posted(op.page, () => listed(op.page, name).getByRole('button', { name: '取り消す' }).click());
	await op.page.goto('/kanri');
	await expect(listed(op.page, name)).toHaveCount(0);
	await grant(op.page, p.name, '議員', name);
	await expect(listed(op.page, name)).toContainText(until(plusYears(later, 1), 10));

	// 期限（1年後の同じ日付）の終わりまでは一覧にあり、翌日には消える
	await op.setNow(at(plusYears(later, 1), 10));
	await op.page.goto('/kanri');
	await expect(listed(op.page, name)).toHaveCount(1);
	await op.setNow(at(plusYears(later, 1), 11));
	await op.page.goto('/kanri');
	await expect(listed(op.page, name)).toHaveCount(0);
});

test('基準4：付けた・延ばした・取り消したを、運営の記録に種類・名前・日付で出す', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const month = MONTH[w].first;
	const op = await user(browser, w, 'op4', at(month, 4), 'operator');
	const p = await user(browser, w, 'p4', at(month, 4));
	const name = `大学教授 ${p.name}`;
	await grant(op.page, p.name, '有識者', name, '消費者法');
	await op.setNow(at(month, 5));
	await op.page.goto('/kanri');
	await posted(op.page, () => listed(op.page, name).getByRole('button', { name: '1年延ばす' }).click());
	await op.setNow(at(month, 6));
	await op.page.goto('/kanri');
	await posted(op.page, () => listed(op.page, name).getByRole('button', { name: '取り消す' }).click());

	const viewer = await browser.newContext({ baseURL: ORIGIN });
	contexts.push(viewer);
	const v = await viewer.newPage();
	// ほかのテストも同じ時に認証を付けるので、この人の行が2ページ目以降に回ることがある。ページを順にたどって集める
	const lines: string[] = [];
	for (let n = 1; n <= 20; n++) {
		await v.goto(n === 1 ? '/unei' : `/unei?ninsho=${n}`);
		const region = v.getByRole('region', { name: '認証の記録' });
		lines.push(...(await region.getByRole('listitem').filter({ hasText: name }).allInnerTexts()).map((t) => t.trim()));
		if ((await region.getByRole('link', { name: '前の記録' }).count()) === 0) break;
	}
	const day = (d: number) => `${Number(month.slice(0, 4))}年${Number(month.slice(5))}月${d}日`;
	expect(lines).toEqual([
		`有識者の認証を取り消した・${name}（消費者法）・${day(6)}`,
		`有識者の認証を1年延ばした・${name}（消費者法）・${day(5)}`,
		`有識者の認証を付けた・${name}（消費者法）・${day(4)}`
	]);
});

test('基準5：有識者が提出した法案のページに、表示する名前と「有識者（専門分野）」。認証が切れると出ない', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const month = MONTH[w].first;
	const op = await user(browser, w, 'op5', at(month, 5), 'operator');
	const e = await user(browser, w, 'e5', at(month, 5));
	// 表示名（e.name）は、法案のページのほかの文字に入れない
	const tag = `${w}${Date.now() % 1e7}`;
	const name = `弁護士 ${tag}`;
	await grant(op.page, e.name, '有識者', name, '消費者法');
	const { ids } = await issueWithSolutions(e.page, `157-${tag}`, [`解約を簡単にする ${tag}`]);
	const bill = await createAmendBill(e.page, `有識者の法案 ${tag}`, ids[0]);

	await e.page.goto(bill);
	const main = e.page.getByRole('main');
	await expect(main).toContainText(name);
	await expect(main).toContainText('有識者（消費者法）');
	await expect(main).not.toContainText(e.name);

	// 1年と1日たつと切れて、表示名に戻る
	await e.setNow(at(plusYears(month, 1), 6));
	await e.page.goto(bill);
	await expect(main).toContainText(e.name);
	await expect(main).not.toContainText(name);
	await expect(main).not.toContainText('有識者（消費者法）');
});

test('基準6：議員の質疑のカードに名前と「認証済み議員」。一般の人の質疑のカードには名前を出さない', async ({ browser }, info) => {
	test.setTimeout(120_000);
	const w = info.project.name as Width;
	const month = MONTH[w].second;
	// 5日：A が法案を書き、B・C・D の賛同で発議する
	const a = await user(browser, w, 'a6', at(month, 5));
	const { ids } = await issueWithSolutions(a.page, `157q-${a.name}`, [`窓口を作る ${a.name}`]);
	const bill = await createAmendBill(a.page, `質疑の名前の法案 ${a.name}`, ids[0]);
	for (const who of ['b6', 'c6', 'd6']) {
		const s = await user(browser, w, who, at(month, 5));
		expect((await billSupportRequest(s.page, bill, { op: 'add', rev: '1' })).status()).toBe(200);
	}
	expect((await proposeRequest(a.page, bill)).status()).toBe(200);

	const op = await user(browser, w, 'op6', at(month, 5), 'operator');
	const p = await user(browser, w, 'p6', at(month, 15));
	const g = await user(browser, w, 'g6', at(month, 15));
	const name = `試験 六郎 ${p.name}`;
	await grant(op.page, p.name, '議員', name);

	// 15日：P と G が質疑を書く
	const ask = async (u: User, text: string) => {
		await u.page.goto(bill);
		await hydrated(u.page);
		await u.page.getByRole('navigation', { name: '法案のページ' }).getByRole('link', { name: /^質疑/ }).click();
		await u.page.getByRole('link', { name: '質疑を書く' }).or(u.page.getByRole('button', { name: '質疑を書く' })).first().click();
		await u.page.getByLabel('質疑の内容').fill(text);
		await posted(u.page, () => u.page.getByRole('button', { name: '送る' }).click());
	};
	// 質疑の本文に表示名を入れない（カードに名前が出ないことを確かめるため）
	const tag = `${w}${Date.now() % 1e7}`;
	const fromP = `議員からの質疑 ${tag}`;
	const fromG = `一般の人からの質疑 ${tag}`;
	await ask(p, fromP);
	await ask(g, fromG);

	const viewer = await browser.newContext({ baseURL: ORIGIN, extraHTTPHeaders: { 'x-test-now': at(month, 16) } });
	contexts.push(viewer);
	const v = await viewer.newPage();
	await v.goto(`${bill}/shitsugi`);
	const card = (text: string) => v.locator('article').filter({ hasText: text });
	await expect(card(fromP)).toContainText(name);
	await expect(card(fromP)).toContainText('認証済み議員');
	await expect(card(fromP).locator('svg[aria-hidden="true"]').first()).toBeAttached();
	await expect(card(fromG)).toBeVisible();
	await expect(card(fromG)).not.toContainText(g.name);
	await expect(card(fromG)).not.toContainText(/認証済み議員|有識者/);
});
