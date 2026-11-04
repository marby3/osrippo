// Issue #48 法案の一覧（SpBills・PcBills）
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { billPath, billRequest, issueWithSolutions, newUser, type BillForm } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});

const LAW = '412AC0000000061';
const ip = (project: string, group: number, n: number) => `10.${project === 'sp' ? 44 : 45}.${group}.${n}`;
const stamp = () => Date.now() % 1e8;

async function user(browser: Browser, name: string, ipAddress: string, now?: string): Promise<Page> {
	const u = await newUser(browser, { name, ip: ipAddress, days: 8 });
	contexts.push(u.context);
	if (now) await u.context.setExtraHTTPHeaders({ 'x-test-ip': ipAddress, 'x-test-now': now });
	return u.page;
}

/** 第1条を書きかえる改正の法案のフォームの値 */
async function amendForm(a: Page, solution: string, title: string, extra: BillForm = {}): Promise<BillForm> {
	const res = await a.request.get(`/houan/kaku/joubun?law=${LAW}`);
	const { revisionId } = (await res.json()) as { revisionId: string };
	return {
		kind: 'amend',
		title,
		law: LAW,
		base: revisionId,
		'op.0': 'amend',
		'target.0': '1',
		'caption.0': '（目的）',
		'body.0': 'この法律は、消費者がいつでも契約をやめられるようにすることを目的とする。',
		affected: '解約できずに困っている人',
		sideEffects: '事業者の負担が増える',
		solution,
		'cf-turnstile-response': 'test-pass',
		...extra
	};
}

const tabLink = (page: Page, name: RegExp) => page.getByRole('navigation', { name: '法案のタブ' }).getByRole('link', { name });

test('基準1：ログインしていなくても見られる。タブは審議中・下書き・終わったで、開いたときは審議中', async ({ page }) => {
	await page.goto('/houan');
	await expect(page.getByRole('heading', { level: 1, name: '法案', exact: true })).toBeVisible();
	await expect(tabLink(page, /^審議中 \d+$/)).toHaveAttribute('aria-current', 'page');
	await expect(tabLink(page, /^下書き \d+$/)).toBeVisible();
	await expect(tabLink(page, /^終わった$/)).toBeVisible();
});

test('基準2：「法案を書く」はログインを求め、ログインしていれば解決策から書き始める案内へ。ホームから一覧へ移れる', async ({ browser, page }, info) => {
	const p = info.project.name;
	await page.goto('/');
	await page.getByRole('link', { name: '法案を見る' }).click();
	await expect(page).toHaveURL('/houan');
	await page.getByRole('link', { name: '法案を書く' }).click();
	await expect(page.getByRole('button', { name: 'Googleでログイン' }).or(page.getByRole('link', { name: 'Googleでログイン' }))).toBeVisible();

	const a = await user(browser, `l2-a-${p}-${stamp()}`, ip(p, 2, 1));
	await a.goto('/houan');
	await a.getByRole('link', { name: '法案を書く' }).click();
	await expect(a).toHaveURL('/houan/kaku');
	await expect(a.getByText('法案は、課題の解決策から書き始めます')).toBeVisible();
});

test('基準3：下書きは「下書き」のタブにだけ、保存が新しい順で出る。題名から法案のページへ移る', async ({ browser }, info) => {
	const w = info.project.name;
	const s = stamp();
	// ほかのテストの下書きより新しい時刻で書く（1ページ目に出るように）
	const day = w === 'sp' ? '2032-01-10' : '2032-02-10';
	const a = await user(browser, `l3-a-${w}-${s}`, ip(w, 3, 1), `${day}T09:00:00+09:00`);
	const { ids } = await issueWithSolutions(a, `l3-${w}-${s}`, [`一覧の解決策 ${w}-${s}`]);
	const [older, newer] = [`先に作った下書き ${w}-${s}`, `後に作った下書き ${w}-${s}`];
	const olderBill = billPath(await billRequest(a, '/houan/kaku', await amendForm(a, ids[0], older)));
	await a.context().setExtraHTTPHeaders({ 'x-test-ip': ip(w, 3, 1), 'x-test-now': `${day}T10:00:00+09:00` });
	billPath(await billRequest(a, '/houan/kaku', await amendForm(a, ids[0], newer)));

	const order = async () => {
		await a.goto('/houan?tab=shitagaki');
		const titles = await a.getByRole('main').getByRole('link').allTextContents();
		return [titles.indexOf(older), titles.indexOf(newer)];
	};
	const [o, n] = await order();
	expect(n).toBeGreaterThanOrEqual(0);
	expect(n).toBeLessThan(o);

	// 直すと上に移る
	await a.context().setExtraHTTPHeaders({ 'x-test-ip': ip(w, 3, 1), 'x-test-now': `${day}T11:00:00+09:00` });
	const saved = await billRequest(a, `${olderBill}/kaku`, { ...(await amendForm(a, ids[0], older)), rev: '1' });
	expect(saved.status(), await saved.text()).toBe(303);
	const [o2, n2] = await order();
	expect(o2).toBeLessThan(n2);

	const link = a.getByRole('link', { name: older, exact: true });
	const row = a.getByRole('row').filter({ has: link });
	await expect(row.getByText('改正', { exact: true })).toBeVisible();
	await expect(row.getByText('下書き', { exact: true })).toBeVisible();
	const head = a.getByRole('columnheader', { name: '段階' });
	if (w === 'pc') await expect(head).toBeVisible();
	else await expect(head).toBeHidden();

	// ほかのタブには出ない
	for (const tab of ['/houan', '/houan?tab=shingi', '/houan?tab=owari']) {
		await a.goto(tab);
		await expect(a.getByRole('link', { name: older, exact: true }), tab).toHaveCount(0);
	}
	await a.goto('/houan?tab=shitagaki');
	await a.getByRole('link', { name: older, exact: true }).click();
	await expect(a).toHaveURL(olderBill);
	await expect(a.getByRole('heading', { level: 1, name: older })).toBeVisible();
});

test('信頼の境界：?tab= が決まった値でなければ 404', async ({ request }) => {
	for (const tab of ['', 'abc', 'SHITAGAKI', 'shitagaki ', '1']) {
		expect((await request.get(`/houan?tab=${encodeURIComponent(tab)}`)).status(), tab).toBe(404);
	}
	for (const tab of ['shingi', 'shitagaki', 'owari']) expect((await request.get(`/houan?tab=${tab}`)).status(), tab).toBe(200);
});

test('信頼の境界：?page= の形が違う値と、法案のないページは 404', async ({ request }) => {
	for (const page of ['abc', '0', '1', '-1', '1.5', '01', '9999']) {
		expect((await request.get(`/houan?tab=owari&page=${page}`)).status(), page).toBe(404);
	}
});
