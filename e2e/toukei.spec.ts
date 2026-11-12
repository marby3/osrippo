// Issue #154 統計ページ（/toukei）。順位のルールは src/lib/domain/toukei.test.ts
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { billRequest, billSupportRequest, createAmendBill, issueWithSolutions, newUser, postIssue, proposeRequest } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});
test.use({ actionTimeout: 15_000 });
// 会期の準備を同じワーカーの中で使い回す。1本が落ちても残りは流す。落ちるとワーカーが作り直されるので、年にワーカーの番号を入れる
test.describe.configure({ mode: 'default' });
test.beforeEach(() => test.setTimeout(600_000));

type Width = 'sp' | 'pc';
type Choice = 'yes' | 'no' | 'abstain';
const stamp = () => Date.now() % 1e8;
const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
/** 幅・会期・ワーカーごとに別の年（ほかのテストが使っていない5000年から） */
const monthOf = (w: Width, group: number) => `${5000 + test.info().workerIndex * 8 + group * 2 + (w === 'sp' ? 0 : 1)}-05`;
const prev = (month: string) => month.replace(/-05$/, '-04');
const next = (month: string) => month.replace(/-05$/, '-06');
const at = (month: string, day: number) => `${month}-${String(day).padStart(2, '0')}T09:00:00+09:00`;
/** どのテストの会期も終わっている時刻 */
const LATER = '9000-01-02T09:00:00+09:00';
const sessionName = (month: string) => `${Number(month.slice(0, 4))}年5月の会期`;

type User = { page: Page; setNow: (now: string) => Promise<void> };
async function user(browser: Browser, address: string, now: string, name?: string, role?: 'operator'): Promise<User> {
	const u = await newUser(browser, { name, ip: address, days: 8, role });
	contexts.push(u.context);
	const setNow = (t: string) => u.context.setExtraHTTPHeaders({ 'x-test-ip': address, 'x-test-now': t });
	await setNow(now);
	return { page: u.page, setNow };
}

/** 1つの会期の準備：人を作る道具と、5日に発議する法案 */
function sessionKit(browser: Browser, w: Width, group: number) {
	const month = monthOf(w, group);
	const label = `t${group}-${w}-${stamp()}`;
	const octet = (test.info().workerIndex * 3 + group) % 250;
	let seq = 0;
	const person = (now: string, role?: 'operator') => user(browser, `10.${w === 'sp' ? 154 : 155}.${octet}.${++seq}`, now, `u${seq + 1}-${label}`, role);
	async function bill(title: string) {
		const a = await person(at(month, 5));
		const { ids } = await issueWithSolutions(a.page, title, [`解決策 ${title}`]);
		const path = await createAmendBill(a.page, title, ids[0]);
		for (let i = 0; i < 3; i++) {
			const b = await person(at(month, 5));
			const res = await billSupportRequest(b.page, path, { op: 'add', rev: '1' });
			expect(res.status(), await res.text()).toBe(200);
		}
		const res = await proposeRequest(a.page, path);
		expect(res.status(), await res.text()).toBe(200);
		return { path, id: path.replace('/houan/', ''), title, author: a };
	}
	/** 前の月に課題を書いた人（数えた票になる）。line なら同じ回線 */
	async function voter(line = false) {
		const u = line ? await user(browser, `10.156.${octet}.${w === 'sp' ? 1 : 2}`, at(prev(month), 10), `l${++seq}-${label}`) : await person(at(prev(month), 10));
		await postIssue(u.page, { title: `前の月の課題 ${label} ${seq}` });
		return u;
	}
	const stance = async (u: User, path: string, value: 'for' | 'against') => {
		await u.setNow(at(month, 10));
		const res = await billRequest(u.page, `${path}/shitsugi?/stance`, { stance: value });
		expect(res.status(), await res.text()).toBe(200);
	};
	const vote = async (u: User, id: string, choice: Choice) => {
		await u.setNow(at(month, 22));
		const res = await billRequest(u.page, `/saiketsu/${id}?/vote`, { choice, 'cf-turnstile-response': 'test-pass' });
		expect(res.status(), await res.text()).toBe(200);
	};
	/** 締切のあとに結果のページを読んで、会期の結果を記録させる */
	const settle = async (id: string) => {
		const v = await person(at(next(month), 2));
		await v.page.goto(`/saiketsu/${id}/kekka`);
		await expect(v.page.getByText(/結果を集計しています/)).toHaveCount(0);
	};
	return { month, label, person, bill, voter, stance, vote, settle };
}

/**
 * 主な会期：法案A（賛成寄り10人：賛成6・反対4、反対寄り10人：賛成2・反対8 → 否決、立場を超えた支持 20%）と
 * 法案B（同じ人で、反対寄りは9人 → 順位に入らない。全員反対 → 否決）。法案Aの質疑2件に10人と9人が「考えが変わった」を付ける
 */
async function buildMain(browser: Browser, w: Width) {
	const k = sessionKit(browser, w, 0);
	const a = await k.bill(`支持の法案A ${k.label}`);
	const b = await k.bill(`支持の法案B ${k.label}`);
	const asker = await k.person(at(k.month, 15));
	const questions: string[] = [];
	const answered = `答弁のついた質疑 ${k.label}`;
	for (const text of [`10人が考えを変えた質疑 ${k.label}`, `9人が考えを変えた質疑 ${k.label}`, answered]) {
		const res = await billRequest(asker.page, `${a.path}/shitsugi/kaku`, { body: text, 'cf-turnstile-response': 'test-pass' });
		expect(res.status(), await res.text()).toBeLessThan(400);
		await asker.page.goto(`${a.path}/shitsugi`);
		const id = await asker.page.locator('article').filter({ hasText: text }).first().getAttribute('id');
		questions.push((id as string).replace('shitsugi-', ''));
	}
	// 3件目の質疑に提出者が答弁する。その答弁に1〜10人目が「考えが変わった」を付ける
	const answerText = `提出者の答弁 ${k.label}`;
	await a.author.setNow(at(k.month, 15));
	const replied = await billRequest(a.author.page, `${a.path}/shitsugi?/answer`, { question: questions[2], body: answerText, 'cf-turnstile-response': 'test-pass' });
	expect(replied.status(), await replied.text()).toBe(200);
	let answerId = '';
	for (let i = 0; i < 20; i++) {
		const u = await k.voter();
		const side = i < 10 ? 'for' : 'against';
		await k.stance(u, a.path, side);
		if (i < 19) await k.stance(u, b.path, side);
		await k.vote(u, a.id, i < 10 ? (i < 6 ? 'yes' : 'no') : i < 12 ? 'yes' : 'no');
		await k.vote(u, b.id, 'no');
		// 1〜10人目は1件目に、11〜19人目は2件目に「考えが変わった」
		if (i < 19) {
			const res = await billRequest(u.page, `${a.path}/shitsugi?/evaluate`, { post: questions[i < 10 ? 0 : 1], kind: 'changed', op: 'add' });
			expect(res.status(), await res.text()).toBe(200);
		}
		if (i < 10) {
			if (!answerId) {
				await u.page.goto(`${a.path}/shitsugi`);
				answerId = (await u.page.locator(`#shitsugi-${questions[2]} section.answer input[name="post"]`).first().getAttribute('value')) as string;
			}
			const res = await billRequest(u.page, `${a.path}/shitsugi?/evaluate`, { post: answerId, kind: 'changed', op: 'add' });
			expect(res.status(), await res.text()).toBe(200);
		}
	}
	await k.settle(a.id);
	return { month: k.month, a: { id: a.id, path: a.path, title: a.title }, b: { id: b.id, path: b.path, title: b.title }, questionTexts: [`10人が考えを変えた質疑 ${k.label}`, `9人が考えを変えた質疑 ${k.label}`], answerText, answeredId: questions[2] };
}

/** 廃案の会期：法案1本に3人が賛成 */
async function buildLapsed(browser: Browser, w: Width) {
	const k = sessionKit(browser, w, 1);
	const d = await k.bill(`廃案の法案 ${k.label}`);
	for (let i = 0; i < 3; i++) await k.vote(await k.voter(), d.id, 'yes');
	await k.settle(d.id);
	return { month: k.month, d: { id: d.id, title: d.title } };
}

/** 確認中の会期：法案1本に10人が賛成し、うち5人が同じ回線（kakunin.spec.ts と同じ形） */
async function buildHeld(browser: Browser, w: Width) {
	const k = sessionKit(browser, w, 2);
	const f = await k.bill(`確認中の法案 ${k.label}`);
	for (let i = 0; i < 10; i++) await k.vote(await k.voter(i < 5), f.id, 'yes');
	await k.settle(f.id);
	const operator = await k.person(LATER, 'operator');
	return { month: k.month, f: { id: f.id, title: f.title }, operator: operator.page.context() };
}

const built = new Map<string, Promise<unknown>>();
function once<T>(key: string, make: () => Promise<T>): Promise<T> {
	if (!built.has(key)) built.set(key, make());
	return built.get(key) as Promise<T>;
}
const main = (browser: Browser, w: Width) => once(`main-${w}`, () => buildMain(browser, w));
const lapsed = (browser: Browser, w: Width) => once(`lapsed-${w}`, () => buildLapsed(browser, w));
const held = (browser: Browser, w: Width) => once(`held-${w}`, () => buildHeld(browser, w));

async function viewer(browser: Browser) {
	return user(browser, `10.157.${test.info().workerIndex % 250}.${stamp() % 250}`, LATER);
}
const page = (key: string) => `/toukei?kaiki=${key}`;
const region = (u: Page, name: string | RegExp) => u.getByRole('region', { name });
const dataOf = async (u: Page, path: string) => (await u.request.get(path.replace('/toukei', '/toukei/__data.json'))).text();

test('基準1：PC はヘッダーの「データ」、スマホは下のタブを5つのまま、わたしの記録・採決の一覧・ホームから行ける。ログインなしで見られる', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const anon = await browser.newContext();
	contexts.push(anon);
	const p = await anon.newPage();
	const res = await p.goto('/toukei');
	expect(res?.status()).toBe(200);
	await expect(p.getByRole('heading', { level: 1, name: 'データ' })).toBeVisible();
	const nav = p.getByRole('navigation', { name: 'メニュー' });
	if (w === 'pc') {
		await expect(nav.getByRole('link', { name: 'データ' })).toHaveAttribute('aria-current', 'page');
		await p.goto('/');
		await nav.getByRole('link', { name: 'データ' }).click();
		await expect(p).toHaveURL(/\/toukei$/);
	} else {
		await expect(nav.getByRole('link')).toHaveCount(5);
		await expect(nav.getByRole('link', { name: 'データ' })).toHaveCount(0);
	}
	// IF世界の結果を出すので、帯と noindex を付ける
	await p.goto('/toukei');
	await expect(p.locator('[data-if-band]')).toBeVisible();
	await expect(p.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
	if (w === 'sp') {
		// ログインしていない人は、ホームの下から
		await p.goto('/');
		await p.getByRole('link', { name: 'データを見る' }).click();
		await expect(p).toHaveURL(/\/toukei$/);
	}
	// わたしの記録から
	// 名前を渡すとログインした人になる
	const u = await user(browser, `10.157.200.${stamp() % 250}`, LATER, `me-${w}-${stamp()}`);
	await u.page.goto('/watashi');
	await u.page.getByRole('main').getByRole('link', { name: 'データ', exact: true }).click();
	await expect(u.page).toHaveURL(/\/toukei$/);
	// 採決の一覧からも
	await u.page.goto('/saiketsu');
	await u.page.getByRole('link', { name: 'データを見る' }).click();
	await expect(u.page).toHaveURL(/\/toukei$/);
});

test('基準2：終わった会期を選べ、最初はいちばん新しい会期。選んだ会期は URL に残る。形の違う会期・まだ終わっていない会期は 404', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const m = await main(browser, w);
	const l = await lapsed(browser, w);
	const v = await viewer(browser);
	await v.page.goto('/toukei');
	await hydrated(v.page);
	const select = v.page.getByLabel('会期', { exact: true });
	const options = await select.locator('option').allInnerTexts();
	// 最初に出るのは選択肢の先頭（ほかのテストの会期も並ぶので、どの会期かは決めない）
	expect(await select.locator('option:checked').innerText()).toBe(options[0]);
	await expect(v.page.getByRole('heading', { level: 2, name: `${options[0]}の法案の結果` })).toBeVisible();
	// 自分の2つの会期は新しい順（廃案の会期のほうが2年あと）
	expect(options.indexOf(sessionName(l.month))).toBeGreaterThanOrEqual(0);
	expect(options.indexOf(sessionName(m.month))).toBeGreaterThan(options.indexOf(sessionName(l.month)));
	// 選ぶと URL に残る
	await select.selectOption({ label: sessionName(m.month) });
	await v.page.getByRole('button', { name: '表示する' }).click();
	await expect(v.page).toHaveURL(new RegExp(`\\?kaiki=${m.month}$`));
	await expect(v.page.getByRole('heading', { level: 2, name: `${sessionName(m.month)}の法案の結果` })).toBeVisible();
	await expect(region(v.page, /法案の結果/)).toContainText(m.a.title);
	// 404
	for (const bad of ['abc', '2050-13', '9999-05']) expect((await v.page.goto(page(bad)))?.status(), bad).toBe(404);
});

test('基準3：会期の法案ごとに題名・可否・数えた票と結果のページへのリンク。確認中は可否と票を出さない。廃案と、無効になった法案は廃案と出す', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const m = await main(browser, w);
	const v = await viewer(browser);
	await v.page.goto(page(m.month));
	const results = region(v.page, /法案の結果/);
	const rowA = results.getByRole('row').filter({ hasText: m.a.title });
	await expect(rowA.getByRole('cell')).toHaveText([m.a.title, '否決', '8', '12', '0']);
	await expect(rowA.getByRole('link', { name: m.a.title })).toHaveAttribute('href', `/saiketsu/${m.a.id}/kekka`);
	await expect(results.getByRole('row').filter({ hasText: m.b.title }).getByRole('cell')).toHaveText([m.b.title, '否決', '0', '20', '0']);

	const l = await lapsed(browser, w);
	await v.page.goto(page(l.month));
	await expect(region(v.page, /法案の結果/).getByRole('row').filter({ hasText: l.d.title }).getByRole('cell')).toHaveText([l.d.title, '廃案', '3', '0', '0']);

	const h = await held(browser, w);
	await v.page.goto(page(h.month));
	const rowF = region(v.page, /法案の結果/).getByRole('row').filter({ hasText: h.f.title });
	await expect(rowF).toContainText('結果を確認しています');
	await expect(rowF).not.toContainText(/可決|否決|廃案/);
	expect(await dataOf(v.page, page(h.month))).not.toMatch(/"(yes|no|abstain|passed|rejected|lapsed)"/);
	// 運営が無効にすると廃案（結果の行の可否は可決のまま残っている）
	const op = await h.operator.newPage();
	const voided = await billRequest(op, '/kanri?/voidReview', { bill: h.f.id, session: h.month, note: `同じ回線の票 ${h.f.title}` });
	expect(voided.status(), await voided.text()).toBe(200);
	await v.page.goto(page(h.month));
	await expect(region(v.page, /法案の結果/).getByRole('row').filter({ hasText: h.f.title }).getByRole('cell')).toHaveText([h.f.title, '廃案', '10', '0', '0']);
});

test('基準4：立場を超えた支持が多い法案。両方のグループが10人以上の法案だけを、割合（5%刻み）で出す。人数はページのデータにも出さない', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const m = await main(browser, w);
	const v = await viewer(browser);
	await v.page.goto(page(m.month));
	const s = region(v.page, '立場を超えた支持が多い法案');
	await expect(s.getByRole('listitem').filter({ hasText: m.a.title })).toContainText('立場を超えた支持 20%');
	await expect(s.getByRole('link', { name: m.a.title })).toHaveAttribute('href', `/saiketsu/${m.a.id}/kekka`);
	// 反対寄りが9人の法案は入らない
	await expect(s).not.toContainText(m.b.title);
	const data = await dataOf(v.page, page(m.month));
	expect(data).not.toMatch(/"(for|against|undecided)"/);

	// 入る法案がない会期
	const l = await lapsed(browser, w);
	await v.page.goto(page(l.month));
	await expect(region(v.page, '立場を超えた支持が多い法案')).toContainText('人数が足りる法案がまだありません');
});

test('基準5：「考えが変わった」を10人以上が付けた質疑を出す。9人の質疑は出さない。付いた数はページのデータにも出さない', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const m = await main(browser, w);
	const v = await viewer(browser);
	await v.page.goto(page(m.month));
	const s = region(v.page, '考えが変わったと言われた質疑');
	const item = s.getByRole('listitem').filter({ hasText: m.questionTexts[0] });
	await expect(item).toContainText('質疑');
	await expect(item).toContainText(m.a.title);
	const link = item.getByRole('link', { name: m.questionTexts[0] });
	await expect(link).toHaveAttribute('href', new RegExp(`^${m.a.path}/shitsugi#shitsugi-\\d+$`));
	await expect(s).not.toContainText(m.questionTexts[1]);
	// 答弁は「答弁」と出し、親の質疑へのリンク
	const answer = s.getByRole('listitem').filter({ hasText: m.answerText });
	await expect(answer).toContainText('答弁');
	await expect(answer.getByRole('link', { name: m.answerText })).toHaveAttribute('href', `${m.a.path}/shitsugi#shitsugi-${m.answeredId}`);
	expect(await dataOf(v.page, page(m.month))).not.toMatch(/changed/);

	const l = await lapsed(browser, w);
	await v.page.goto(page(l.month));
	await expect(region(v.page, '考えが変わったと言われた質疑')).toContainText('まだありません');
});

test('基準6：2つの幅で横にはみ出さず、実装用語を出さない', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const m = await main(browser, w);
	const v = await viewer(browser);
	await v.page.goto(page(m.month));
	await hydrated(v.page);
	const width = await v.page.evaluate(() => document.documentElement.scrollWidth);
	expect(width).toBeLessThanOrEqual(w === 'sp' ? 390 : 1280);
	await expect(v.page.getByRole('main')).not.toContainText(/橋渡し|bridge|stance|session|有効票|参考票/i);
});
