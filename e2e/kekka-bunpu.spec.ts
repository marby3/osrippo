// Issue #87 採決の結果の立場別の分布と「会期中の考えの動き」。集計のルールは src/lib/domain/stance-stats.test.ts、残し方は src/lib/db/stance-stats.test.ts
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { billRequest, billSupportRequest, createAmendBill, issueWithSolutions, newUser, postIssue, proposeRequest } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});
test.use({ actionTimeout: 15_000 });
// 投票する人を12人作る法案を、同じワーカーの中で基準1・2・3・6が使い回す。
// 順に流すが、1本が落ちても残りは流す（default）。落ちるとワーカーが作り直されるので、月にワーカーの番号を入れてぶつからないようにする
test.describe.configure({ mode: 'default' });
test.beforeEach(() => test.setTimeout(360_000));

type Width = 'sp' | 'pc';
const stamp = () => Date.now() % 1e8;
const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
/** 幅・法案・ワーカーごとに別の年（ほかのテストが使っていない2520年から）。同じ会期に法案が1本だけなら、割り当てを気にせず数えた票になる */
const monthOf = (w: string, group: number) => `${2520 + test.info().workerIndex * 6 + group * 2 + (w === 'sp' ? 0 : 1)}-05`;
const prev = (month: string) => month.replace(/-05$/, '-04');
const next = (month: string) => month.replace(/-05$/, '-06');
const at = (month: string, day: number) => `${month}-${String(day).padStart(2, '0')}T09:00:00+09:00`;

type User = { page: Page; setNow: (now: string) => Promise<void> };

async function user(browser: Browser, address: string, now: string, name?: string): Promise<User> {
	const u = await newUser(browser, { name, ip: address, days: 8 });
	contexts.push(u.context);
	const setNow = (t: string) => u.context.setExtraHTTPHeaders({ 'x-test-ip': address, 'x-test-now': t });
	await setNow(now);
	return { page: u.page, setNow };
}

/**
 * 1本の法案を5日に発議し、voters の人が数えた票を入れる。stance があれば、その人は10日（2週目）にその立場を選ぶ。
 * 返す viewer は締切のあと（次の月の2日）のログインしていない人
 */
async function settled(browser: Browser, w: Width, group: number, voters: { stance?: 'for' | 'against'; choice: 'yes' | 'no' | 'abstain' }[]) {
	const month = monthOf(w, group);
	const label = `b${group}-${w}-${stamp()}`;
	let seq = 0;
	const nextIp = () => `10.${w === 'sp' ? 87 : 88}.${(test.info().workerIndex * 3 + group) % 250}.${++seq}`;
	const person = (now: string) => user(browser, nextIp(), now, `u${seq + 1}-${label}`);
	const title = `分布の法案 ${label}`;
	const a = await person(at(month, 5));
	const { ids } = await issueWithSolutions(a.page, title, [`解決策 ${title}`]);
	const path = await createAmendBill(a.page, title, ids[0]);
	for (let i = 0; i < 3; i++) {
		const b = await person(at(month, 5));
		const res = await billSupportRequest(b.page, path, { op: 'add', rev: '1' });
		expect(res.status(), await res.text()).toBe(200);
	}
	const proposed = await proposeRequest(a.page, path);
	expect(proposed.status(), await proposed.text()).toBe(200);
	const id = path.replace('/houan/', '');
	for (const v of voters) {
		// 前の月に課題を書いた人は、数えた票になる
		const u = await person(at(prev(month), 10));
		await postIssue(u.page, { title: `前の月の課題 ${label} ${seq}` });
		if (v.stance) {
			await u.setNow(at(month, 10));
			const res = await billRequest(u.page, `${path}/shitsugi?/stance`, { stance: v.stance });
			expect(res.status(), await res.text()).toBe(200);
		}
		await u.setNow(at(month, 22));
		const res = await billRequest(u.page, `/saiketsu/${id}?/vote`, { choice: v.choice, 'cf-turnstile-response': 'test-pass' });
		expect(res.status(), await res.text()).toBe(200);
	}
	const viewer = await user(browser, nextIp(), at(next(month), 2));
	return { id, title, month, viewer, nextIp };
}

// 賛成寄りを選んだ10人（賛成2・反対7・棄権1）と、立場を選ばなかった2人（反対）。否決になる
const BIG = [
	...Array.from({ length: 2 }, () => ({ stance: 'for' as const, choice: 'yes' as const })),
	...Array.from({ length: 7 }, () => ({ stance: 'for' as const, choice: 'no' as const })),
	{ stance: 'for' as const, choice: 'abstain' as const },
	...Array.from({ length: 2 }, () => ({ choice: 'no' as const }))
];
// 立場を選ばなかった3人。定足数に届かず廃案
const SMALL = Array.from({ length: 3 }, () => ({ choice: 'yes' as const }));

const built = new Map<string, Promise<{ id: string; title: string; month: string }>>();
/** 同じワーカーの中で一度だけ作る */
function shared(browser: Browser, w: Width, group: number, voters: typeof BIG) {
	const key = `${w}-${group}`;
	if (!built.has(key)) built.set(key, settled(browser, w, group, voters).then(({ id, title, month }) => ({ id, title, month })));
	return built.get(key)!;
}
async function anonymous(browser: Browser, w: Width, now: string) {
	return user(browser, `10.${w === 'sp' ? 89 : 90}.${test.info().workerIndex % 250}.${stamp() % 250}`, now);
}

const kekkaOf = (id: string) => `/saiketsu/${id}/kekka`;
const ugokiOf = (id: string) => `/saiketsu/${id}/kekka/ugoki`;
const section = (u: Page, name: string) => u.getByRole('region', { name });
const cells = async (u: Page, region: string, row: string) => (await section(u, region).getByRole('row').filter({ hasText: row }).getByRole('cell').allInnerTexts()).map((t) => t.trim());
const dataOf = async (u: Page, path: string) => (await u.request.get(`${path}/__data.json`)).text();

test('基準1：結果のページの票の下に、立場ごとの賛成・反対・棄権の割合を5%刻みで出す。人数と参考の票は出さない', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const big = await shared(browser, w, 0, BIG);
	const v = await anonymous(browser, w, at(next(big.month), 2));
	await v.page.goto(kekkaOf(big.id));
	await expect(v.page.getByText('IF世界の法律にはなりません')).toBeVisible();
	const s = section(v.page, '立場別の分布');
	await expect(s).toBeVisible();
	await expect(s.getByRole('columnheader', { name: '賛成' })).toBeVisible();
	await expect(s.getByRole('columnheader', { name: '反対' })).toBeVisible();
	await expect(s.getByRole('columnheader', { name: '棄権' })).toBeVisible();
	// 列の並びは賛成・反対・棄権（行の見出しのあと）
	expect(await cells(v.page, '立場別の分布', '賛成寄りだった人')).toEqual(['20%', '70%', '10%']);
	// 人数は出さない
	await expect(s).not.toContainText(/\d+人/);
	await expect(s).not.toContainText('10');
	// 票の欄より下にある
	const votes = await v.page.getByRole('heading', { name: /数えた票/ }).boundingBox();
	const heading = await s.getByRole('heading', { name: '立場別の分布' }).boundingBox();
	expect(heading!.y).toBeGreaterThan(votes!.y);
});

test('基準2：数えた票を入れた人が10人未満の区分は行ごと出さない。どの区分も出せなければその旨を出す。ページのデータにも入れない', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const big = await shared(browser, w, 0, BIG);
	const v = await anonymous(browser, w, at(next(big.month), 2));
	await v.page.goto(kekkaOf(big.id));
	const s = section(v.page, '立場別の分布');
	// 立場を選ばなかった2人（未定）と、だれもいない反対寄りは出さない
	await expect(s.getByRole('row').filter({ hasText: '未定だった人' })).toHaveCount(0);
	await expect(s.getByRole('row').filter({ hasText: '反対寄りだった人' })).toHaveCount(0);
	await expect(s).toContainText('人数が少ない区分は出していません');
	const data = await dataOf(v.page, kekkaOf(big.id));
	expect(data).not.toMatch(/undecided|against/);
	expect(data).toMatch(/"for"/);

	// 3人だけの法案（廃案）では、分布そのものを出さない
	const small = await shared(browser, w, 1, SMALL);
	await v.setNow(at(next(small.month), 2));
	await v.page.goto(kekkaOf(small.id));
	await expect(v.page.getByText(/定足数/)).toBeVisible();
	const t = section(v.page, '立場別の分布');
	await expect(t).toContainText('人数が少ないため、立場別の分布は出していません');
	await expect(t.getByRole('table')).toHaveCount(0);
	expect(await dataOf(v.page, kekkaOf(small.id))).not.toMatch(/undecided|"for"|against/);
});

test('基準3：結果のページの「会期中の考えの動きを見る」から、1〜4週目の各週の終わりの立場の割合を5%刻みで出す。まだ選んでいない週は未定', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const big = await shared(browser, w, 0, BIG);
	const v = await anonymous(browser, w, at(next(big.month), 2));
	await v.page.goto(kekkaOf(big.id));
	await hydrated(v.page);
	await v.page.getByRole('link', { name: '会期中の考えの動きを見る' }).click();
	await expect(v.page).toHaveURL(new RegExp(`${ugokiOf(big.id)}$`));
	await expect(v.page.getByRole('heading', { level: 1, name: big.title })).toBeVisible();
	const s = section(v.page, '会期中の考えの動き');
	// 列の並びは賛成寄り・未定・反対寄り。10日（2週目）に選んだので、1週目の終わりはまだ未定
	expect(await cells(v.page, '会期中の考えの動き', '1週目')).toEqual(['0%', '100%', '0%']);
	for (const week of ['2週目', '3週目', '4週目']) expect(await cells(v.page, '会期中の考えの動き', week)).toEqual(['100%', '0%', '0%']);
	// 人数は出さない
	await expect(s).not.toContainText(/\d+人/);
});

test('基準4：考えの動きを数える人が10人未満なら、図を出さずその旨を出す。ページのデータにも値を入れない', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const small = await shared(browser, w, 1, SMALL);
	const v = await anonymous(browser, w, at(next(small.month), 2));
	await v.page.goto(kekkaOf(small.id));
	// リンクは人数に関係なく出す
	await expect(v.page.getByRole('link', { name: '会期中の考えの動きを見る' })).toBeVisible();
	await v.page.goto(ugokiOf(small.id));
	const s = section(v.page, '会期中の考えの動き');
	await expect(s).toContainText('人数が少ないため、考えの動きは出していません');
	await expect(s.getByRole('table')).toHaveCount(0);
	await expect(s.locator('[data-motion-week]')).toHaveCount(0);
	expect(await dataOf(v.page, ugokiOf(small.id))).not.toMatch(/undecided|against|"for"/);
});

test('基準5：締切の前は分布もリンクも出さず、動きのページは結果を待つ表示。締切のあとはログインなしで見られる', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const s = await settled(browser, w, 2, SMALL);
	// 締切の前（採決の期間の25日）
	await s.viewer.setNow(at(s.month, 25));
	await s.viewer.page.goto(kekkaOf(s.id));
	await expect(s.viewer.page.getByText('結果は締切のあとに出ます')).toBeVisible();
	await expect(section(s.viewer.page, '立場別の分布')).toHaveCount(0);
	await expect(s.viewer.page.getByRole('link', { name: '会期中の考えの動きを見る' })).toHaveCount(0);
	expect(await dataOf(s.viewer.page, kekkaOf(s.id))).not.toMatch(/stance|undecided/i);
	const before = await s.viewer.page.goto(ugokiOf(s.id));
	expect(before?.status()).toBe(200);
	await expect(s.viewer.page.getByText('結果は締切のあとに出ます')).toBeVisible();
	await expect(section(s.viewer.page, '会期中の考えの動き')).toHaveCount(0);
	expect(await dataOf(s.viewer.page, ugokiOf(s.id))).not.toMatch(/undecided|against|"for"/);
	// IF世界の帯と noindex
	await expect(s.viewer.page.locator('[data-if-band]')).toBeVisible();
	await expect(s.viewer.page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);

	// 締切のあとは、ログインしていなくても見られる
	await s.viewer.setNow(at(next(s.month), 2));
	await s.viewer.page.goto(kekkaOf(s.id));
	await expect(section(s.viewer.page, '立場別の分布')).toBeVisible();
	await s.viewer.page.goto(ugokiOf(s.id));
	await expect(section(s.viewer.page, '会期中の考えの動き')).toBeVisible();
});

test('基準6：図の各部分に立場と割合の文字を付け、同じ値の表も出す。2つの幅で見える', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const big = await shared(browser, w, 0, BIG);
	const v = await anonymous(browser, w, at(next(big.month), 2));
	await v.page.goto(ugokiOf(big.id));
	const s = section(v.page, '会期中の考えの動き');
	// 図：4本の帯。0% の部分は出さず、出す部分には文字がある
	const bars = s.locator('[data-motion-week]');
	await expect(bars).toHaveCount(4);
	await expect(bars.nth(0)).toHaveText(/未定 100%/);
	await expect(bars.nth(0)).not.toContainText('賛成寄り');
	await expect(bars.nth(1)).toHaveText(/賛成寄り 100%/);
	// 図は読み上げず、表で読む
	await expect(s.locator('[data-motion-chart]')).toHaveAttribute('aria-hidden', 'true');
	for (const name of ['賛成寄り', '未定', '反対寄り']) await expect(s.getByRole('columnheader', { name })).toBeVisible();
	// 横にはみ出さない
	const width = await v.page.evaluate(() => document.documentElement.scrollWidth);
	expect(width).toBeLessThanOrEqual(w === 'sp' ? 390 : 1280);
	await expect(bars.nth(1)).toBeVisible();
});
