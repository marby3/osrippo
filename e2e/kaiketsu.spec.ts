// Issue #34 解決策（設計書 docs/spec/34.md）
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { newUser, postIssue, reactRequest, solutionRequest, staffRequest, supportRequest } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});

const ip = (project: string, test: number, n: number) => `10.${project === 'sp' ? 7 : 8}.${test}.${n}`;
const stamp = () => Date.now() % 1e8;
const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });

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

/** 解決策を書いて、その番号を返す（課題のページの解決策の article から読む） */
async function postSolution(page: Page, issueId: number, body: string) {
	const res = await solutionRequest(page, issueId, body);
	expect(res.status(), await res.text()).toBe(303);
	expect(res.headers()['location']).toBe(`/kadai/${issueId}`);
}

/** 解決策の番号：課題の解決策の一覧で、本文から探す（各解決策は id="kaiketsu-[番号]" の article。ページ内リンクの行き先） */
async function solutionId(page: Page, issueId: number, body: string) {
	await page.goto(`/kadai/${issueId}/kaiketsu`);
	const id = await page.locator('article').filter({ hasText: body }).getAttribute('id');
	expect(id).toMatch(/^kaiketsu-\d+$/);
	return (id as string).replace('kaiketsu-', '');
}

test('基準1：課題のページに件数と上位3件（わかるの多い順、同じなら新しい順）、4件以上なら全部の一覧へ', async ({ browser }, info) => {
	const p = info.project.name;
	const s = stamp();
	const author = await user(browser, `k1-author-${p}-${s}`, ip(p, 1, 1));
	const issueId = await postIssue(author, { title: `解決策の並び ${p}-${s}` });
	const writer = await user(browser, `k1-writer-${p}-${s}`, ip(p, 1, 2));
	const bodies = ['解決策その1', '解決策その2', '解決策その3', '解決策その4'].map((b) => `${b} ${s}`);
	for (const b of bodies) await postSolution(writer, issueId, b);
	const ids = [];
	for (const b of bodies) ids.push(await solutionId(writer, issueId, b));
	// その2 に2人、その4 に1人
	for (const [n, targets] of [
		[3, [ids[1], ids[3]]],
		[4, [ids[1]]]
	] as const) {
		const r = await user(browser, `k1-r${n}-${p}-${s}`, ip(p, 1, n));
		for (const id of targets) expect((await reactRequest(r, issueId, { solution: id, kind: 'support', op: 'add' })).status()).toBeLessThan(400);
	}

	const viewer = await user(browser, `k1-viewer-${p}-${s}`, ip(p, 1, 9));
	await viewer.goto(`/kadai/${issueId}`);
	await expect(viewer.getByRole('heading', { name: /^解決策\s*4件$/ })).toBeVisible();
	const shown = viewer.locator('article');
	await expect(shown).toHaveCount(3);
	// その2（2人）→ その4（1人）→ その3（0人で新しい）
	await expect(shown.nth(0)).toContainText(bodies[1]);
	await expect(shown.nth(1)).toContainText(bodies[3]);
	await expect(shown.nth(2)).toContainText(bodies[2]);
	await expect(shown.nth(0).getByRole('button', { name: 'この解決策に わかる 2' })).toBeVisible();

	await viewer.getByRole('link', { name: '解決策をすべて見る（4件）' }).click();
	await expect(viewer).toHaveURL(`/kadai/${issueId}/kaiketsu`);
	const all = viewer.locator('article');
	await expect(all).toHaveCount(4);
	await expect(all.nth(3)).toContainText(bodies[0]);
});

test('基準2：解決策を書くと課題のページに出る。ログインが要り、誤りは理由を出し、非表示・統合済みの課題には書けない', async ({ browser, page }, info) => {
	const p = info.project.name;
	const s = stamp();
	const author = await user(browser, `k2-author-${p}-${s}`, ip(p, 2, 1));
	const issueId = await postIssue(author, { title: `解決策を書く ${p}-${s}` });

	await page.goto(`/kadai/${issueId}/kaiketsu/kaku`);
	await expect(page).toHaveURL(`/login?next=%2Fkadai%2F${issueId}%2Fkaiketsu%2Fkaku`);

	const writer = await user(browser, `k2-writer-${p}-${s}`, ip(p, 2, 2));
	await writer.goto(`/kadai/${issueId}`);
	await writer.getByRole('link', { name: '解決策を書く' }).first().click();
	await expect(writer).toHaveURL(`/kadai/${issueId}/kaiketsu/kaku`);
	await hydrated(writer);
	const field = writer.getByLabel('解決策', { exact: true });
	// 誤り（401字。ブラウザの検証を外してサーバーの判定を見る）
	await field.evaluate((el) => el.removeAttribute('maxlength'));
	await field.fill('あ'.repeat(401));
	await writer.getByRole('button', { name: '投稿する' }).click();
	await expect(field).toHaveAccessibleDescription('400字以内で書いてください');
	// 改行を含めて書き直す
	await field.fill(`路面に色で示す ${s}\n標識も足す`);
	await writer.getByRole('button', { name: '投稿する' }).click();
	await expect(writer).toHaveURL(`/kadai/${issueId}`);
	await expect(writer.locator('article').filter({ hasText: `路面に色で示す ${s}` })).toContainText(/標識も足す/);

	// 非表示・統合済みの課題には書けない
	const op = await user(browser, `k2-op-${p}-${s}`, ip(p, 2, 3), { role: 'operator' });
	const hiddenId = await postIssue(author, { title: `非表示 ${p}-${s}` });
	const mergedId = await postIssue(author, { title: `統合済み ${p}-${s}` });
	expect((await staffRequest(op, 'hide', { issue: String(hiddenId), reason: 'spam', note: 'テスト' })).status()).toBeLessThan(400);
	expect((await staffRequest(op, 'merge', { issue: String(mergedId), target: String(issueId), note: 'テスト' })).status()).toBeLessThan(400);
	for (const id of [hiddenId, mergedId]) {
		const res = await solutionRequest(writer, id, '書けないはず');
		expect(res.status(), String(id)).toBe(403);
		expect(await res.text()).toContain('この課題には解決策を書けません');
	}
	expect((await writer.request.get(`/kadai/${hiddenId}/kaiketsu/kaku`)).status()).toBe(404);
	const moved = await writer.request.get(`/kadai/${mergedId}/kaiketsu/kaku`, { maxRedirects: 0 });
	expect(moved.status()).toBe(308);
	expect(moved.headers()['location']).toBe(`/kadai/${issueId}/kaiketsu/kaku`);
});

test('基準3：「わかる」と「考えが変わった」を付け外しでき、両方押せる。自分の解決策には押せない。ログインしていなければログインへ', async ({ browser, page }, info) => {
	const p = info.project.name;
	const s = stamp();
	const author = await user(browser, `k3-author-${p}-${s}`, ip(p, 3, 1));
	const issueId = await postIssue(author, { title: `解決策を押す ${p}-${s}` });
	const body = `自分の解決策 ${s}`;
	await postSolution(author, issueId, body);

	// 自分の解決策には、ボタンの代わりに数だけ
	await author.goto(`/kadai/${issueId}`);
	const own = author.locator('article').filter({ hasText: body });
	await expect(own).toContainText('わかる 0');
	await expect(own.getByRole('button')).toHaveCount(0);

	// ログインしていなければログインへ
	await page.goto(`/kadai/${issueId}`);
	await hydrated(page);
	await page.getByRole('button', { name: 'この解決策に わかる 0' }).click();
	await expect(page).toHaveURL(`/login?next=%2Fkadai%2F${issueId}`);

	const b = await user(browser, `k3-b-${p}-${s}`, ip(p, 3, 2));
	await b.goto(`/kadai/${issueId}`);
	await hydrated(b);
	const card = b.locator('article').filter({ hasText: body });
	const wakaru = card.getByRole('button', { name: /^この解決策に わかる/ });
	const changed = card.getByRole('button', { name: /^この解決策に 考えが変わった/ });
	await expect(wakaru).toHaveAttribute('aria-pressed', 'false');
	await wakaru.click();
	await expect(wakaru).toHaveAccessibleName('この解決策に わかる 1');
	await expect(wakaru).toHaveAttribute('aria-pressed', 'true');
	await changed.click();
	await expect(changed).toHaveAccessibleName('この解決策に 考えが変わった 1');
	await expect(changed).toHaveAttribute('aria-pressed', 'true');
	await expect(wakaru).toHaveAttribute('aria-pressed', 'true');
	await b.reload();
	await expect(wakaru).toHaveAccessibleName('この解決策に わかる 1');
	await wakaru.click();
	await expect(wakaru).toHaveAccessibleName('この解決策に わかる 0');
	await expect(changed).toHaveAccessibleName('この解決策に 考えが変わった 1');
	// 課題そのものの「わかる」は別に読める
	await expect(b.getByRole('button', { name: /^わかる/ })).toHaveAccessibleName(/^わかる\s*0$/);

	// 自分の解決策への POST は断る
	const id = await solutionId(author, issueId, body);
	const self = await reactRequest(author, issueId, { solution: id, kind: 'support', op: 'add' });
	expect(self.status()).toBe(403);
	expect(await self.text()).toContain('自分の解決策には押せません');
});

test('基準4：投稿と押す回数の上限、同じ解決策への同じ回線、日本からだけ、締め出しの間はできない', async ({ browser }, info) => {
	test.setTimeout(120_000);
	const p = info.project.name;
	const s = stamp();
	const author = await user(browser, `k4-author-${p}-${s}`, ip(p, 4, 1));
	const issueId = await postIssue(author, { title: `解決策の上限 ${p}-${s}` });

	// 1アカウント24時間に10件
	const a = await user(browser, `k4-a-${p}-${s}`, ip(p, 4, 2));
	for (let i = 0; i < 10; i++) await postSolution(a, issueId, `上限 a ${i} ${s}`);
	const over = await solutionRequest(a, issueId, `上限 a 10 ${s}`);
	expect(over.status()).toBe(429);
	expect(await over.text()).toContain('解決策は24時間に10件まで書けます');
	// 1回線24時間に20件（a と同じ回線の b が10件書いたあと、c の1件目）
	const b = await user(browser, `k4-b-${p}-${s}`, ip(p, 4, 2));
	for (let i = 0; i < 10; i++) await postSolution(b, issueId, `上限 b ${i} ${s}`);
	const c = await user(browser, `k4-c-${p}-${s}`, ip(p, 4, 2));
	const ipOver = await solutionRequest(c, issueId, `上限 c ${s}`);
	expect(ipOver.status()).toBe(429);
	expect(await ipOver.text()).toContain('この回線から書ける解決策の数を超えました');
	// 登録から24時間は3件
	const fresh = await user(browser, `k4-new-${p}-${s}`, ip(p, 4, 3), { days: 0 });
	for (let i = 0; i < 3; i++) await postSolution(fresh, issueId, `新しい人 ${i} ${s}`);
	const freshOver = await solutionRequest(fresh, issueId, `新しい人 3 ${s}`);
	expect(freshOver.status()).toBe(429);
	expect(await freshOver.text()).toMatch(/\d+月\d+日 \d+時\d{2}分から次の解決策を書けます/);

	// 同じ解決策には同じ回線から3アカウントまで
	const target = await solutionId(a, issueId, `上限 a 0 ${s}`);
	for (let n = 1; n <= 4; n++) {
		const r = await user(browser, `k4-ip${n}-${p}-${s}`, ip(p, 4, 4));
		const res = await reactRequest(r, issueId, { solution: target, kind: 'changed', op: 'add' });
		if (n < 4) {
			expect(res.status(), String(n)).toBeLessThan(400);
			continue;
		}
		expect(res.status()).toBe(429);
		expect(await res.text()).toContain('この回線からは、この解決策にこれ以上押せません');
	}

	// 課題の「わかる」と合わせて5分に10回。超えたら違反に数え、3回で締め出す
	const burst = await user(browser, `k4-burst-${p}-${s}`, ip(p, 4, 5));
	for (let i = 0; i < 5; i++) {
		expect((await supportRequest(burst, issueId, i % 2 ? 'remove' : 'add')).status()).toBeLessThan(400);
		expect((await reactRequest(burst, issueId, { solution: target, kind: 'support', op: i % 2 ? 'remove' : 'add' })).status()).toBeLessThan(400);
	}
	// どちらも最後は「付ける」なので、状態の変わる操作（外す）で数える
	const refused = await reactRequest(burst, issueId, { solution: target, kind: 'support', op: 'remove' });
	expect(refused.status()).toBe(429);
	expect(await refused.text()).toContain('短いあいだに「わかる」や「考えが変わった」を何度も押しました');
	expect((await supportRequest(burst, issueId, 'remove')).status()).toBe(429);
	expect((await reactRequest(burst, issueId, { solution: target, kind: 'changed', op: 'add' })).status()).toBe(429);
	const banned = await solutionRequest(burst, issueId, `締め出し中 ${s}`);
	expect(banned.status()).toBe(429);
	expect(await banned.text()).toContain('課題や解決策の投稿、「わかる」「考えが変わった」、通報ができません');

	// 日本からだけ
	const us = await user(browser, `k4-us-${p}-${s}`, ip(p, 4, 6), { country: 'US' });
	const outside = await solutionRequest(us, issueId, `国外から ${s}`);
	expect(outside.status()).toBe(403);
	expect(await outside.text()).toContain('日本国内からのみ参加できます');
	expect((await reactRequest(us, issueId, { solution: target, kind: 'support', op: 'add' })).status()).toBe(403);
});

test('基準5：似た課題から「わかる」で来た人に、解決策を書く案内を出す', async ({ browser }, info) => {
	const p = info.project.name;
	const s = stamp();
	const c = [...(s * 2 + (p === 'sp' ? 0 : 1)).toString(26)].map((d) => String.fromCharCode(97 + parseInt(d, 26))).join('');
	const author = await user(browser, `k5-author-${p}-${s}`, ip(p, 5, 1));
	const title = `${c}定期購入の解約の電話がつながらない`;
	const issueId = await postIssue(author, { title });

	const writer = await user(browser, `k5-writer-${p}-${s}`, ip(p, 5, 2));
	await writer.goto('/kadai/kaku');
	await hydrated(writer);
	await writer.getByLabel('何に困っていますか？').fill(`${c}定期購入の解約ができない`);
	await writer.getByRole('button', { name: 'これに「わかる」を付ける' }).click();
	await expect(writer.getByText('「わかる」を付けました。考えがあれば、解決策として書いてください')).toBeVisible();
	// 案内を出したら URL から from を消す
	await expect(writer).toHaveURL(`/kadai/${issueId}`);
	await expect(writer.getByRole('link', { name: '解決策を書く' })).toHaveCount(2);

	// ?from=nita を直接開いても、ページのエラーを出さずに案内を出し、URL から from を消す
	const errors: string[] = [];
	writer.on('pageerror', (e) => errors.push(e.message));
	await writer.goto(`/kadai/${issueId}?from=nita`);
	await hydrated(writer);
	await expect(writer.getByText('「わかる」を付けました。考えがあれば、解決策として書いてください')).toBeVisible();
	await expect(writer).toHaveURL(`/kadai/${issueId}`);
	expect(errors).toEqual([]);

	// 「わかる」を付けていない人が同じ URL を開いても出さない
	const other = await user(browser, `k5-other-${p}-${s}`, ip(p, 5, 3));
	await other.goto(`/kadai/${issueId}?from=nita`);
	await expect(other.getByRole('heading', { level: 1, name: title })).toBeVisible();
	await expect(other.getByText('「わかる」を付けました')).toHaveCount(0);
});

test('基準6：課題を統合すると、元の課題の解決策が統合先に出る', async ({ browser }, info) => {
	const p = info.project.name;
	const s = stamp();
	const author = await user(browser, `k6-author-${p}-${s}`, ip(p, 6, 1));
	const sourceId = await postIssue(author, { title: `解決策つきの元 ${p}-${s}` });
	const targetId = await postIssue(author, { title: `解決策の統合先 ${p}-${s}` });
	const writer = await user(browser, `k6-writer-${p}-${s}`, ip(p, 6, 2));
	await postSolution(writer, sourceId, `元の課題の解決策 ${s}`);
	const op = await user(browser, `k6-op-${p}-${s}`, ip(p, 6, 3), { role: 'operator' });
	expect((await staffRequest(op, 'merge', { issue: String(sourceId), target: String(targetId), note: 'テスト' })).status()).toBeLessThan(400);

	await writer.goto(`/kadai/${targetId}`);
	await expect(writer.getByRole('heading', { name: /^解決策\s*1件$/ })).toBeVisible();
	await expect(writer.locator('article').filter({ hasText: `元の課題の解決策 ${s}` })).toBeVisible();
	// 元の課題の解決策の一覧は統合先へ
	await writer.goto(`/kadai/${sourceId}/kaiketsu`);
	await expect(writer).toHaveURL(`/kadai/${targetId}/kaiketsu`);
});

test('基準7：一覧に解決策の数を出し、「解決策あり」で絞り込める', async ({ browser, page }, info) => {
	const p = info.project.name;
	const s = stamp();
	const author = await user(browser, `k7-author-${p}-${s}`, ip(p, 7, 1));
	const withTitle = `解決策のある課題 ${p}-${s}`;
	const withoutTitle = `解決策のない課題 ${p}-${s}`;
	const withId = await postIssue(author, { title: withTitle });
	await postIssue(author, { title: withoutTitle });
	const writer = await user(browser, `k7-writer-${p}-${s}`, ip(p, 7, 2));
	await postSolution(writer, withId, `一覧の解決策1 ${s}`);
	await postSolution(writer, withId, `一覧の解決策2 ${s}`);

	await page.goto('/kadai?sort=new');
	const row = page.locator('tr').filter({ has: page.getByRole('link', { name: withTitle, exact: true }) });
	await expect(row.locator('td').nth(2)).toHaveText(/^\s*(解決策)?\s*2\s*$/);
	await page.getByRole('link', { name: '解決策あり' }).click();
	await expect(page).toHaveURL('/kadai?sort=new&kaiketsu=ari');
	await expect(page.getByRole('link', { name: withTitle, exact: true })).toBeVisible();
	await expect(page.getByRole('link', { name: withoutTitle, exact: true })).toHaveCount(0);
});

test('信頼の境界：解決策の投稿先の課題の番号、押す値、解決策の一覧の page、一覧の kaiketsu', async ({ browser, request }, info) => {
	const p = info.project.name;
	const s = stamp();
	const author = await user(browser, `kb-author-${p}-${s}`, ip(p, 8, 1));
	const issueId = await postIssue(author, { title: `境界 ${p}-${s}` });
	const otherIssue = await postIssue(author, { title: `境界の別の課題 ${p}-${s}` });
	const writer = await user(browser, `kb-writer-${p}-${s}`, ip(p, 8, 2));
	await postSolution(writer, issueId, `境界の解決策 ${s}`);
	const id = await solutionId(writer, issueId, `境界の解決策 ${s}`);
	const viewer = await user(browser, `kb-viewer-${p}-${s}`, ip(p, 8, 3));

	// 投稿先の課題の番号
	for (const bad of ['abc', '01', '0', '9999999999']) {
		expect((await solutionRequest(viewer, bad, '本文')).status(), bad).toBe(404);
		expect((await viewer.request.get(`/kadai/${bad}/kaiketsu/kaku`)).status(), bad).toBe(404);
	}
	// 押す値：形が違えば 400、ほかの課題の解決策・ない解決策は 404
	const forms: Record<string, string>[] = [
		{ solution: id, kind: 'like', op: 'add' },
		{ solution: id, kind: 'support', op: 'toggle' },
		{ solution: 'abc', kind: 'support', op: 'add' },
		{ solution: id, kind: 'support' },
		{ kind: 'support', op: 'add' }
	];
	for (const form of forms) {
		expect((await reactRequest(viewer, issueId, form)).status(), JSON.stringify(form)).toBe(400);
	}
	expect((await reactRequest(viewer, otherIssue, { solution: id, kind: 'support', op: 'add' })).status()).toBe(404);
	expect((await reactRequest(viewer, issueId, { solution: '9999999999', kind: 'support', op: 'add' })).status()).toBe(404);
	// 解決策の一覧の page
	for (const q of ['page=1', 'page=0', 'page=abc', 'page=02', 'page=2']) {
		expect((await request.get(`/kadai/${issueId}/kaiketsu?${q}`)).status(), q).toBe(404);
	}
	// 一覧の kaiketsu
	for (const q of ['kaiketsu=yes', 'kaiketsu=', 'kaiketsu=ARI', 'kaiketsu=ari&topic=current']) {
		expect((await request.get(`/kadai?${q}`)).status(), q).toBe(404);
	}
	expect((await request.get('/kadai?kaiketsu=ari&sort=rising')).status()).toBe(200);
});
