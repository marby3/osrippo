// Issue #200 β版のお約束と同意（受入基準と決めたことは Issue #198 の「β版のお約束と同意」の節）
import { expect, test, type APIResponse, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { ORIGIN, loginAs, newUser, postIssue, postIssueRequest, supportRequest } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});

const VERSION = 'beta-1';

let serial = 0;
/** 幅ごと・人ごとに別の回線（IP）と名前にする。agreed: false はお約束に同意していない人 */
async function person(browser: Browser, p: string, who: string, opts: { role?: 'operator'; agreed?: boolean; login?: boolean } = {}) {
	const n = ++serial;
	const name = `yk-${who}-${p}-${Date.now() % 1e7}${n}`;
	const u = await newUser(browser, { ip: `10.200.${p === 'sp' ? 1 : 2}.${n % 250}` });
	contexts.push(u.context);
	if (opts.agreed === false) {
		await u.page.goto(`/test-login?name=${encodeURIComponent(name)}&days=2&agreed=0`);
		await expect(u.page.getByText(`テスト用のログイン：${name}`)).toBeVisible();
	} else if (opts.login !== false) {
		await loginAs(u.page, name, 2, opts.role);
	}
	return { ...u, name };
}

const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
const post = (page: Page, path: string, form: Record<string, string>) =>
	page.request.post(path, { form, headers: { origin: ORIGIN, accept: 'text/html' }, maxRedirects: 0 });

/** 運営の画面で招待コードを作り、作ったコードを返す */
async function createInvites(op: Page, count: number): Promise<string[]> {
	await op.goto('/kanri');
	await hydrated(op);
	const s = op.getByRole('region', { name: '招待コード' });
	await s.getByLabel('作る数（1〜20）').fill(String(count));
	await s.getByRole('button', { name: '招待コードを作る' }).click();
	const done = s.getByRole('status');
	await expect(done).toContainText('作りました');
	const codes = (await done.innerText()).match(/[A-HJ-NP-Z2-9]{12}/g) ?? [];
	expect(codes).toHaveLength(count);
	return codes;
}

/** ログインのフォームと同じ POST（提供元へは行かない。リダイレクトを追わない） */
async function loginPost(page: Page, form: { invite?: string; agree?: string }): Promise<APIResponse> {
	await page.goto('/login');
	return post(page, '/login?/google', { next: '/', 'cf-turnstile-response': 'test-pass', ...form });
}

const setCookies = (res: APIResponse) =>
	res
		.headersArray()
		.filter((h) => h.name.toLowerCase() === 'set-cookie')
		.map((h) => h.value);
const cookieOf = async (context: BrowserContext, name: string) => (await context.cookies(ORIGIN)).find((c) => c.name === name);

/** テスト用のログインで新しく登録する（Better Auth の hook を通る） */
const signup = (page: Page, name: string) => page.goto(`/test-login?signup=1&name=${encodeURIComponent(name)}`);

const today = () => {
	const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
	return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
};

const AGREE_LABEL = 'β版のお約束に同意します（はじめての方）';
const AGREE_REQUIRED = 'はじめての方は、β版のお約束に同意してください。';
const AGREE_REFUSED = 'β版のお約束への同意を確かめられませんでした。チェックを入れて、もう一度お試しください。';
const UNKNOWN_VERSION = 'お約束が新しくなりました。読み直してから、もう一度同意してください。';

test('基準1：/yakusoku でお約束が読め、フッターからリンクがある', async ({ browser }, info) => {
	const p = info.project.name;
	const guest = await person(browser, p, 'guest', { login: false });

	// ログインしていなくても、どの画面のフッターからも行ける
	for (const path of ['/', '/kadai']) {
		await guest.page.goto(path);
		const link = guest.page.getByRole('contentinfo').getByRole('link', { name: 'β版のお約束' });
		await expect(link, path).toHaveAttribute('href', '/yakusoku');
	}
	await guest.page.getByRole('contentinfo').getByRole('link', { name: 'β版のお約束' }).click();
	await expect(guest.page).toHaveURL('/yakusoku');
	await expect(guest.page.getByRole('heading', { name: 'β版のお約束', level: 1 })).toBeVisible();

	// 7項目（#198 の案に、決定3の一文を足したもの）
	const items = guest.page.getByRole('main').getByRole('listitem');
	await expect(items).toHaveCount(7);
	await expect(items.nth(0)).toContainText('国会・政府とは関係のない非公式のゲームです');
	await expect(items.nth(0)).toContainText('IF世界の法律は架空のものです');
	await expect(items.nth(1)).toContainText('予告なく仕様を変えたり、データを消したりすることがあります');
	await expect(items.nth(2)).toContainText('CC BY 4.0');
	await expect(items.nth(2)).toContainText('オープンソース立法府 投稿者一同');
	await expect(items.nth(2)).toContainText('公開した投稿は、あとで消しても、すでにコピーされたものは取り消せません');
	await expect(items.nth(3)).toContainText('運営は投稿を非表示にできます');
	await expect(items.nth(4)).toContainText('1人1アカウントです');
	await expect(items.nth(5)).toContainText('法律の助言ではありません');
	await expect(items.nth(6)).toContainText('正式な利用規約とプライバシーポリシーに切り替え');

	// ログインしていない人には、同意のボタンを出さない
	await expect(guest.page.getByRole('button', { name: '同意する' })).toHaveCount(0);
	// 版の内部の名前は出さない
	await expect(guest.page.getByRole('main')).not.toContainText(VERSION);
});

test('基準2：新規登録は、お約束に同意しないと進めない。同意した版と日時が記録される', async ({ browser }, info) => {
	const p = info.project.name;
	const op = await person(browser, p, 'op', { role: 'operator' });
	const [code, code2] = await createInvites(op.page, 2);

	// 同意の欄は、招待コードの欄の下、ボタンの上。お約束のページへのリンクがある
	const guest = await person(browser, p, 'a', { login: false });
	await guest.page.goto('/login');
	await hydrated(guest.page);
	const invite = await guest.page.getByLabel('招待コード（はじめての方）').boundingBox();
	const agree = guest.page.getByLabel(AGREE_LABEL);
	await expect(agree).toHaveAttribute('type', 'checkbox');
	await expect(agree).not.toBeChecked();
	const agreeBox = await agree.boundingBox();
	const google = await guest.page.getByRole('button', { name: 'Googleでログイン' }).boundingBox();
	expect(invite && agreeBox && invite.y + invite.height <= agreeBox.y).toBe(true);
	expect(agreeBox && google && agreeBox.y + agreeBox.height <= google.y).toBe(true);
	await expect(guest.page.getByRole('main').getByRole('link', { name: 'β版のお約束' })).toHaveAttribute('href', '/yakusoku');

	// 招待コードを入れても、同意がなければ断る（提供元へ送らず、Cookie も入れない）
	const refused = await loginPost(guest.page, { invite: code });
	expect(refused.status()).toBe(400);
	expect(refused.headers()['location']).toBeUndefined();
	expect(await refused.text()).toContain(AGREE_REQUIRED);
	expect(await cookieOf(guest.context, 'invite')).toBeUndefined();
	expect(await cookieOf(guest.context, 'agree')).toBeUndefined();

	// 画面から送っても、理由が出る
	await guest.page.goto('/login');
	await hydrated(guest.page);
	await guest.page.getByLabel('招待コード（はじめての方）').fill(code);
	await guest.page.getByRole('button', { name: 'Googleでログイン' }).click();
	await expect(guest.page.getByRole('alert').filter({ hasText: AGREE_REQUIRED })).toBeVisible();

	// 同意して登録すると通る。同意は短い期限の Cookie で運ぶ
	const res = await loginPost(guest.page, { invite: code, agree: VERSION });
	expect(res.status()).toBe(303);
	const cookie = setCookies(res).find((c) => c.startsWith('agree='));
	expect(cookie).toContain(`agree=${VERSION};`);
	expect(cookie).toMatch(/;\s*HttpOnly/i);
	expect(cookie).toMatch(/;\s*Secure/i);
	expect(cookie).toMatch(/;\s*SameSite=Lax/i);
	expect(cookie).toMatch(/;\s*Max-Age=600/i);
	await signup(guest.page, guest.name);
	await expect(guest.page.getByText(`テスト用のログイン：${guest.name}`)).toBeVisible();
	// 登録したら Cookie は消える
	expect(await cookieOf(guest.context, 'agree')).toBeUndefined();
	// 同意の記録：お約束のページに同意した日が出て、書き込みはお約束のページへ送られない
	await guest.page.goto('/yakusoku');
	await expect(guest.page.getByRole('main')).toContainText(`${today()}に、このお約束に同意しました。`);
	await expect(guest.page.getByRole('button', { name: '同意する' })).toHaveCount(0);
	await postIssue(guest.page, { title: `同意して登録した人の課題 ${p}-${Date.now()}` });

	// 同意の Cookie がないまま提供元から戻っても、登録しない（招待コードは使わない）
	const other = await person(browser, p, 'b', { login: false });
	expect((await loginPost(other.page, { invite: code2, agree: VERSION })).status()).toBe(303);
	await other.context.clearCookies({ name: 'agree' });
	await signup(other.page, other.name);
	await expect(other.page).toHaveURL('/login?error=agreement_required');
	await expect(other.page.getByRole('alert')).toHaveText(AGREE_REFUSED);
	// コードは残っているので、同意すれば同じコードで登録できる
	expect((await loginPost(other.page, { invite: code2, agree: VERSION })).status()).toBe(303);
	await signup(other.page, other.name);
	await expect(other.page.getByText(`テスト用のログイン：${other.name}`)).toBeVisible();

	// すでにアカウントのある人は、チェックなしで入れる
	const again = await person(browser, p, 'c', { login: false });
	expect((await loginPost(again.page, {})).status()).toBe(303);
	await signup(again.page, guest.name);
	await expect(again.page.getByText(`テスト用のログイン：${guest.name}`)).toBeVisible();
});

test('基準3：同意していない人が書き込もうとすると、お約束のページへ案内され、同意すると元の画面に戻る', async ({ browser }, info) => {
	const p = info.project.name;
	const author = await person(browser, p, 'author');
	const id = await postIssue(author.page, { title: `お約束のテストの課題 ${p}-${Date.now()}` });

	const u = await person(browser, p, 'new', { agreed: false });
	// 読むだけの画面は、同意していなくても開ける
	for (const path of ['/', `/kadai/${id}`, '/kadai']) {
		const res = await u.page.goto(path);
		expect(res?.status(), path).toBe(200);
		expect(new URL(u.page.url()).pathname, path).toBe(path);
	}
	// 書く画面は、開く前にお約束のページへ（書いた文が消えないように）
	await u.page.goto('/kadai/kaku');
	await expect(u.page).toHaveURL('/yakusoku?next=%2Fkadai%2Fkaku');

	// フォームの送信も断り、お約束のページへ送る
	const sent = await supportRequest(u.page, id, undefined);
	expect(sent.status()).toBe(303);
	expect(sent.headers()['location']).toBe(`/yakusoku?next=%2Fkadai%2F${id}`);
	const issue = await postIssueRequest(u.page, { title: `同意していない人の課題 ${p}` });
	expect(issue.status()).toBe(303);
	expect(issue.headers()['location']).toBe('/yakusoku?next=%2Fkadai%2Fkaku');

	// 画面で「わかる」を押すと、お約束のページへ
	await u.page.goto(`/kadai/${id}`);
	await hydrated(u.page);
	const wakaru = u.page.getByRole('button', { name: /^わかる/ });
	await expect(wakaru).toHaveText(/わかる\s*0$/);
	await wakaru.click();
	await expect(u.page).toHaveURL(`/yakusoku?next=%2Fkadai%2F${id}`);
	await expect(u.page.getByRole('heading', { name: 'β版のお約束', level: 1 })).toBeVisible();
	await expect(u.page.getByText('書き込む前に、このお約束への同意をお願いします。')).toBeVisible();

	// 同意すると元の画面に戻り、書き込める
	await u.page.getByRole('button', { name: '同意する' }).click();
	await expect(u.page).toHaveURL(`/kadai/${id}`);
	await expect(wakaru).toHaveText(/わかる\s*0$/);
	await wakaru.click();
	await expect(wakaru).toHaveText(/わかる\s*1$/);
	await expect(wakaru).toHaveAttribute('aria-pressed', 'true');
	await u.page.goto('/kadai/kaku');
	await expect(u.page).toHaveURL('/kadai/kaku');
	await u.page.goto('/yakusoku');
	await expect(u.page.getByRole('main')).toContainText(`${today()}に、このお約束に同意しました。`);
});

test('信頼の境界：戻り先は外へ出さず、知らない版の同意は断る', async ({ browser }, info) => {
	const p = info.project.name;
	const u = await person(browser, p, 'edge', { agreed: false });

	// 知らない版・形の違う版は断り、記録しない
	for (const version of ['beta-0', 'beta-2', 'BETA-1', ` ${VERSION}`, '', '<script>x</script>']) {
		const res = await post(u.page, '/yakusoku', { version, next: '/kadai' });
		expect(res.status(), version).toBe(400);
		expect(res.headers()['location'], version).toBeUndefined();
		expect(await res.text(), version).toContain(UNKNOWN_VERSION);
	}
	const still = await postIssueRequest(u.page, { title: `版を断られた人の課題 ${p}` });
	expect(still.status()).toBe(303);
	expect(still.headers()['location']).toBe('/yakusoku?next=%2Fkadai%2Fkaku');

	// 外へ向けた戻り先は、ページにも入れず、同意したあとはホームへ
	await u.page.goto(`/yakusoku?next=${encodeURIComponent('https://evil.example/')}`);
	await hydrated(u.page);
	await expect(u.page.locator('input[name="next"]')).toHaveValue('/');
	await u.page.getByRole('button', { name: '同意する' }).click();
	await expect(u.page).toHaveURL(`${ORIGIN}/`);

	for (const next of ['https://evil.example/', '//evil.example', '/\\evil.example', '/.//evil.example', 'javascript:alert(1)', 'evil.example']) {
		const res = await post(u.page, '/yakusoku', { version: VERSION, next });
		expect(res.status(), next).toBe(303);
		expect(res.headers()['location'], next).toBe('/');
	}

	// ログインしていない人の同意は、ログインへ送る
	const guest = await person(browser, p, 'edge-guest', { login: false });
	await guest.page.goto('/yakusoku');
	const res = await post(guest.page, '/yakusoku', { version: VERSION, next: '/kadai' });
	expect(res.status()).toBe(303);
	expect(res.headers()['location']).toBe('/login?next=%2Fyakusoku');

	// ログインの画面：同意の欄に版でない値を送っても、同意としない
	for (const agree of ['on', 'beta-0', '1']) {
		const r = await loginPost(guest.page, { invite: 'ABCDEFGHJKLM', agree });
		expect(r.status(), agree).toBe(400);
		expect(await r.text(), agree).toContain(AGREE_REQUIRED);
		expect(await cookieOf(guest.context, 'agree'), agree).toBeUndefined();
	}

	// テスト用のログインの agreed は 0 か 1 だけ
	const bad = await guest.page.goto(`/test-login?name=${encodeURIComponent(`${u.name}-x`)}&agreed=yes`);
	expect(bad?.status()).toBe(400);
});
