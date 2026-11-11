// Issue #103 基準8と信頼の境界：修正案の通報と非表示（設計書 docs/spec/103.md）。決まりの中身は src/lib/db/amendment-moderation.test.ts
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { billRequest, billSupportRequest, createAmendBill, issueWithSolutions, newUser, ORIGIN, proposeRequest } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});
test.use({ actionTimeout: 15_000 });
test.beforeEach(() => test.setTimeout(240_000));

const stamp = () => Date.now() % 1e8;
const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
/** 基準ごと・幅ごとに別の年を使う（2463年まではほかのテストが使っている） */
const monthOf = (w: string, group: number) => `${2470 + group * 2 + (w === 'sp' ? 0 : 1)}-05`;
const at = (month: string, day: number) => `${month}-${String(day).padStart(2, '0')}T09:00:00+09:00`;

type User = { page: Page; name: string; setNow: (now: string) => Promise<void> };

function setup(browser: Browser, w: string, group: number) {
	const month = monthOf(w, group);
	const label = `m${group}${w}${stamp()}`;
	let seq = 0;
	const person = async (now: string, opts: { days?: number; role?: 'moderator' | 'operator' } = {}): Promise<User> => {
		seq += 1;
		const address = `10.${w === 'sp' ? 111 : 112}.${group}.${seq}`;
		const name = `u${seq}-${label}`;
		const u = await newUser(browser, { name, ip: address, days: opts.days ?? 8, role: opts.role });
		contexts.push(u.context);
		const setNow = (t: string) => u.context.setExtraHTTPHeaders({ 'x-test-ip': address, 'x-test-now': t });
		await setNow(now);
		return { page: u.page, name, setNow };
	};
	/** 発議した法案。a は提出者。extra は賛同する運営など */
	async function bill(title: string, now: string, extra: User[] = []) {
		const a = await person(now);
		const { ids } = await issueWithSolutions(a.page, title, [`解決策 ${title}`]);
		const path = await createAmendBill(a.page, title, ids[0]);
		for (const u of [await person(now), await person(now), await person(now), ...extra]) {
			const res = await billSupportRequest(u.page, path, { op: 'add', rev: '1' });
			expect(res.status(), await res.text()).toBe(200);
		}
		const res = await proposeRequest(a.page, path);
		expect(res.status(), await res.text()).toBe(200);
		return { a, path };
	}
	return { month, label, person, bill };
}

const tabPath = (path: string) => `${path}/shusei`;
const card = (page: Page, text: string) => page.locator('article').filter({ hasText: text });
const billTab = (page: Page) => page.getByRole('navigation', { name: '法案のページ' }).getByRole('link', { name: /^修正案/ });

/** 第2条を書きかえる修正案を出して、番号を返す */
async function amend(u: User, path: string, body: string) {
	const res = await billRequest(u.page, `${tabPath(path)}/kaku`, { rev: '1', reason: '', article: '0:2', body, 'cf-turnstile-response': 'test-pass' });
	expect(res.status(), await res.text()).toBe(303);
	await u.page.goto(tabPath(path));
	return ((await card(u.page, body).getAttribute('id')) as string).replace('shusei-', '');
}
const act = (u: User, path: string, action: string, form: Record<string, string>) => billRequest(u.page, `${tabPath(path)}?/${action}`, form);
const staffRequest = (u: User, action: 'hideAmendment' | 'restoreAmendment', form: Record<string, string>) =>
	u.page.request.post(`/kanri?/${action}`, { form, headers: { origin: ORIGIN, accept: 'text/html' }, maxRedirects: 0 });

test('基準8：修正案のタブから通報でき3人で消える。/kanri で非表示と表示に戻すができ、/unei、本人の理由、/tsuchi までつながる。扱えない運営にリンクが出ない', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 0);
	const now = at(s.month, 5);
	const day15 = at(s.month, 15);

	const involvedStaff = await s.person(now, { role: 'moderator' });
	const { path } = await s.bill(`修正案の通報の法案 ${s.label}`, now, [involvedStaff]);
	await involvedStaff.setNow(day15);

	const writer = await s.person(day15);
	const text = `通報される修正案 ${s.label}`;
	const quietText = `通報のない修正案 ${s.label}`;
	const id = await amend(writer, path, text);
	const quiet = await amend(writer, path, quietText);

	// 画面から通報できる。自分のものには出ない
	const r1 = await s.person(day15);
	await r1.page.goto(tabPath(path));
	await hydrated(r1.page);
	const r1Card = card(r1.page, text);
	await r1Card.getByText('この修正案を通報する', { exact: true }).click();
	await r1Card.getByRole('radio', { name: '人への攻撃・差別' }).check();
	await r1Card.getByRole('button', { name: '通報する', exact: true }).click();
	await expect(r1Card.getByText('通報を受け付けました')).toBeVisible();
	await r1.page.reload();
	await expect(card(r1.page, text).getByText('通報済みです')).toBeVisible();
	await writer.page.goto(tabPath(path));
	await expect(card(writer.page, text).getByText('この修正案を通報する')).toHaveCount(0);

	// ログインしていなければログインへ
	const guest = await browser.newContext({ baseURL: ORIGIN, extraHTTPHeaders: { 'x-test-ip': `10.${w === 'sp' ? 111 : 112}.0.250`, 'x-test-now': day15 } });
	contexts.push(guest);
	const guestPage = await guest.newPage();
	await guestPage.goto(tabPath(path));
	await card(guestPage, quietText).getByRole('button', { name: 'この修正案を通報する' }).click();
	await expect(guestPage).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(tabPath(path))}`));

	// 3人目で消え、数からも外れる
	for (const reporter of [await s.person(day15), await s.person(day15)]) {
		expect((await act(reporter, path, 'reportAmendment', { amendment: id, reason: 'attack' })).status()).toBe(200);
	}
	const viewer = await s.person(day15);
	await viewer.page.goto(tabPath(path));
	await expect(card(viewer.page, text)).toHaveCount(0);
	await expect(billTab(viewer.page)).toHaveText('修正案 1');
	await expect(viewer.page.getByRole('heading', { name: '非表示の修正案' })).toHaveCount(0);

	// 非表示のあいだは賛同できない
	expect((await act(viewer, path, 'support', { amendment: id, revision: '1', op: 'add' })).status()).toBe(403);
	// 更新の画面に番号を指しても、本文を渡さない
	expect(await (await viewer.page.request.get(`${tabPath(path)}/kaku?koushin=${id}`)).text()).not.toContain(text);

	// 書いた人に通知が届き、タブで理由を読める
	await writer.page.goto('/tsuchi');
	await writer.page.getByRole('link', { name: /修正案が非表示になりました/ }).first().click();
	await expect(writer.page).toHaveURL(new RegExp(`${tabPath(path)}$`));
	const hiddenSection = writer.page.getByRole('region', { name: '非表示の修正案' });
	await expect(hiddenSection.getByText(text)).toBeVisible();
	await expect(hiddenSection.getByText('通報により非表示になっています')).toBeVisible();

	// 運営：/kanri の区画に出て、表示に戻せる。戻すとカードが戻り、/unei に記録が出る
	const staff = await s.person(day15, { role: 'operator' });
	await staff.page.goto('/kanri');
	const row = staff.page.getByRole('region', { name: '通報を受けた修正案' }).locator('article').filter({ hasText: text });
	await expect(row.getByText('通報 3件（数えたもの 3件）')).toBeVisible();
	await row.getByLabel('表示に戻すメモ').fill(`問題がなかった ${s.label}`);
	await row.getByRole('button', { name: '表示に戻す' }).click();
	await expect(row.getByText('表示に戻した', { exact: true })).toBeVisible();
	await viewer.page.goto(tabPath(path));
	await expect(card(viewer.page, text)).toBeVisible();
	await viewer.page.goto('/unei');
	const log = viewer.page.getByRole('region', { name: '法案の質疑・修正案・専門家の解説への対応' });
	const logRow = log.locator('tr').filter({ hasText: `問題がなかった ${s.label}` });
	await expect(logRow.getByRole('link', { name: `修正案の通報の法案 ${s.label}` })).toHaveAttribute('href', tabPath(path));
	await expect(logRow.getByText('修正案', { exact: true })).toBeVisible();
	await expect(log.getByText(text)).toHaveCount(0);

	// 通報のない修正案を手で隠しても、タブの欄のリンクから戻せる
	await staff.page.goto(tabPath(path));
	await card(staff.page, quietText).getByRole('link', { name: '運営として対応する' }).click();
	await expect(staff.page).toHaveURL(new RegExp(`/kanri\\?amendment=${quiet}$`));
	const quietRow = staff.page.locator('article').filter({ hasText: quietText });
	await quietRow.getByLabel('非表示にする理由').selectOption('spam');
	await quietRow.getByLabel('非表示にするメモ').fill('宣伝だった');
	await quietRow.getByRole('button', { name: '非表示にする' }).click();
	await expect(quietRow.getByRole('button', { name: '表示に戻す' })).toBeVisible();
	await staff.page.goto(tabPath(path));
	await staff.page.getByRole('region', { name: '非表示の修正案' }).getByRole('link', { name: '運営として対応する' }).click();
	await expect(staff.page).toHaveURL(new RegExp(`/kanri\\?amendment=${quiet}$`));
	const backRow = staff.page.locator('article').filter({ hasText: quietText });
	await backRow.getByLabel('表示に戻すメモ').fill('戻す');
	await backRow.getByRole('button', { name: '表示に戻す' }).click();
	await expect(backRow.getByText('表示に戻した', { exact: true })).toBeVisible();
	await viewer.page.goto(tabPath(path));
	await expect(card(viewer.page, quietText)).toBeVisible();
	await writer.page.goto('/tsuchi');
	await expect(writer.page.getByRole('link', { name: /修正案が表示に戻りました/ }).first()).toBeVisible();

	// 扱えない運営（法案に賛同した）にはリンクが出ず、?amendment= は 404、操作は 403
	await involvedStaff.page.goto(tabPath(path));
	await expect(card(involvedStaff.page, text)).toBeVisible();
	await expect(involvedStaff.page.getByRole('link', { name: '運営として対応する' })).toHaveCount(0);
	expect((await involvedStaff.page.request.get(`/kanri?amendment=${id}`)).status()).toBe(404);
	expect((await staffRequest(involvedStaff, 'hideAmendment', { amendment: id, reason: 'attack', note: 'x' })).status()).toBe(403);
	await involvedStaff.page.goto('/kanri');
	await expect(involvedStaff.page.getByText(text)).toHaveCount(0);

	// 権限のない人には /kanri は 404
	expect((await viewer.page.request.get(`/kanri?amendment=${id}`)).status()).toBe(404);
});

test('信頼の境界：修正案の通報と運営の操作の入力、/kanri の ?amendment=', async ({ browser }, info) => {
	const s = setup(browser, info.project.name, 1);
	const now = at(s.month, 5);
	const day15 = at(s.month, 15);
	const { path } = await s.bill(`境界の法案 ${s.label}`, now);
	const writer = await s.person(day15);
	const amendment = await amend(writer, path, `境界の修正案 ${s.label}`);
	const reporter = await s.person(day15);
	const staff = await s.person(day15, { role: 'operator' });

	const badReports: Record<string, string>[] = [{}, { amendment: 'abc' }, { amendment: '0' }, { amendment: '-1' }, { amendment, reason: 'duplicate' }, { amendment, reason: 'bad' }, { amendment, reason: 'other', note: 'あ'.repeat(201) }];
	for (const form of badReports) expect((await act(reporter, path, 'reportAmendment', form)).status(), JSON.stringify(form)).toBe(400);
	expect((await act(reporter, path, 'reportAmendment', { amendment: '99999999' })).status()).toBe(404);
	expect((await act(reporter, '/houan/abc', 'reportAmendment', { amendment })).status()).toBe(404);

	for (const q of ['abc', '0', '99999999']) expect((await staff.page.request.get(`/kanri?amendment=${q}`)).status(), q).toBe(404);

	const badActions: Record<string, string>[] = [{}, { amendment: 'abc', reason: 'attack', note: 'x' }, { amendment, reason: 'bad', note: 'x' }, { amendment, note: 'x' }, { amendment, reason: 'attack' }, { amendment, reason: 'attack', note: 'あ'.repeat(201) }];
	for (const form of badActions) expect((await staffRequest(staff, 'hideAmendment', form)).status(), JSON.stringify(form)).toBe(400);
	expect((await staffRequest(staff, 'hideAmendment', { amendment: '99999999', reason: 'attack', note: 'x' })).status()).toBe(404);
	expect((await staffRequest(staff, 'restoreAmendment', { amendment, note: '' })).status()).toBe(400);
	expect((await staffRequest(staff, 'restoreAmendment', { amendment: '99999999', note: 'x' })).status()).toBe(404);
});
