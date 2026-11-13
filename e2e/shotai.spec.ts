// Issue #199 招待コード（設計書 docs/spec/199.md）。同じコードを2回使えないことの DB の確かめは src/lib/db/invites.test.ts
import { expect, test, type APIResponse, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { ORIGIN, loginAs, newUser } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});

let serial = 0;
/** 幅ごと・人ごとに別の回線（IP）と名前にする */
async function person(browser: Browser, p: string, who: string, role?: 'moderator' | 'operator') {
	const n = ++serial;
	const name = `inv-${who}-${p}-${Date.now() % 1e7}${n}`;
	const u = await newUser(browser, { ip: `10.199.${p === 'sp' ? 1 : 2}.${n % 250}` });
	contexts.push(u.context);
	if (role) await loginAs(u.page, name, 2, role);
	return { ...u, name };
}

const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
const section = (page: Page) => page.getByRole('region', { name: '招待コード' });
/** 一覧のそのコードの行 */
const row = (page: Page, code: string) => section(page).getByRole('listitem').filter({ hasText: code });

/** 運営の画面で招待コードを作り、作ったコードを返す */
async function createInvites(op: Page, count: number): Promise<string[]> {
	await op.goto('/kanri');
	await hydrated(op);
	const s = section(op);
	await s.getByLabel('作る数（1〜20）').fill(String(count));
	await s.getByRole('button', { name: '招待コードを作る' }).click();
	const done = s.getByRole('status');
	await expect(done).toContainText('作りました');
	const codes = (await done.innerText()).match(/[A-HJ-NP-Z2-9]{12}/g) ?? [];
	expect(codes).toHaveLength(count);
	return codes;
}

/** ログインのフォームと同じ POST（提供元へは行かない。リダイレクトを追わない）。β版のお約束には同意する（Issue #200。同意のないときは e2e/yakusoku.spec.ts） */
async function loginPost(page: Page, invite?: string): Promise<APIResponse> {
	await page.goto('/login');
	return page.request.post('/login?/google', {
		form: { next: '/', 'cf-turnstile-response': 'test-pass', agree: 'beta-1', ...(invite === undefined ? {} : { invite }) },
		headers: { origin: ORIGIN, accept: 'text/html' },
		maxRedirects: 0
	});
}

const setCookies = (res: APIResponse) =>
	res
		.headersArray()
		.filter((h) => h.name.toLowerCase() === 'set-cookie')
		.map((h) => h.value);

/** 招待コードの Cookie（いまブラウザにあるもの） */
const inviteCookie = async (context: BrowserContext) => (await context.cookies(ORIGIN)).find((c) => c.name === 'invite');

/** テスト用のログインで新しく登録する（hook を通る） */
const signup = (page: Page, name: string) => page.goto(`/test-login?signup=1&name=${encodeURIComponent(name)}`);

const REFUSED = '招待コードが使えませんでした。コードを確かめてください。';

test('基準1：運営はコードを作り、取り消せる。使ったかどうかが一覧に出る。運営協力者には出さない', async ({ browser }, info) => {
	const p = info.project.name;
	const op = await person(browser, p, 'op', 'operator');
	const [revoked, used, unused] = await createInvites(op.page, 3);

	// 1つを取り消す
	await row(op.page, revoked).getByRole('button', { name: '取り消す' }).click();
	await expect(row(op.page, revoked)).toContainText('取り消した日');

	// 1つをログインの画面から使う
	const guest = await person(browser, p, 'new');
	expect((await loginPost(guest.page, used)).status()).toBe(303);
	await signup(guest.page, guest.name);
	await expect(guest.page.getByText(`テスト用のログイン：${guest.name}`)).toBeVisible();

	await op.page.goto('/kanri');
	await expect(row(op.page, revoked)).toContainText(/取り消した日：\d+年\d+月\d+日/);
	await expect(row(op.page, used)).toContainText(/使った日：\d+年\d+月\d+日/);
	await expect(row(op.page, unused)).toContainText('使っていない');
	for (const code of [revoked, used, unused]) await expect(row(op.page, code)).toContainText(/作った日：\d+年\d+月\d+日/);
	// 使った人の名前は出さない。使った・取り消したコードには取り消しのボタンを出さない
	await expect(row(op.page, used)).not.toContainText('参加者');
	await expect(row(op.page, used).getByRole('button', { name: '取り消す' })).toHaveCount(0);
	await expect(row(op.page, revoked).getByRole('button', { name: '取り消す' })).toHaveCount(0);
	await expect(row(op.page, unused).getByRole('button', { name: '取り消す' })).toHaveCount(1);
	// 使ったコードを取り消そうとしても断る
	const again = await op.page.request.post('/kanri?/inviteRevoke', {
		form: { code: used },
		headers: { origin: ORIGIN, accept: 'text/html' },
		maxRedirects: 0
	});
	expect(again.status()).toBe(400);
	expect(await again.text()).toContain('すでに使われたか、取り消されています');

	// 運営協力者には区画が出ず、操作も 404
	const mod = await person(browser, p, 'mod', 'moderator');
	await mod.page.goto('/kanri');
	await expect(mod.page.getByRole('heading', { name: '通報を受けた課題', level: 1 })).toBeVisible();
	await expect(section(mod.page)).toHaveCount(0);
	await expect(mod.page.getByText(unused)).toHaveCount(0);
	for (const [action, form] of [
		['inviteCreate', { count: '1' }],
		['inviteRevoke', { code: unused }]
	] as const) {
		const res = await mod.page.request.post(`/kanri?/${action}`, { form, headers: { origin: ORIGIN, accept: 'text/html' }, maxRedirects: 0 });
		expect(res.status(), action).toBe(404);
	}
	await op.page.goto('/kanri');
	await expect(row(op.page, unused)).toContainText('使っていない');
});

test('基準2：使っていないコードがあるときだけ登録できる。使用済み・コードなしは断り、理由が出る', async ({ browser }, info) => {
	const p = info.project.name;
	const op = await person(browser, p, 'op', 'operator');
	const [code] = await createInvites(op.page, 1);

	// 全角・小文字・前後の空白はそろえてから入れる
	const typed = ` ${[...code.toLowerCase()].map((c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0)).join('')}　`;
	const first = await person(browser, p, 'a');
	const res = await loginPost(first.page, typed);
	expect(res.status()).toBe(303);
	const cookie = setCookies(res).find((c) => c.startsWith('invite='));
	expect(cookie).toBeDefined();
	expect(cookie).toContain(`invite=${code};`);
	expect(cookie).toMatch(/;\s*HttpOnly/i);
	expect(cookie).toMatch(/;\s*Secure/i);
	expect(cookie).toMatch(/;\s*SameSite=Lax/i);
	expect(cookie).toMatch(/;\s*Path=\/(;|$)/i);
	expect(cookie).toMatch(/;\s*Max-Age=600/i);
	await signup(first.page, first.name);
	await expect(first.page.getByText(`テスト用のログイン：${first.name}`)).toBeVisible();
	// 登録したら Cookie は消える
	expect(await inviteCookie(first.context)).toBeUndefined();

	// 同じコードで別の人が登録しようとすると断る
	const second = await person(browser, p, 'b');
	expect((await loginPost(second.page, code)).status()).toBe(303);
	await signup(second.page, second.name);
	await expect(second.page).toHaveURL('/login?error=invite_required');
	await expect(second.page.getByRole('alert')).toHaveText(REFUSED);
	// 断られた人は作られていない（もう一度でも断られる）
	await signup(second.page, second.name);
	await expect(second.page).toHaveURL('/login?error=invite_required');

	// コードなしでも断る
	const third = await person(browser, p, 'c');
	expect((await loginPost(third.page)).status()).toBe(303);
	await signup(third.page, third.name);
	await expect(third.page).toHaveURL('/login?error=invite_required');
	await expect(third.page.getByRole('alert')).toHaveText(REFUSED);

	// ほかの理由で戻ったときは、いままでの文
	await third.page.goto('/login?error=access_denied');
	await expect(third.page.getByRole('alert')).toHaveText('ログインできませんでした。もう一度お試しください。');
});

test('基準4：アカウントのある人はコードなしで入れる。ログインしていない人も読める', async ({ browser }, info) => {
	const p = info.project.name;
	// アカウントを作っておく（テスト用のログインは hook を通らない）
	const before = await person(browser, p, 'old');
	await loginAs(before.page, before.name);

	// 別のブラウザで、コードなしで入る
	const again = await person(browser, p, 'old2');
	expect((await loginPost(again.page)).status()).toBe(303);
	await signup(again.page, before.name);
	await expect(again.page.getByText(`テスト用のログイン：${before.name}`)).toBeVisible();
	await again.page.goto('/watashi');
	await expect(again.page.getByText(before.name, { exact: true })).toBeVisible();

	// ログインしていない人
	const guest = await person(browser, p, 'guest');
	for (const path of ['/', '/kadai']) {
		const res = await guest.page.goto(path);
		expect(res?.status(), path).toBe(200);
		expect(new URL(guest.page.url()).pathname, path).toBe(path);
	}
});

test('信頼の境界：形の違うコードは Cookie に入れず、400 で欄の下に理由を出す', async ({ browser }, info) => {
	const p = info.project.name;
	const guest = await person(browser, p, 'bad');
	const REASON = '招待コードの形が違います';

	// 形の合うコードを入れておく（使えるかは見ない）
	expect((await loginPost(guest.page, 'ABCDEFGHJKLM')).status()).toBe(303);
	expect((await inviteCookie(guest.context))?.value).toBe('ABCDEFGHJKLM');

	for (const bad of ['ABCDEFGHJKLMN', 'ABCD-EFGH-JK', 'ABCDEF GHJKL', 'ABCDEFGHJKL0', 'ABCDEFGHJKLO', 'ABCDEFGHJKL1', 'ABCDEFGHJKLI', 'ABCDEFGHJK', '<script>x</sc']) {
		const res = await loginPost(guest.page, bad);
		expect(res.status(), bad).toBe(400);
		expect(res.headers()['location'], bad).toBeUndefined();
		expect(setCookies(res).some((c) => c.startsWith('invite=') && !/Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c)), bad).toBe(false);
		expect(await res.text(), bad).toContain(REASON);
		// 前に入れた Cookie も消える
		expect(await inviteCookie(guest.context), bad).toBeUndefined();
	}

	// 画面から送ると、欄の下に理由が出る
	await guest.page.goto('/login');
	await hydrated(guest.page);
	const field = guest.page.getByLabel('招待コード（はじめての方）');
	await field.fill('ABCDEFGHJKLMN');
	await guest.page.getByRole('button', { name: 'Googleでログイン' }).click();
	const reason = guest.page.getByRole('alert').filter({ hasText: REASON });
	await expect(reason).toBeVisible();
	const after = guest.page.getByLabel('招待コード（はじめての方）');
	await expect(after).toHaveAttribute('aria-invalid', 'true');
	const fieldBox = await after.boundingBox();
	const reasonBox = await reason.boundingBox();
	expect(fieldBox && reasonBox && fieldBox.y + fieldBox.height <= reasonBox.y).toBe(true);
	expect(await inviteCookie(guest.context)).toBeUndefined();
});
