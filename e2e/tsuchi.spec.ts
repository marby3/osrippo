// Issue #78 基準9と信頼の境界：通知の一覧。中身は src/lib/db/notifications.test.ts
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { billRequest, billSupportRequest, createAmendBill, issueWithSolutions, newUser, ORIGIN, proposeRequest } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});
test.use({ actionTimeout: 15_000 });
test.beforeEach(() => test.setTimeout(180_000));

const stamp = () => Date.now() % 1e8;
/** 幅ごとに別の年を使う（2429年までは委員会のテストが使っている） */
const monthOf = (w: string, group: number) => `${2450 + group * 3 + (w === 'sp' ? 0 : 1)}-05`;
const at = (month: string, day: number) => `${month}-${String(day).padStart(2, '0')}T09:00:00+09:00`;

type User = { page: Page; name: string; setNow: (now: string) => Promise<void> };
function people(browser: Browser, w: string, group: number) {
	const label = `t${group}${w}${stamp()}`;
	let seq = 0;
	const person = async (now: string): Promise<User> => {
		seq += 1;
		const address = `10.${w === 'sp' ? 104 : 105}.${group}.${seq}`;
		const name = `u${seq}-${label}`;
		const u = await newUser(browser, { name, ip: address, days: 8 });
		contexts.push(u.context);
		const setNow = (t: string) => u.context.setExtraHTTPHeaders({ 'x-test-ip': address, 'x-test-now': t });
		await setNow(now);
		return { page: u.page, name, setNow };
	};
	return { label, person };
}

const request = (page: Page, path: string) => billRequest(page, `${path}?/cosponsor`, { op: 'request' });
const entry = (page: Page, n: number) => page.getByRole('link', { name: `通知（未読 ${n}件）`, exact: true });
const items = (page: Page) => page.getByRole('main').getByRole('listitem');

test('基準9：通知の一覧が新しい順に出て、未読の印とリンクがあり、開くと既読になる', async ({ browser }, info) => {
	const s = people(browser, info.project.name, 1);
	const month = monthOf(info.project.name, 1);
	const title = `通知の法案 ${s.label}`;
	const author = await s.person(at(month, 5));
	const { ids } = await issueWithSolutions(author.page, title, [`解決策 ${title}`]);
	const path = await createAmendBill(author.page, title, ids[0]);

	// 申し出があると、ホームとわたしの記録に未読の数が出る
	await author.page.goto('/');
	await expect(entry(author.page, 0)).toBeVisible();
	const asker = await s.person(at(month, 5));
	expect((await request(asker.page, path)).status()).toBe(200);
	await author.page.goto('/watashi');
	await expect(entry(author.page, 1)).toBeVisible();
	await author.page.goto('/');
	await expect(entry(author.page, 1)).toHaveAttribute('data-sveltekit-preload-data', 'off');
	await entry(author.page, 1).click();

	// 一覧：文、未読の印、帯、noindex
	await expect(author.page).toHaveURL(/\/tsuchi$/);
	await expect(items(author.page)).toHaveCount(1);
	await expect(items(author.page).first()).toContainText(`法案「${title}」に共同提出者の申し出がありました`);
	await expect(items(author.page).first()).toContainText('未読');
	await expect(author.page.locator('[data-if-band]')).toBeVisible();
	await expect(author.page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');

	// 開き直すと未読の印は消え、数も 0 に戻る。リンクで法案へ移れる
	await author.page.goto('/tsuchi');
	await expect(items(author.page).first()).not.toContainText('未読');
	await author.page.goto('/');
	await expect(entry(author.page, 0)).toBeVisible();
	await author.page.goto('/tsuchi');
	await items(author.page).first().getByRole('link').click();
	await expect(author.page).toHaveURL(new RegExp(`${path}$`));

	// 時刻から求める項目も数え、行と合わせて新しい順に並ぶ
	await author.setNow(at(month, 23));
	await author.page.goto('/');
	await expect(entry(author.page, 1)).toBeVisible();
	const second = await s.person(at(month, 24));
	await author.setNow(at(month, 24));
	const draft2 = `2本目 ${s.label}`;
	const made = await issueWithSolutions(author.page, draft2, [`解決策 ${draft2}`]);
	const path2 = await createAmendBill(author.page, draft2, made.ids[0]);
	expect((await request(second.page, path2)).status()).toBe(200);
	await author.page.goto('/tsuchi');
	await expect(items(author.page)).toHaveCount(3);
	await expect(items(author.page).nth(0)).toContainText(`法案「${draft2}」に共同提出者の申し出がありました`);
	await expect(items(author.page).nth(0)).toContainText('未読');
	await expect(items(author.page).nth(1)).toContainText('委員長選挙が始まりました');
	await expect(items(author.page).nth(1)).toContainText('未読');
	await expect(items(author.page).nth(2)).toContainText(`法案「${title}」に共同提出者の申し出がありました`);
	await expect(items(author.page).nth(2)).not.toContainText('未読');
	await items(author.page).nth(1).getByRole('link').click();
	await expect(author.page).toHaveURL(/\/iinkai$/);

	// ほかの人の通知は見えない。ページのデータにも載らない
	await asker.page.goto('/tsuchi');
	await expect(asker.page.getByRole('main').getByText(title)).toHaveCount(0);
	expect(await (await asker.page.request.get('/tsuchi/__data.json')).text()).not.toContain(title);
	const data = await (await author.page.request.get('/tsuchi/__data.json')).text();
	for (const word of [asker.name, second.name, 'userId', 'targetId', 'refId']) expect(data, word).not.toContain(word);

	// ログインしていなければログインへ。ホームに入口は出ない
	const anonymous = await browser.newContext({ baseURL: ORIGIN, extraHTTPHeaders: { 'x-test-now': at(month, 24) } });
	contexts.push(anonymous);
	const stranger = await anonymous.newPage();
	await stranger.goto('/tsuchi');
	await expect(stranger).toHaveURL(/\/login\?next=%2Ftsuchi$/);
	await stranger.goto('/');
	await expect(stranger.getByRole('link', { name: /^通知/ })).toHaveCount(0);

	// 会期の結果の通知（本物の D1 の batch を通す）：発議した法案に票がないまま次の次の月になると、廃案が届く
	const lapsed = `廃案の法案 ${s.label}`;
	const madeLapsed = await issueWithSolutions(author.page, lapsed, [`解決策 ${lapsed}`]);
	const lapsedPath = await createAmendBill(author.page, lapsed, madeLapsed.ids[0]);
	for (let i = 0; i < 3; i++) {
		const backer = await s.person(at(month, 24));
		expect((await billSupportRequest(backer.page, lapsedPath, { op: 'add', rev: '1' })).status()).toBe(200);
	}
	expect((await proposeRequest(author.page, lapsedPath)).status()).toBe(200);
	await author.setNow(at(month.replace(/-05$/, '-07'), 1));
	await author.page.goto(`/saiketsu/${lapsedPath.replace('/houan/', '')}/kekka`);
	await author.page.goto('/tsuchi');
	await expect(items(author.page).filter({ hasText: `法案「${lapsed}」は定足数に届かず廃案になりました` })).toHaveCount(1);
});

test('信頼の境界：page の形が違えば 404 で、既読にしない', async ({ browser }, info) => {
	const s = people(browser, info.project.name, 2);
	const month = monthOf(info.project.name, 2);
	const u = await s.person(at(month, 23));
	for (const bad of ['abc', '0', '-1', '1e3', '1.5', '']) expect((await u.page.goto(`/tsuchi?page=${bad}`))?.status(), bad).toBe(404);
	await u.page.goto('/');
	await expect(entry(u.page, 1)).toBeVisible();
	// 項目のないページでは既読にしない
	expect((await u.page.goto('/tsuchi?page=2'))?.status()).toBe(200);
	await u.page.goto('/');
	await expect(entry(u.page, 1)).toBeVisible();
});
