// Issue #170 会期のリプレイ（/kaiki/[YYYY-MM]）。決めたことは Issue #198 の「#170」の節
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { billRequest, billSupportRequest, createAmendBill, ifTarget, IF_LAW, issueWithSolutions, newUser, ORIGIN, postIssue, proposeRequest, type IfTarget } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});
test.use({ actionTimeout: 15_000 });
// 会期の準備を同じワーカーの中で使い回す。1本が落ちても残りは流す。落ちるとワーカーが作り直されるので、年にワーカーの番号を入れる
test.describe.configure({ mode: 'default' });
test.beforeEach(() => test.setTimeout(600_000));

type Width = 'sp' | 'pc';
const stamp = () => Date.now() % 1e8;
const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
/** 幅・ワーカーごとに別の年（ほかのテストが使っていない7000年から）。held は確認中の法案だけの会期 */
const monthOf = (w: Width, held = false) => `${7000 + test.info().workerIndex * 4 + (held ? 2 : 0) + (w === 'sp' ? 0 : 1)}-05`;
const prev = (month: string) => month.replace(/-05$/, '-04');
const next = (month: string) => month.replace(/-05$/, '-06');
const at = (month: string, day: number) => `${month}-${String(day).padStart(2, '0')}T09:00:00+09:00`;
/** IF_LAW の条の位置（ほかのテストが可決しない位置） */
const slot = (w: Width) => 50 + (w === 'sp' ? 0 : 1);
const replayOf = (month: string) => `/kaiki/${month}`;

type User = { page: Page; setNow: (now: string) => Promise<void> };
async function user(browser: Browser, address: string, now: string, name?: string): Promise<User> {
	const u = await newUser(browser, { name, ip: address, days: 8 });
	contexts.push(u.context);
	const setNow = (t: string) => u.context.setExtraHTTPHeaders({ 'x-test-ip': address, 'x-test-now': t });
	await setNow(now);
	return { page: u.page, setNow };
}

/**
 * 主な会期：可決する法案P（IF_LAW の1条を書きかえる。数えた票 賛成10、参考の票 賛成2）と、否決する法案Q（数えた票 反対10）。
 * 割り当てられた法案すべてに投票した人の票だけを数えるので、数えた票の10人は両方に投票する。法案Pの質疑2件に、10人と9人が「考えが変わった」を付ける。
 * 確認中の会期：法案R（賛成10、うち5票は同じ回線）。最後に次の月に結果のページを読んで確定させる
 */
async function build(browser: Browser, w: Width) {
	const month = monthOf(w);
	const heldMonth = monthOf(w, true);
	const label = `r-${w}-${stamp()}`;
	const octet = test.info().workerIndex % 250;
	let seq = 0;
	const person = (now: string, name = true) => {
		seq += 1;
		return user(browser, `10.${w === 'sp' ? 170 : 171}.${octet}.${seq}`, now, name ? `u${seq}-${label}` : undefined);
	};
	async function bill(m: string, title: string, target?: IfTarget) {
		const a = await person(at(m, 5));
		const { issueId, ids } = await issueWithSolutions(a.page, title, [`解決策 ${title}`]);
		const path = await createAmendBill(a.page, title, ids[0], target ? { 'body.0': `IF世界の本文 ${title}` } : {}, target);
		for (let i = 0; i < 3; i++) {
			const b = await person(at(m, 5));
			const res = await billSupportRequest(b.page, path, { op: 'add', rev: '1' });
			expect(res.status(), await res.text()).toBe(200);
		}
		const res = await proposeRequest(a.page, path);
		expect(res.status(), await res.text()).toBe(200);
		return { path, id: path.replace('/houan/', ''), title, issueId, issueTitle: `法案の元の課題 ${title}` };
	}
	const voterNames: string[] = [];
	/** 前の月に課題を書いた人（数えた票になる）。line なら同じ回線 */
	async function voter(m: string, line = false) {
		const name = `v${voterNames.length}-${label}`;
		voterNames.push(name);
		const u = line ? await user(browser, `10.172.${octet}.${w === 'sp' ? 1 : 2}`, at(prev(m), 10), name) : await person(at(prev(m), 10));
		await postIssue(u.page, { title: `前の月の課題 ${name}` });
		await u.setNow(at(m, 22));
		return u;
	}
	const vote = async (u: User, id: string, choice: 'yes' | 'no' = 'yes') => {
		const res = await billRequest(u.page, `/saiketsu/${id}?/vote`, { choice, 'cf-turnstile-response': 'test-pass' });
		expect(res.status(), await res.text()).toBe(200);
	};

	const seed = await person(at(month, 5));
	const target = await ifTarget(seed.page, slot(w));
	const p = await bill(month, `通る法案 ${label}`, target);
	const q = await bill(month, `通らない法案 ${label}`);
	const r = await bill(heldMonth, `確認中の法案 ${label}`);

	const asker = await person(at(month, 15));
	const texts = [`10人が考えを変えた質疑 ${label}`, `9人が考えを変えた質疑 ${label}`];
	const questions: string[] = [];
	for (const text of texts) {
		const res = await billRequest(asker.page, `${p.path}/shitsugi/kaku`, { body: text, 'cf-turnstile-response': 'test-pass' });
		expect(res.status(), await res.text()).toBeLessThan(400);
		await asker.page.goto(`${p.path}/shitsugi`);
		const id = await asker.page.locator('article').filter({ hasText: text }).first().getAttribute('id');
		questions.push((id as string).replace('shitsugi-', ''));
	}

	for (let i = 0; i < 10; i++) {
		const u = await voter(month);
		await vote(u, p.id);
		await vote(u, q.id, 'no');
		// 10人が1件目に、9人が2件目に「考えが変わった」
		for (const question of i < 9 ? questions : questions.slice(0, 1)) {
			const res = await billRequest(u.page, `${p.path}/shitsugi?/evaluate`, { post: question, kind: 'changed', op: 'add' });
			expect(res.status(), await res.text()).toBe(200);
		}
	}
	// 参考の票（前の月に何もしていない人）
	for (let i = 0; i < 2; i++) await vote(await person(at(month, 22)), p.id);
	for (let i = 0; i < 10; i++) await vote(await voter(heldMonth, i < 5), r.id);

	// 次の月に結果のページを読むと、会期の結果が記録され、可決した法案が IF世界に反映される
	const settler = await person(at(next(heldMonth), 2), false);
	await settler.setNow(at(next(month), 2));
	await settler.page.goto(`/saiketsu/${p.id}/kekka`);
	await expect(settler.page.getByText('IF世界の法律になりました')).toBeVisible();
	await settler.setNow(at(next(heldMonth), 2));
	await settler.page.goto(`/saiketsu/${r.id}/kekka`);
	await expect(settler.page.getByText('結果を確認しています')).toBeVisible();
	return { month, heldMonth, label, p, q, r, target, texts, voterNames };
}

const built = new Map<string, ReturnType<typeof build>>();
const session = (browser: Browser, w: Width) => {
	if (!built.has(w)) built.set(w, build(browser, w));
	return built.get(w) as ReturnType<typeof build>;
};

/** ログインしていない人 */
async function anonymous(browser: Browser, now: string) {
	const context = await browser.newContext({ baseURL: ORIGIN, extraHTTPHeaders: { 'x-test-ip': `10.173.${test.info().workerIndex % 250}.${stamp() % 250}`, 'x-test-now': now } });
	contexts.push(context);
	return context.newPage();
}
const region = (u: Page, name: string) => u.getByRole('region', { name, exact: true });
const dataOf = async (u: Page, path: string) => (await u.request.get(`${path}/__data.json`)).text();

test('基準1：終わった会期のページに、課題 → 法案 → 質疑の要点 → 採決 → IF世界で変わった条文の順に出る。終わっていない会期は 404。ログインなしで読める', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const s = await session(browser, w);
	const v = await anonymous(browser, at(next(s.month), 3));
	const res = await v.goto(replayOf(s.month));
	expect(res?.status()).toBe(200);
	await expect(v.getByRole('heading', { level: 1, name: `${Number(s.month.slice(0, 4))}年5月の会期` })).toBeVisible();
	await expect(v.getByRole('main').getByRole('heading', { level: 2 })).toHaveText(['1. 課題', '2. 法案', '3. 質疑の要点', '4. 採決', '5. IF世界で変わった条文']);

	// 課題は、この会期の法案のもとになった課題
	const issues = region(v, '1. 課題');
	await expect(issues.getByRole('link', { name: s.p.issueTitle })).toHaveAttribute('href', `/kadai/${s.p.issueId}`);
	await expect(issues.getByRole('link', { name: s.q.issueTitle })).toHaveAttribute('href', `/kadai/${s.q.issueId}`);
	await expect(issues).not.toContainText(s.r.issueTitle);
	const bills = region(v, '2. 法案');
	await expect(bills.getByRole('link', { name: s.p.title })).toHaveAttribute('href', s.p.path);
	await expect(bills.getByRole('link', { name: s.q.title })).toHaveAttribute('href', s.q.path);
	await expect(bills).not.toContainText(s.r.title);

	// 会期の途中・まだ来ていない会期は 404
	const during = await anonymous(browser, at(s.month, 25));
	expect((await during.goto(replayOf(s.month)))?.status()).toBe(404);
	expect((await v.goto(replayOf('9999-05')))?.status()).toBe(404);
});

test('基準2：採決の節に、数えた票と参考の票の内訳と「ゲームの中の結果です。世論調査ではありません。」が出る。確認中の法案は「結果を確認しています」だけ', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const s = await session(browser, w);
	const v = await anonymous(browser, at(next(s.month), 3));
	await v.goto(replayOf(s.month));
	const votes = region(v, '4. 採決');
	const passed = votes.getByRole('listitem').filter({ hasText: s.p.title });
	await expect(passed.getByText('可決', { exact: true })).toBeVisible();
	await expect(passed).toContainText(/数えた票\s*賛成\s*10\s*・\s*反対\s*0\s*・\s*棄権\s*0/);
	await expect(passed).toContainText(/参考の票\s*賛成\s*2\s*・\s*反対\s*0\s*・\s*棄権\s*0/);
	await expect(passed.getByRole('link', { name: s.p.title })).toHaveAttribute('href', `/saiketsu/${s.p.id}/kekka`);
	const rejected = votes.getByRole('listitem').filter({ hasText: s.q.title });
	await expect(rejected.getByText('否決', { exact: true })).toBeVisible();
	await expect(rejected).toContainText(/数えた票\s*賛成\s*0\s*・\s*反対\s*10\s*・\s*棄権\s*0/);
	await expect(rejected).toContainText(/参考の票\s*賛成\s*0\s*・\s*反対\s*0\s*・\s*棄権\s*0/);
	await expect(votes).toContainText('ゲームの中の結果です。世論調査ではありません。');

	// 確認中の法案だけの会期
	const later = await anonymous(browser, at(next(s.heldMonth), 3));
	await later.goto(replayOf(s.heldMonth));
	const held = region(later, '4. 採決').getByRole('listitem').filter({ hasText: s.r.title });
	await expect(held).toContainText('結果を確認しています');
	await expect(held).not.toContainText(/可決|否決|廃案|数えた票|参考の票|賛成|反対|棄権/);
});

test('基準3：個人の票と、10人未満の区分は出さない', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const s = await session(browser, w);
	const v = await anonymous(browser, at(next(s.month), 3));
	await v.goto(replayOf(s.month));
	// 質疑の要点は「考えが変わった」が10人以上の質疑だけ。9人の質疑は出さない
	const points = region(v, '3. 質疑の要点');
	await expect(points).toContainText(s.texts[0]);
	await expect(points).not.toContainText(s.texts[1]);
	// 投票した人の名前も、立場別の分布も、「考えが変わった」の数も出さない
	const main = v.getByRole('main');
	for (const name of s.voterNames.slice(0, 3)) await expect(main).not.toContainText(name);
	await expect(main).not.toContainText(/賛成寄り|反対寄り|まだ決めていない|%/);
	const data = await dataOf(v, replayOf(s.month));
	for (const name of s.voterNames) expect(data).not.toContain(name);
	expect(data).not.toMatch(/"(for|against|undecided|changed|choice|userId)"/);
});

test('基準4：IF世界で変わった条文の節に、紫の斜線の帯と「架空の法令」が出る。ページに noindex を付ける', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const s = await session(browser, w);
	const v = await anonymous(browser, at(next(s.month), 3));
	await v.goto(replayOf(s.month));
	await hydrated(v);
	await expect(v.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
	const ifWorld = region(v, '5. IF世界で変わった条文');
	const band = ifWorld.locator('[data-if-band]');
	await expect(band).toBeVisible();
	await expect(band).toHaveCSS('background-image', /gradient/);
	await expect(band).toContainText('架空の法令');
	// 書きかえた条と、変わったところ（下線と「＋」）
	await expect(ifWorld).toContainText(s.target.label);
	await expect(ifWorld.locator('ins').first()).toContainText('＋');
	await expect(ifWorld.getByRole('link', { name: 'IF世界の条文を見る' })).toHaveAttribute('href', `/if/hourei/${IF_LAW}`);
	// 否決した法案の条は入らない
	await expect(ifWorld.locator('article')).toHaveCount(1);
});

test('基準5：統計ページの会期の結果から、リプレイへ行ける', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const s = await session(browser, w);
	const v = await anonymous(browser, at(next(s.month), 3));
	await v.goto(`/toukei?kaiki=${s.month}`);
	await hydrated(v);
	await v.getByRole('link', { name: 'この会期のリプレイを読む' }).click();
	await expect(v).toHaveURL(new RegExp(`/kaiki/${s.month}$`));
	await expect(v.getByRole('heading', { level: 1, name: `${Number(s.month.slice(0, 4))}年5月の会期` })).toBeVisible();
});

test('信頼の境界：形の違う会期は 404', async ({ browser }) => {
	const v = await anonymous(browser, '9000-01-02T09:00:00+09:00');
	for (const bad of ['2027-13', '2027-00', 'abc', '2027-5', '0999-05', '2027-05-01', '２０２７-05', 'm8-1', '2027-05%20']) {
		expect((await v.goto(replayOf(bad)))?.status(), bad).toBe(404);
	}
	// 終わった会期は、法案がなくても読める
	expect((await v.goto(replayOf('1000-01')))?.status()).toBe(200);
});
