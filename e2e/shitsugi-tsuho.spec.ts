// Issue #80 基準8と信頼の境界：質疑・答弁・補足の通報と非表示（設計書 docs/spec/80.md）。決まりの中身は src/lib/db/post-moderation.test.ts
// 前の会期のカードに通報が出ることは e2e/if-sekai.spec.ts の「前の会期の質疑は読むだけ」で確かめる
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
/** 基準ごと・幅ごとに別の年を使う（2457年まではほかのテストが使っている） */
const monthOf = (w: string, group: number) => `${2460 + group * 2 + (w === 'sp' ? 0 : 1)}-05`;
const at = (month: string, day: number) => `${month}-${String(day).padStart(2, '0')}T09:00:00+09:00`;

type User = { page: Page; name: string; setNow: (now: string) => Promise<void> };

function setup(browser: Browser, w: string, group: number) {
	const month = monthOf(w, group);
	const label = `t${group}${w}${stamp()}`;
	let seq = 0;
	const person = async (now: string, opts: { days?: number; role?: 'moderator' | 'operator' } = {}): Promise<User> => {
		seq += 1;
		const address = `10.${w === 'sp' ? 107 : 108}.${group}.${seq}`;
		const name = `u${seq}-${label}`;
		const u = await newUser(browser, { name, ip: address, days: opts.days ?? 8, role: opts.role });
		contexts.push(u.context);
		const setNow = (t: string) => u.context.setExtraHTTPHeaders({ 'x-test-ip': address, 'x-test-now': t });
		await setNow(now);
		return { page: u.page, name, setNow };
	};
	/** 発議した法案。a は提出者、b は賛同者。extra は賛同する運営など */
	async function bill(title: string, now: string, extra: User[] = []) {
		const a = await person(now);
		const { ids } = await issueWithSolutions(a.page, title, [`解決策 ${title}`]);
		const path = await createAmendBill(a.page, title, ids[0]);
		const supporters = [await person(now), await person(now), await person(now), ...extra];
		for (const u of supporters) {
			const res = await billSupportRequest(u.page, path, { op: 'add', rev: '1' });
			expect(res.status(), await res.text()).toBe(200);
		}
		const res = await proposeRequest(a.page, path);
		expect(res.status(), await res.text()).toBe(200);
		return { a, b: supporters[0], path };
	}
	return { month, label, person, bill };
}

const qa = (path: string) => `${path}/shitsugi`;
const passed = { 'cf-turnstile-response': 'test-pass' };
const card = (page: Page, text: string) => page.locator('article').filter({ hasText: text });
const tab = (page: Page) => page.getByRole('navigation', { name: '法案のページ' }).getByRole('link', { name: /^質疑/ });

async function ask(u: User, path: string, body: string) {
	const res = await billRequest(u.page, `${qa(path)}/kaku`, { body, ...passed });
	expect(res.status(), await res.text()).toBe(303);
	await u.page.goto(qa(path));
	return ((await card(u.page, body).getAttribute('id')) as string).replace('shitsugi-', '');
}

async function reply(u: User, path: string, kind: 'answer' | 'supplement', question: string, body: string) {
	const res = await billRequest(u.page, `${qa(path)}?/${kind}`, { question, body, ...passed });
	expect(res.status(), await res.text()).toBe(200);
}

const reportRequest = (u: User, path: string, form: Record<string, string>) => billRequest(u.page, `${qa(path)}?/reportPost`, form);
const staffRequest = (u: User, action: 'hidePost' | 'restorePost', form: Record<string, string>) =>
	u.page.request.post(`/kanri?/${action}`, { form, headers: { origin: ORIGIN, accept: 'text/html' }, maxRedirects: 0 });

/** 画面から通報する。開いて、理由を選んで、送る */
async function reportOnScreen(page: Page, scope: ReturnType<Page['locator']>, name: string) {
	await scope.getByRole('button', { name, exact: true }).click();
	await scope.getByRole('radio', { name: '人への攻撃・差別' }).check();
	await scope.getByRole('button', { name: '通報する', exact: true }).click();
	await expect(scope.getByText('通報を受け付けました')).toBeVisible();
}

test('基準8：質疑のタブから通報でき3人で消える。/kanri で非表示と表示に戻すができ、/unei、本人の理由、/tsuchi までつながる。関連法案のカードと関わった運営には出ない', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 0);
	const now = at(s.month, 5);
	const day15 = at(s.month, 15);

	const involvedStaff = await s.person(now, { role: 'moderator' });
	const { a, b, path } = await s.bill(`通報の法案 ${s.label}`, now, [involvedStaff]);
	// 同じ条を変える法案は関連法案になる
	const related = await s.bill(`関連の法案 ${s.label}`, now);
	for (const u of [a, b, involvedStaff]) await u.setNow(day15);

	const writer = await s.person(day15);
	const questionText = `通報される質疑 ${s.label}`;
	const answerText = `通報される答弁 ${s.label}`;
	const supplementText = `通報される補足 ${s.label}`;
	const quietText = `通報のない質疑 ${s.label}`;
	const relatedText = `関連法案の質疑 ${s.label}`;
	const question = await ask(writer, path, questionText);
	const quiet = await ask(writer, path, quietText);
	await reply(b, path, 'answer', question, answerText);
	const other = await s.person(day15);
	await reply(other, path, 'supplement', question, supplementText);
	await ask(writer, related.path, relatedText);

	// 画面から質疑、答弁、補足を通報できる。自分のものには出ない
	const r1 = await s.person(day15);
	await r1.page.goto(qa(path));
	await hydrated(r1.page);
	const r1Card = card(r1.page, questionText);
	await reportOnScreen(r1.page, r1Card.locator('.post-report').first(), 'この質疑を通報する');
	if (w === 'sp') await r1Card.getByRole('button', { name: /答弁を読む/ }).click();
	await reportOnScreen(r1.page, r1Card.locator('section.answer'), 'この答弁を通報する');
	await reportOnScreen(r1.page, r1Card.locator('section.supplement'), 'この補足を通報する');
	await r1.page.reload();
	await expect(card(r1.page, questionText).getByText('通報済みです').first()).toBeVisible();
	await writer.page.goto(qa(path));
	await expect(card(writer.page, questionText).getByRole('button', { name: 'この質疑を通報する' })).toHaveCount(0);

	// ログインしていなければログインへ
	const guest = await browser.newContext({ baseURL: ORIGIN, extraHTTPHeaders: { 'x-test-ip': `10.${w === 'sp' ? 107 : 108}.0.250`, 'x-test-now': day15 } });
	contexts.push(guest);
	const guestPage = await guest.newPage();
	await guestPage.goto(qa(path));
	await card(guestPage, quietText).getByRole('button', { name: 'この質疑を通報する' }).click();
	await expect(guestPage).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(qa(path))}`));

	// 3人目で消え、数からも外れる
	for (const reporter of [await s.person(day15), await s.person(day15)]) {
		expect((await reportRequest(reporter, path, { post: question, reason: 'attack' })).status()).toBe(200);
	}
	const viewer = await s.person(day15);
	await viewer.page.goto(qa(path));
	await expect(card(viewer.page, questionText)).toHaveCount(0);
	await expect(tab(viewer.page)).toHaveText('質疑 1');
	await expect(viewer.page.getByRole('heading', { name: '非表示の投稿' })).toHaveCount(0);

	// 書いた人に通知が届き、タブで理由を読める
	await writer.page.goto('/tsuchi');
	await writer.page.getByRole('link', { name: /非表示になりました/ }).first().click();
	await expect(writer.page).toHaveURL(new RegExp(`${qa(path)}$`));
	const hiddenSection = writer.page.getByRole('region', { name: '非表示の投稿' });
	await expect(hiddenSection.getByText(questionText)).toBeVisible();
	await expect(hiddenSection.getByText('通報により非表示になっています')).toBeVisible();
	// 絞り込みには出さない
	await writer.page.goto(`${qa(path)}?mati=1`);
	await expect(writer.page.getByRole('heading', { name: '非表示の投稿' })).toHaveCount(0);
	// 下の補足を書いた人には質疑の中身なしで出る
	await other.page.goto(qa(path));
	await expect(other.page.getByText('質疑が非表示のため出ていません')).toBeVisible();
	await expect(other.page.getByText(supplementText)).toBeVisible();
	await expect(other.page.getByText(questionText)).toHaveCount(0);

	// 運営：/kanri の区画に出て、表示に戻せる。戻すとカードが戻り、/unei に記録が出る
	const staff = await s.person(day15, { role: 'operator' });
	await staff.page.goto('/kanri');
	const row = staff.page.getByRole('region', { name: '通報を受けた質疑・答弁・補足' }).locator('article').filter({ hasText: questionText });
	await expect(row.getByText('通報 3件（数えたもの 3件）')).toBeVisible();
	await row.getByLabel('表示に戻すメモ').fill(`問題がなかった ${s.label}`);
	await row.getByRole('button', { name: '表示に戻す' }).click();
	await viewer.page.goto(qa(path));
	await expect(card(viewer.page, questionText)).toBeVisible();
	await expect(card(viewer.page, supplementText)).toBeVisible();
	await viewer.page.goto('/unei');
	const log = viewer.page.getByRole('region', { name: '法案の質疑への対応' });
	await expect(log.getByRole('link', { name: `通報の法案 ${s.label}` }).first()).toBeVisible();
	await expect(log.getByText(`問題がなかった ${s.label}`)).toBeVisible();
	await expect(log.getByText(questionText)).toHaveCount(0);

	// 通報のない投稿を手で隠しても、タブの欄のリンクから戻せる
	await staff.page.goto(qa(path));
	await card(staff.page, quietText).getByRole('link', { name: '運営として対応する' }).click();
	await expect(staff.page).toHaveURL(new RegExp(`/kanri\\?post=${quiet}$`));
	const quietRow = staff.page.locator('article').filter({ hasText: quietText });
	await quietRow.getByLabel('非表示にする理由').selectOption('spam');
	await quietRow.getByLabel('非表示にするメモ').fill('宣伝だった');
	await quietRow.getByRole('button', { name: '非表示にする' }).click();
	await expect(quietRow.getByText('非表示', { exact: true })).toBeVisible();
	await staff.page.goto(qa(path));
	await staff.page.getByRole('region', { name: '非表示の投稿' }).getByRole('link', { name: '運営として対応する' }).click();
	await expect(staff.page).toHaveURL(new RegExp(`/kanri\\?post=${quiet}$`));
	await staff.page.locator('article').filter({ hasText: quietText }).getByLabel('表示に戻すメモ').fill('戻す');
	await staff.page.locator('article').filter({ hasText: quietText }).getByRole('button', { name: '表示に戻す' }).click();
	await viewer.page.goto(qa(path));
	await expect(card(viewer.page, quietText)).toBeVisible();
	// 表示に戻すと本人に届く
	await writer.page.goto('/tsuchi');
	await expect(writer.page.getByRole('link', { name: /表示に戻りました/ }).first()).toBeVisible();

	// 関わった法案の運営にはリンクが出ず、?post= は 404、操作は 403
	await involvedStaff.page.goto(qa(path));
	await expect(card(involvedStaff.page, questionText)).toBeVisible();
	await expect(involvedStaff.page.getByRole('link', { name: '運営として対応する' })).toHaveCount(0);
	expect((await involvedStaff.page.request.get(`/kanri?post=${question}`)).status()).toBe(404);
	expect((await staffRequest(involvedStaff, 'hidePost', { post: question, reason: 'attack', note: 'x' })).status()).toBe(403);
	await involvedStaff.page.goto('/kanri');
	await expect(involvedStaff.page.getByText(questionText)).toHaveCount(0);

	// 関連法案のカードには通報もリンクも出ない
	await staff.page.goto(`${qa(path)}?kanren=1`);
	const relatedCard = card(staff.page, relatedText);
	await expect(relatedCard).toBeVisible();
	await expect(relatedCard.getByRole('button', { name: /通報する/ })).toHaveCount(0);
	await expect(relatedCard.getByRole('link', { name: '運営として対応する' })).toHaveCount(0);

	// 権限のない人には /kanri は 404
	expect((await viewer.page.request.get(`/kanri?post=${question}`)).status()).toBe(404);
});

test('信頼の境界：通報と運営の操作の入力、/kanri の ?post=、/unei の ?shitsugi=', async ({ browser }, info) => {
	const s = setup(browser, info.project.name, 1);
	const now = at(s.month, 5);
	const day15 = at(s.month, 15);
	const { path } = await s.bill(`境界の法案 ${s.label}`, now);
	const writer = await s.person(day15);
	const post = await ask(writer, path, `境界の質疑 ${s.label}`);
	const reporter = await s.person(day15);
	const staff = await s.person(day15, { role: 'operator' });

	// 通報：番号の形は 400、ない番号と別の法案は 404、理由の形と説明の長さは 400
	const badReports: Record<string, string>[] = [{}, { post: 'abc' }, { post: '0' }, { post: '-1' }, { post, reason: 'duplicate' }, { post, reason: 'bad' }, { post, reason: 'other', note: 'あ'.repeat(201) }];
	for (const form of badReports) {
		expect((await reportRequest(reporter, path, form)).status(), JSON.stringify(form)).toBe(400);
	}
	expect((await reportRequest(reporter, path, { post: '99999999' })).status()).toBe(404);
	// 法案の番号の形が違えば 404
	expect((await reportRequest(reporter, '/houan/abc', { post })).status()).toBe(404);

	// 運営の画面の URL：形が違う、ない番号は 404
	for (const q of ['abc', '0', '99999999']) expect((await staff.page.request.get(`/kanri?post=${q}`)).status(), q).toBe(404);

	// 運営の操作：形は 400、ない番号は 404
	const badActions: Record<string, string>[] = [{}, { post: 'abc', reason: 'attack', note: 'x' }, { post, reason: 'bad', note: 'x' }, { post, note: 'x' }, { post, reason: 'attack' }, { post, reason: 'attack', note: 'あ'.repeat(201) }];
	for (const form of badActions) {
		expect((await staffRequest(staff, 'hidePost', form)).status(), JSON.stringify(form)).toBe(400);
	}
	expect((await staffRequest(staff, 'hidePost', { post: '99999999', reason: 'attack', note: 'x' })).status()).toBe(404);
	expect((await staffRequest(staff, 'restorePost', { post, note: '' })).status()).toBe(400);
	expect((await staffRequest(staff, 'restorePost', { post: '99999999', note: 'x' })).status()).toBe(404);

	// 公開の記録のページ：形が違う、行のないページは 404
	for (const q of ['abc', '1', '9999']) expect((await staff.page.request.get(`/unei?shitsugi=${q}`)).status(), q).toBe(404);
});
