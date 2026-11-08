// Issue #104 基準7と信頼の境界：似た質疑をまとめる（設計書 docs/spec/104.md）。決まりの中身は src/lib/db/question-merge.test.ts
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { billRequest, billSupportRequest, createAmendBill, issueWithSolutions, newUser, ORIGIN, proposeRequest } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});
test.use({ actionTimeout: 15_000 });
test.beforeEach(() => test.setTimeout(240_000));

const stamp = () => Date.now() % 1e8;
/** 基準ごと・幅ごとに別の年を使う（2473年まではほかのテストが使っている） */
const monthOf = (w: string, group: number) => `${2474 + group * 2 + (w === 'sp' ? 0 : 1)}-05`;
const at = (month: string, day: number) => `${month}-${String(day).padStart(2, '0')}T09:00:00+09:00`;

type User = { page: Page; name: string; setNow: (now: string) => Promise<void> };

function setup(browser: Browser, w: string, group: number) {
	const month = monthOf(w, group);
	const label = `g${group}${w}${stamp()}`;
	let seq = 0;
	const person = async (now: string, opts: { days?: number; role?: 'moderator' | 'operator' } = {}): Promise<User> => {
		seq += 1;
		const address = `10.${w === 'sp' ? 113 : 114}.${group}.${seq}`;
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
const mergeRequest = (u: User, form: Record<string, string>) =>
	u.page.request.post('/kanri?/mergeQuestion', { form, headers: { origin: ORIGIN, accept: 'text/html' }, maxRedirects: 0 });

test('基準7：運営が候補を選んでまとめると答弁が移り、まとめた数が出て、本人にリンクつきで出て、/unei に記録が出る。権限のない人と扱えない人はできない', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 0);
	const now = at(s.month, 5);
	const day15 = at(s.month, 15);
	const involvedStaff = await s.person(now, { role: 'moderator' });
	const { b, path } = await s.bill(`整理の法案 ${s.label}`, now, [involvedStaff]);
	await b.setNow(day15);
	await involvedStaff.setNow(day15);

	const w1 = await s.person(day15);
	const w2 = await s.person(day15);
	const sourceText = `解約の窓口はどこですか ${s.label}`;
	const targetText = `解約はどこでできますか ${s.label}`;
	const answerText = `窓口で受け付けます ${s.label}`;
	const source = await ask(w1, path, sourceText);
	const target = await ask(w2, path, targetText);
	const res = await billRequest(b.page, `${qa(path)}?/answer`, { question: source, body: answerText, ...passed });
	expect(res.status(), await res.text()).toBe(200);

	// 運営がタブのリンクから開き、候補を選んでまとめる（取り消せないことが出る）
	const staff = await s.person(day15, { role: 'operator' });
	await staff.page.goto(qa(path));
	await card(staff.page, sourceText).getByRole('link', { name: '運営として対応する' }).first().click();
	await expect(staff.page).toHaveURL(new RegExp(`/kanri\\?post=${source}$`));
	const section = staff.page.getByRole('region', { name: '似た質疑をまとめる' });
	await expect(section.getByText('元に戻せません')).toBeVisible();
	await section.getByRole('radio', { name: targetText }).check();
	await section.getByLabel('まとめるメモ').fill(`同じ内容だった ${s.label}`);
	await section.getByRole('button', { name: 'まとめる', exact: true }).click();
	await expect(staff.page).toHaveURL(new RegExp(`/kanri\\?post=${target}&matome=1$`));
	await expect(staff.page.getByText('質疑をまとめました')).toBeVisible();

	// タブ：元は消え、答弁が統合先に移り、まとめた数が出る。元の本文はほかの人に出ない
	const viewer = await s.person(day15);
	await viewer.page.goto(qa(path));
	await expect(tab(viewer.page)).toHaveText('質疑 1');
	await expect(viewer.page.getByText(sourceText)).toHaveCount(0);
	const merged = card(viewer.page, targetText);
	await expect(merged.getByText('同じ内容の質疑を1件まとめました')).toBeVisible();
	// 押す前にハイドレーションを待つ（全部のテストを流して重いときに、押しても開かないことがあった）
	await viewer.page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
	if (w === 'sp') await merged.getByRole('button', { name: /答弁を読む/ }).click();
	await expect(merged.getByText(answerText)).toBeVisible();

	// 本人：通知からタブへ移り、元の本文と統合先へのリンクが出る
	await w1.page.goto('/tsuchi');
	await w1.page.getByRole('link', { name: /質疑がまとめられました/ }).first().click();
	await expect(w1.page).toHaveURL(new RegExp(`${qa(path)}$`));
	const mine = w1.page.getByRole('region', { name: 'まとめられた質疑' });
	await expect(mine.getByText(sourceText)).toBeVisible();
	await expect(mine.getByRole('link', { name: 'まとめた先の質疑を見る' })).toHaveAttribute('href', `${qa(path)}#shitsugi-${target}`);

	// /unei：統合の記録が出て、元の本文は出ない
	await viewer.page.goto('/unei');
	const log = viewer.page.getByRole('region', { name: '法案の質疑と修正案への対応' });
	const row = log.locator('tr').filter({ hasText: `同じ内容だった ${s.label}` });
	await expect(row.getByText('統合', { exact: true })).toBeVisible();
	await expect(log.getByText(sourceText)).toHaveCount(0);

	// まとめられた質疑は ?post= が 404、答弁は 403
	expect((await staff.page.request.get(`/kanri?post=${source}`)).status()).toBe(404);
	expect((await billRequest(b.page, `${qa(path)}?/answer`, { question: source, body: '遅い答弁', ...passed })).status()).toBe(403);

	// 扱えない運営（法案に賛同した）にはまとめられない。権限のない人には 404
	const another = await ask(w1, path, `もう1つの質疑 ${s.label}`);
	expect((await mergeRequest(involvedStaff, { post: another, target, note: 'x' })).status()).toBe(403);
	expect((await mergeRequest(viewer, { post: another, target, note: 'x' })).status()).toBe(404);
	await viewer.page.goto(qa(path));
	await expect(card(viewer.page, `もう1つの質疑 ${s.label}`)).toBeVisible();
});

test('信頼の境界：?/mergeQuestion の post、target、note', async ({ browser }, info) => {
	const s = setup(browser, info.project.name, 1);
	const now = at(s.month, 5);
	const day15 = at(s.month, 15);
	const { path } = await s.bill(`境界の法案 ${s.label}`, now);
	const writer = await s.person(day15);
	const post = await ask(writer, path, `境界の質疑 ${s.label}`);
	const target = await ask(writer, path, `境界の統合先 ${s.label}`);
	const staff = await s.person(day15, { role: 'operator' });

	const bad: Record<string, string>[] = [{}, { post: 'abc', target, note: 'x' }, { post, target: 'abc', note: 'x' }, { post, note: 'x' }, { post, target }, { post, target, note: '' }, { post, target, note: 'あ'.repeat(201) }];
	for (const form of bad) expect((await mergeRequest(staff, form)).status(), JSON.stringify(form)).toBe(400);
	expect((await mergeRequest(staff, { post: '99999999', target, note: 'x' })).status()).toBe(404);
	expect((await mergeRequest(staff, { post, target: '99999999', note: 'x' })).status()).toBe(400);
	expect((await mergeRequest(staff, { post, target: post, note: 'x' })).status()).toBe(400);
});
