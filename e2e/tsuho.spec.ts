// Issue #28 課題の通報と自動非表示、運営の画面と記録（設計書 docs/spec/28.md）
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { newUser, postIssue, reportRequest, staffRequest, supportRequest } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});

/** テストごと・幅ごとに別の回線（IP）にする（課題の投稿の 1回線20件に当たらないように） */
const ip = (project: string, test: number, n: number) => `10.${project === 'sp' ? 3 : 4}.${test}.${n}`;
const stamp = () => Date.now() % 1e8;

async function user(
	browser: Browser,
	name: string,
	ipAddress: string,
	opts: { days?: number; role?: 'moderator' | 'operator'; country?: string } = {}
): Promise<Page> {
	const u = await newUser(browser, { name, ip: ipAddress, ...opts });
	contexts.push(u.context);
	return u.page;
}

/** ハイドレーションが済むまで待つ（レイアウトが body に data-hydrated を付ける）。済む前に押すと、ふつうのフォームの送信になる */
const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });

/** 画面から通報する */
async function reportOnPage(page: Page, id: number, reason?: string, note?: string) {
	await page.goto(`/kadai/${id}`);
	await hydrated(page);
	await page.getByRole('button', { name: 'この課題を通報する' }).click();
	if (reason) await page.getByRole('radio', { name: reason }).check();
	if (note) await page.getByLabel('その他の説明').fill(note);
	await page.getByRole('button', { name: '通報する', exact: true }).click();
	await expect(page.getByText('通報を受け付けました')).toBeVisible();
}

/** 登録から2日たった別々の n 人に通報させる */
async function reportBy(browser: Browser, id: number, prefix: string, ipAddress: string, n: number) {
	for (let i = 0; i < n; i++) {
		const r = await user(browser, `${prefix}${i}`, ipAddress);
		expect((await reportRequest(r, id, { reason: 'attack' })).status()).toBe(200);
	}
}

test('基準1：理由を選んで通報すると受け付け、通報済みになる。自分の課題には出さず、ログインしていなければログインへ', async ({ browser, page }, info) => {
	const p = info.project.name;
	const s = stamp();
	const author = await user(browser, `t1-author-${p}-${s}`, ip(p, 1, 1));
	const id = await postIssue(author, { title: `通報のテスト ${p}-${s}` });

	// 自分の課題には出さない
	await author.goto(`/kadai/${id}`);
	await expect(author.getByText('同じことで困っていたら押してください')).toBeVisible();
	await expect(author.getByRole('button', { name: 'この課題を通報する' })).toHaveCount(0);

	// ログインしていなければログインへ
	await page.goto(`/kadai/${id}`);
	await page.getByRole('button', { name: 'この課題を通報する' }).click();
	await expect(page).toHaveURL(`/login?next=%2Fkadai%2F${id}`);

	const b = await user(browser, `t1-b-${p}-${s}`, ip(p, 1, 2));
	await reportOnPage(b, id, 'その他', '同じ内容の書き込みが続いている');
	await b.reload();
	await expect(b.getByText('この課題は通報済みです')).toBeVisible();
	await expect(b.getByRole('button', { name: 'この課題を通報する' })).toHaveCount(0);

	// 直接2回目を送っても、通報済みと返すだけ
	const again = await reportRequest(b, id, { reason: 'spam' });
	expect(again.status()).toBe(200);
	expect(await again.text()).toContain('この課題は通報済みです');
});

test('基準2：登録から24時間たった別々の3人の通報（同じ課題がほかにある、を除く）で非表示になる', async ({ browser, page }, info) => {
	const p = info.project.name;
	const s = stamp();
	const author = await user(browser, `t2-author-${p}-${s}`, ip(p, 2, 1));
	const title = `自動非表示のテスト ${p}-${s}`;
	const id = await postIssue(author, { title });

	// 数えない通報：登録したばかりの人、同じ課題がほかにある
	const fresh = await user(browser, `t2-new-${p}-${s}`, ip(p, 2, 2), { days: 0 });
	expect((await reportRequest(fresh, id, { reason: 'attack' })).status()).toBe(200);
	const dup = await user(browser, `t2-dup-${p}-${s}`, ip(p, 2, 3));
	expect((await reportRequest(dup, id, { reason: 'duplicate' })).status()).toBe(200);
	// 数える通報2人。1人は2回送る（2回目は数えない）
	const r1 = await user(browser, `t2-r1-${p}-${s}`, ip(p, 2, 4));
	expect((await reportRequest(r1, id, { reason: 'attack' })).status()).toBe(200);
	expect((await reportRequest(r1, id, { reason: 'attack' })).status()).toBe(200);
	const r2 = await user(browser, `t2-r2-${p}-${s}`, ip(p, 2, 5));
	expect((await reportRequest(r2, id, {})).status()).toBe(200);
	await page.goto(`/kadai/${id}`);
	await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();

	// 3人目で非表示
	const r3 = await user(browser, `t2-r3-${p}-${s}`, ip(p, 2, 6));
	expect((await reportRequest(r3, id, { reason: 'spam' })).status()).toBe(200);

	const res = await page.goto(`/kadai/${id}`);
	expect(res?.status()).toBe(200);
	expect(await res?.text()).not.toContain(title);
	await expect(page.getByRole('heading', { level: 1, name: '非表示の課題' })).toBeVisible();
	await expect(page.getByText('この課題は通報により非表示になっています')).toBeVisible();
	await expect(page.getByRole('link', { name: 'くわしくは運営の記録へ' })).toHaveAttribute('href', '/unei');
	await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
	await expect(page.getByRole('button', { name: /^わかる/ })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'この課題を通報する' })).toHaveCount(0);
	await page.goto('/kadai?sort=new');
	await expect(page.getByRole('link', { name: title })).toHaveCount(0);

	// 「わかる」も通報も受け付けない
	const other = await user(browser, `t2-other-${p}-${s}`, ip(p, 2, 7));
	expect((await supportRequest(other, id, 'add')).status()).toBe(403);
	const late = await reportRequest(other, id, { reason: 'attack' });
	expect(late.status()).toBe(403);
	expect(await late.text()).toContain('非表示の課題には操作できません');
});

test('基準3：書いた本人と運営・運営協力者には、非表示の課題の本文と理由が出る', async ({ browser }, info) => {
	const p = info.project.name;
	const s = stamp();
	const author = await user(browser, `t3-author-${p}-${s}`, ip(p, 3, 1));
	const title = `本人に見えるテスト ${p}-${s}`;
	const id = await postIssue(author, { title, example: '本人と運営だけが読める具体例' });
	await reportBy(browser, id, `t3-r-${p}-${s}-`, ip(p, 3, 2), 3);

	for (const [viewer, staff] of [
		[author, false],
		[await user(browser, `t3-mod-${p}-${s}`, ip(p, 3, 3), { role: 'moderator' }), true],
		[await user(browser, `t3-op-${p}-${s}`, ip(p, 3, 4), { role: 'operator' }), true]
	] as const) {
		await viewer.goto(`/kadai/${id}`);
		await expect(viewer.getByRole('heading', { level: 1, name: title })).toBeVisible();
		await expect(viewer.getByText('本人と運営だけが読める具体例')).toBeVisible();
		await expect(viewer.getByText('この課題は通報により非表示になっています')).toBeVisible();
		await expect(viewer.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
		await expect(viewer.getByRole('link', { name: '運営として対応する' })).toHaveCount(staff ? 1 : 0);
	}
});

test('基準4：/kanri は運営と運営協力者だけ。通報を受けた課題を、自動で非表示のものを先に、数と理由と説明つきで出す', async ({ browser, page }, info) => {
	const p = info.project.name;
	const s = stamp();
	const author = await user(browser, `t4-author-${p}-${s}`, ip(p, 4, 1));
	const hiddenTitle = `管理の一覧・非表示 ${p}-${s}`;
	const shownTitle = `管理の一覧・表示中 ${p}-${s}`;
	const shownId = await postIssue(author, { title: shownTitle });
	const hiddenId = await postIssue(author, { title: hiddenTitle });
	const reporterName = `t4-reporter-${p}-${s}`;
	const reporter = await user(browser, reporterName, ip(p, 4, 2));
	expect((await reportRequest(reporter, shownId, { reason: 'other', note: '説明の文 ' + s })).status()).toBe(200);
	await reportBy(browser, hiddenId, `t4-r-${p}-${s}-`, ip(p, 4, 3), 3);

	// ログインしていない人、ふつうの参加者には、表示も操作も 404
	expect((await page.request.get('/kanri')).status()).toBe(404);
	expect((await staffRequest(page, 'hide', { issue: String(shownId), reason: 'spam', note: 'メモ' })).status()).toBe(404);
	expect((await reporter.request.get('/kanri')).status()).toBe(404);
	expect((await staffRequest(reporter, 'hide', { issue: String(shownId), reason: 'spam', note: 'メモ' })).status()).toBe(404);
	expect((await staffRequest(reporter, 'restore', { issue: String(hiddenId), note: 'メモ' })).status()).toBe(404);

	const mod = await user(browser, `t4-mod-${p}-${s}`, ip(p, 4, 4), { role: 'moderator' });
	// ?issue= の形が違う・課題がないときは 404（信頼の境界）
	for (const q of ['abc', '01', '0', '9999999999']) {
		expect((await mod.request.get(`/kanri?issue=${q}`)).status(), q).toBe(404);
	}
	await mod.goto('/kanri');
	await expect(mod.getByRole('heading', { level: 1, name: '通報を受けた課題' })).toBeVisible();
	await expect(mod.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
	const block = (title: string) => mod.locator('article').filter({ has: mod.getByRole('link', { name: title }) });
	await expect(block(hiddenTitle)).toContainText('自動で非表示');
	await expect(block(hiddenTitle)).toContainText('通報 3件（数えたもの 3件）');
	await expect(block(hiddenTitle)).toContainText('人への攻撃・差別 3');
	await expect(block(shownTitle)).toContainText('表示中');
	await expect(block(shownTitle)).toContainText('その他 1');
	await expect(block(shownTitle)).toContainText('説明の文 ' + s);
	// 自動で非表示のものが先
	const titles = await mod.locator('article h2').allInnerTexts();
	expect(titles.findIndex((t) => t.includes(hiddenTitle))).toBeLessThan(titles.findIndex((t) => t.includes(shownTitle)));
	// 通報した人は出さない
	expect(await mod.content()).not.toContain(reporterName);
});

test('基準5：非表示にする・表示に戻すができ、状態に合わない操作と自分の課題は断る。表示に戻した課題は自動では消えない', async ({ browser, page }, info) => {
	const p = info.project.name;
	const s = stamp();
	const author = await user(browser, `t5-author-${p}-${s}`, ip(p, 5, 1));
	const title = `運営の操作のテスト ${p}-${s}`;
	const id = await postIssue(author, { title });
	const mod = await user(browser, `t5-mod-${p}-${s}`, ip(p, 5, 2), { role: 'moderator' });

	// 通報されていない課題も ?issue= で扱える。画面から非表示にする
	await mod.goto(`/kanri?issue=${id}`);
	await hydrated(mod);
	const block = mod.locator('article').filter({ has: mod.getByRole('link', { name: title }) });
	await block.getByLabel('非表示にする理由').selectOption({ label: '宣伝・荒らし' });
	await block.getByLabel('非表示にするメモ').fill('宣伝だけの書き込み');
	await block.getByRole('button', { name: '非表示にする' }).click();
	// 状態の欄が変わるまで待つ（ボタンの名前にも「非表示」が入るので、ちょうど一致で見る）
	await expect(block.getByText('非表示', { exact: true })).toBeVisible();

	await page.goto(`/kadai/${id}`);
	await expect(page.getByText('この課題は運営か委員長の確認により非表示になっています（理由：宣伝・荒らし）')).toBeVisible();

	// 状態に合わない操作
	const twice = await staffRequest(mod, 'hide', { issue: String(id), reason: 'spam', note: 'もう一度' });
	expect(twice.status()).toBe(400);
	expect(await twice.text()).toContain('すでに非表示です');

	// 表示に戻す
	await mod.goto(`/kanri?issue=${id}`);
	await hydrated(mod);
	await block.getByLabel('表示に戻すメモ').fill('確認したところ問題なし');
	await block.getByRole('button', { name: '表示に戻す' }).click();
	await expect(block.getByText('表示に戻した', { exact: true })).toBeVisible();
	const back = await staffRequest(mod, 'restore', { issue: String(id), note: 'もう一度' });
	expect(back.status()).toBe(400);
	expect(await back.text()).toContain('表示されています');

	// 表示に戻した課題は、3人の通報でも自動では消えない
	await reportBy(browser, id, `t5-r-${p}-${s}-`, ip(p, 5, 3), 3);
	await page.goto(`/kadai/${id}`);
	await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
	await mod.goto(`/kanri?issue=${id}`);
	await hydrated(mod);
	await expect(block).toContainText('表示に戻したあとの通報 3件');

	// 自分の課題には操作できない（画面にもボタンを出さない）
	const ownId = await postIssue(mod, { title: `運営自身の課題 ${p}-${s}` });
	await mod.goto(`/kanri?issue=${ownId}`);
	const own = mod.locator('article').filter({ has: mod.getByRole('link', { name: `運営自身の課題 ${p}-${s}` }) });
	await expect(own.getByRole('button', { name: '非表示にする' })).toHaveCount(0);
	const self = await staffRequest(mod, 'hide', { issue: String(ownId), reason: 'spam', note: '自分で' });
	expect(self.status()).toBe(403);
	expect(await self.text()).toContain('自分の課題には対応できません');
});

test('基準6：/unei はだれでも見られ、基準と対応の記録を新しい順に出す。名前は出さない', async ({ browser, page }, info) => {
	const p = info.project.name;
	const s = stamp();
	const authorName = `t6-author-${p}-${s}`;
	const author = await user(browser, authorName, ip(p, 6, 1));
	const id = await postIssue(author, { title: `記録のテスト ${p}-${s}` });
	await reportBy(browser, id, `t6-r-${p}-${s}-`, ip(p, 6, 2), 3);
	const op = await user(browser, `t6-op-${p}-${s}`, ip(p, 6, 3), { role: 'operator' });
	const note = `問題のない課題でした ${s}`;
	expect((await staffRequest(op, 'restore', { issue: String(id), note })).status()).toBeLessThan(400);

	await page.goto('/unei');
	await expect(page.getByRole('heading', { level: 1, name: '運営の記録' })).toBeVisible();
	await expect(page.getByRole('heading', { name: '非表示にする基準' })).toBeVisible();
	await expect(page.getByText('登録から24時間たった別々の3人から通報があると')).toBeVisible();
	await expect(page.getByText('「同じ課題がほかにある」の通報では見えなくなりません')).toBeVisible();

	const rows = page.locator('tr').filter({ has: page.getByRole('link', { name: `#${id}`, exact: true }) });
	await expect(rows).toHaveCount(2);
	// 新しい順：表示に戻した記録が先
	// 列：日時、課題、何をしたか、だれが、理由、メモ
	const cell = (row: number, col: number) => rows.nth(row).locator(`td:nth-child(${col})`);
	await expect(cell(0, 1)).toHaveText(/^\d{4}年\d+月\d+日 \d+時\d{2}分$/);
	await expect(cell(0, 3)).toHaveText('表示に戻した');
	await expect(cell(0, 4)).toHaveText('運営');
	await expect(cell(0, 6)).toHaveText(note);
	await expect(cell(1, 3)).toHaveText('自動で非表示');
	await expect(cell(1, 4)).toHaveText('自動');
	await expect(cell(1, 5)).toHaveText('通報が3件');
	const html = await page.content();
	expect(html).not.toContain(authorName);
	expect(html).not.toContain(`t6-r-${p}-${s}`);
	expect(html).not.toContain(`t6-op-${p}-${s}`);
});

test('基準7：通報は24時間に10件まで。超えると違反に数えて締め出す。日本からだけ', async ({ browser }, info) => {
	test.setTimeout(90_000);
	const p = info.project.name;
	const s = stamp();
	const ids: number[] = [];
	for (let a = 0; a < 3; a++) {
		const author = await user(browser, `t7-a${a}-${p}-${s}`, ip(p, 7, a));
		for (let i = 0; i < 5; i++) ids.push(await postIssue(author, { title: `通報の上限 ${p}-${s} ${a}-${i}` }));
	}

	const foreign = await user(browser, `t7-us-${p}-${s}`, ip(p, 7, 10), { country: 'US' });
	const outside = await reportRequest(foreign, ids[0], { reason: 'spam' });
	expect(outside.status()).toBe(403);
	expect(await outside.text()).toContain('日本国内からのみ参加できます');

	const r = await user(browser, `t7-r-${p}-${s}`, ip(p, 7, 11));
	for (let i = 0; i < 10; i++) expect((await reportRequest(r, ids[i], { reason: 'spam' })).status(), String(i)).toBe(200);
	const over = await reportRequest(r, ids[10], { reason: 'spam' });
	expect(over.status()).toBe(429);
	expect(await over.text()).toContain('通報は24時間に10件までできます');
	await reportRequest(r, ids[11], { reason: 'spam' });
	await reportRequest(r, ids[12], { reason: 'spam' });
	const banned = await reportRequest(r, ids[13], { reason: 'spam' });
	expect(banned.status()).toBe(429);
	expect(await banned.text()).toContain('課題や解決策の投稿、「わかる」「考えが変わった」、通報ができません');
});

test('信頼の境界：運営の記録の page の形が違えば 404', async ({ request }) => {
	for (const q of ['page=1', 'page=0', 'page=abc', 'page=02', 'page=10000', 'page=9999']) {
		expect((await request.get(`/unei?${q}`)).status(), q).toBe(404);
	}
	expect((await request.get('/unei')).status()).toBe(200);
});

test('信頼の境界：テスト用のログインの role が moderator・operator でなければ 400', async ({ request }) => {
	for (const role of ['admin', '', 'OPERATOR', 'chair']) {
		expect((await request.get(`/test-login?name=role-check&role=${role}`)).status(), role).toBe(400);
	}
});
