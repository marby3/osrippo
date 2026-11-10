// Issue #127：ホームの「あなたの割り当て法案」のカード（SpHome・PcHome）。割り当てのくじと固定は src/lib/db/votes.test.ts
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { billSupportRequest, billRequest, createAmendBill, issueWithSolutions, newUser, postIssue, proposeRequest } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});
test.use({ actionTimeout: 15_000 });

const HEADING = 'あなたの割り当て法案';
const BEFORE = '採決が始まると、くじで法案が割り当てられます（3本まで）。すべてに投票すると、あなたの票が数えた票になります。';
const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
const card = (page: Page) => page.getByRole('region', { name: new RegExp(`^${HEADING}`) });

/** 基準ごと・幅ごとに別の年を使う（2669年までは採決の見た目のテストが使っている） */
const at = (w: string, n: number, month: number, day: number) =>
	`${2700 + n * 2 + (w === 'sp' ? 0 : 1)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T09:00:00+09:00`;

/** 回線の番号を分けて人を作る。setNow で時刻を変える */
function people(browser: Browser, w: string, n: number) {
	let seq = 0;
	const label = `w${n}${w}${Date.now() % 1e7}`;
	return async (now: string) => {
		const ip = `10.127.${n * 2 + (w === 'sp' ? 0 : 1)}.${++seq}`;
		const u = await newUser(browser, { name: `p${seq}${label}`, ip, days: 8 });
		contexts.push(u.context);
		const setNow = (t: string) => u.context.setExtraHTTPHeaders({ 'x-test-ip': ip, 'x-test-now': t });
		await setNow(now);
		return { page: u.page, setNow, label };
	};
}

/** 5月5日に発議した法案（5月22日から採決）。賛同した3人と提出者を返す */
async function proposedBill(browser: Browser, w: string, n: number) {
	const person = people(browser, w, n);
	// 提出者は前の月に課題を書く（投票資格がある。基準4で「割り当てがない」の案内を見るため）
	const author = await person(at(w, n, 4, 10));
	const { ids } = await issueWithSolutions(author.page, `割り当てのカード ${author.label}`, [`解決策 ${author.label}`]);
	await author.setNow(at(w, n, 5, 5));
	const path = await createAmendBill(author.page, `割り当てのカード ${author.label}`, ids[0]);
	for (let i = 0; i < 3; i++) {
		const b = await person(at(w, n, 5, 5));
		expect((await billSupportRequest(b.page, path, { op: 'add', rev: '1' })).status()).toBe(200);
	}
	expect((await proposeRequest(author.page, path)).status()).toBe(200);
	return { author, person, id: path.replace('/houan/', '') };
}

test('基準1：ログインしていないときは、カードを出さない', async ({ page }) => {
	await page.goto('/');
	await hydrated(page);
	await expect(page.getByRole('heading', { name: new RegExp(`^${HEADING}`) })).toHaveCount(0);
});

test('基準2：採決の前は、本数を出さずにくじの案内だけを出し、ボタンは出さない', async ({ browser }, info) => {
	const w = info.project.name;
	const person = people(browser, w, 1);
	const u = await person(at(w, 1, 5, 15));
	await u.page.goto('/');
	await hydrated(u.page);
	await expect(card(u.page).getByRole('heading', { name: HEADING, exact: true })).toBeVisible();
	await expect(card(u.page).getByText(BEFORE, { exact: true })).toBeVisible();
	await expect(card(u.page).getByRole('link')).toHaveCount(0);
	await expect(card(u.page).getByRole('button')).toHaveCount(0);
});

test('基準3：採決の期間は、ホームを開くと割り当てが決まり、本数・投票済みの数・案内と「割り当て法案を見る」を出す', async ({ browser }, info) => {
	test.setTimeout(180_000);
	const w = info.project.name;
	const { person, id } = await proposedBill(browser, w, 2);
	// 投票資格のある人（前の月に課題を書いている）
	const voter = await person(at(w, 2, 4, 10));
	await postIssue(voter.page, { title: `前の月の課題 ${voter.label}` });
	await voter.setNow(at(w, 2, 5, 22));

	await voter.page.goto('/');
	await hydrated(voter.page);
	const c = card(voter.page);
	await expect(c.getByRole('heading', { name: `${HEADING} 1本`, exact: true })).toBeVisible();
	await expect(c.getByText('投票済み 0 / 1本', { exact: true })).toBeVisible();
	await expect(c).toContainText('割り当ての法案に投票すると、あなたの票が数えた票になります。');
	const link = c.getByRole('link', { name: '割り当て法案を見る', exact: true });
	await expect(link).toHaveAttribute('href', '/saiketsu');

	// ホームで決まった割り当てが、採決の一覧の割り当てになっている
	await link.click();
	await expect(voter.page).toHaveURL(/\/saiketsu$/);
	await expect(voter.page.locator('[data-assignment]')).toHaveCount(1);
	await expect(voter.page.locator(`[data-assignment] a[href="/saiketsu/${id}"]`)).toHaveCount(1);

	const res = await billRequest(voter.page, `/saiketsu/${id}?/vote`, { choice: 'yes', 'cf-turnstile-response': 'test-pass' });
	expect(res.status()).toBe(200);
	await voter.page.goto('/');
	await expect(c.getByText('投票済み 1 / 1本', { exact: true })).toBeVisible();
	await expect(c).toContainText('割り当ての法案はすべて投票済みです。あなたの票は数えた票になります。');

	// 投票資格のない人（会期の前に参加していない）には参考の票の案内
	const fresh = await person(at(w, 2, 5, 22));
	await fresh.page.goto('/');
	await expect(card(fresh.page).getByRole('heading', { name: `${HEADING} 1本`, exact: true })).toBeVisible();
	await expect(card(fresh.page)).toContainText('このアカウントの票は参考の票として数えます。');
});

test('基準4：割り当てが0本のときは、本数を出さずに「今回は割り当ての法案がありません」と「採決の一覧へ」を出す', async ({ browser }, info) => {
	test.setTimeout(180_000);
	const w = info.project.name;
	// 採決する法案は自分の出した1本だけなので、くじの候補がない
	const { author } = await proposedBill(browser, w, 3);
	await author.setNow(at(w, 3, 5, 22));
	await author.page.goto('/');
	await hydrated(author.page);
	const c = card(author.page);
	await expect(c.getByRole('heading', { name: HEADING, exact: true })).toBeVisible();
	await expect(c).toContainText('今回は割り当ての法案がありません。');
	await expect(c.getByText(/投票済み/)).toHaveCount(0);
	await expect(c.getByRole('link', { name: '採決の一覧へ', exact: true })).toHaveAttribute('href', '/saiketsu');
});

test('基準5：スマホは今の会期と探す欄のあいだ、PC は右の列。枠線で囲み、ボタンは押しやすい大きさ', async ({ browser }, info) => {
	test.setTimeout(180_000);
	const w = info.project.name;
	const { person } = await proposedBill(browser, w, 4);
	const u = await person(at(w, 4, 5, 22));
	await u.page.goto('/');
	await hydrated(u.page);
	const c = card(u.page);
	const box = (await c.boundingBox())!;
	const session = (await u.page.getByRole('region', { name: /^いまは/ }).boundingBox())!;
	const search = (await u.page.locator('main form[action="/kensaku"]').boundingBox())!;
	if (w === 'sp') {
		expect(box.y).toBeGreaterThanOrEqual(session.y + session.height);
		expect(box.y + box.height).toBeLessThanOrEqual(search.y);
	} else {
		// 今の会期の右に並び、上の端がそろう
		expect(box.x).toBeGreaterThanOrEqual(session.x + session.width);
		expect(Math.abs(box.y - session.y)).toBeLessThan(24);
	}
	expect(await c.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe('solid');
	const button = (await c.getByRole('link', { name: '割り当て法案を見る', exact: true }).boundingBox())!;
	expect(button.height).toBeGreaterThanOrEqual(44);
});
