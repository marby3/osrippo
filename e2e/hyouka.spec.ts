// Issue #67 評価のボタンと読んだ記録（設計書 docs/spec/67.md）。立場・スコア・上限は src/lib/db/evaluations.test.ts と src/lib/domain/evaluations.test.ts
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { billRequest, billSupportRequest, createAmendBill, issueWithSolutions, newUser, proposeRequest } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});
test.use({ actionTimeout: 15_000 });

const ip = (w: string, group: number, n: number) => `10.${w === 'sp' ? 64 : 65}.${group}.${n}`;
const stamp = () => Date.now() % 1e8;
const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });

/** 基準ごと・幅ごとに別の年を使う（2045〜2062年は質疑のテストが使っている） */
const monthOf = (w: string, group: number) => `${2065 + group * 2 + (w === 'sp' ? 0 : 1)}-05`;
const at = (month: string, day: number) => `${month}-${String(day).padStart(2, '0')}T09:00:00+09:00`;
const nextMonth = (month: string) => month.replace(/-05$/, '-06');

type User = { page: Page; setNow: (now: string) => Promise<void> };

async function user(browser: Browser, ipAddress: string, now: string, name?: string, days = 8): Promise<User> {
	const u = await newUser(browser, { name, ip: ipAddress, days });
	contexts.push(u.context);
	const setNow = (t: string) => u.context.setExtraHTTPHeaders({ 'x-test-ip': ipAddress, 'x-test-now': t });
	await setNow(now);
	return { page: u.page, setNow };
}

/** 発議した法案。a は提出者、b は賛同者 */
async function proposed(browser: Browser, w: string, group: number, month: string, days = 8) {
	const label = `h${group}-${w}-${stamp()}`;
	const now = at(month, 5);
	const a = await user(browser, ip(w, group, 1), now, `a-${label}`, days);
	const { ids } = await issueWithSolutions(a.page, label, [`評価の解決策 ${label}`]);
	const bill = await createAmendBill(a.page, `評価の法案 ${label}`, ids[0]);
	let b: User | undefined;
	for (const n of [2, 3, 4]) {
		const u = await user(browser, ip(w, group, n), now, `u${n}-${label}`, days);
		const res = await billSupportRequest(u.page, bill, { op: 'add', rev: '1' });
		expect(res.status(), await res.text()).toBe(200);
		b ??= u;
	}
	const res = await proposeRequest(a.page, bill);
	expect(res.status(), await res.text()).toBe(200);
	await a.setNow(at(month, 15));
	await (b as User).setNow(at(month, 15));
	return { a, b: b as User, bill, label };
}

const qa = (bill: string) => `${bill}/shitsugi`;
const card = (page: Page, text: string) => page.locator('article').filter({ hasText: text });
const open = async (u: Page, bill: string, query = '') => {
	await u.goto(qa(bill) + query);
	await hydrated(u);
};
const reasonable = (scope: Page | Locator) => scope.getByRole('button', { name: '筋が通っている', exact: true });
const changed = (scope: Page | Locator) => scope.getByRole('button', { name: '考えが変わった', exact: true });
const isAction = (url: string, name: string) => url.includes(`?/${name}`);

/** 押して、応答を待つ。読んだ記録の POST は除く */
const press = async (u: Page, button: Locator) => {
	const [res] = await Promise.all([u.waitForResponse((r) => r.request().method() === 'POST' && isAction(r.url(), 'evaluate')), button.click()]);
	expect(res.status()).toBe(200);
	expect(await res.text()).not.toContain('"type":"failure"');
};

const question = (u: Page, bill: string, body: string) => billRequest(u, `${qa(bill)}/kaku`, { body, 'cf-turnstile-response': 'test-pass' });
const reply = (u: Page, bill: string, action: 'answer' | 'supplement', q: string, body: string) =>
	billRequest(u, `${qa(bill)}?/${action}`, { question: q, body, 'cf-turnstile-response': 'test-pass' });
/** 質疑を書いて、番号を返す */
async function writeQuestion(u: Page, bill: string, text: string) {
	const res = await question(u, bill, text);
	expect(res.status(), await res.text()).toBeLessThan(400);
	await u.goto(qa(bill));
	const id = await card(u, text).getAttribute('id');
	return (id as string).replace('shitsugi-', '');
}
const evaluateRequest = (u: Page, bill: string, form: Record<string, string>) => billRequest(u, `${qa(bill)}?/evaluate`, form);
/** 読んだ記録のフォームと同じ POST。post は何個でも */
const readRequest = (u: Page, bill: string, ids: string[]) => billRequest(u, `${qa(bill)}?/read`, { post: ids });
/** 画面の読んだ記録の送信を集める */
const watchReads = (u: Page) => {
	const reads: string[][] = [];
	u.on('request', (r) => {
		if (r.method() === 'POST' && isAction(r.url(), 'read')) reads.push(new URLSearchParams(r.postData() ?? '').getAll('post'));
	});
	return reads;
};
const pause = (u: Page, ms: number) => u.waitForTimeout(ms);

test('基準1：答弁待ちは質疑に1組、答弁1件は答弁に1組、2件以上は答弁ごとに1組。補足と自分の投稿には出ない。答弁がついたあとは押した人にだけ押したボタンが残る', async ({ browser }, info) => {
	const w = info.project.name;
	const month = monthOf(w, 1);
	const { a, b, bill, label } = await proposed(browser, w, 1, month);
	const now = at(month, 15);
	const q = await user(browser, ip(w, 1, 5), now, `q-${label}`);
	const v = await user(browser, ip(w, 1, 6), now, `v-${label}`);

	const waiting = `答弁待ちの質疑 ${label}`;
	const single = `答弁1件の質疑 ${label}`;
	const double = `答弁2件の質疑 ${label}`;
	const waitingId = await writeQuestion(q.page, bill, waiting);
	const singleId = await writeQuestion(q.page, bill, single);
	const doubleId = await writeQuestion(q.page, bill, double);
	await reply(a.page, bill, 'answer', singleId, `答弁その1 ${label}`);
	await reply(a.page, bill, 'answer', doubleId, `答弁その2 ${label}`);
	await reply(b.page, bill, 'answer', doubleId, `答弁その3 ${label}`);
	await reply(v.page, bill, 'supplement', waitingId, `補足の本文 ${label}`);

	await open(v.page, bill);
	// 答弁待ち：質疑に1組。補足には増えない
	await expect(card(v.page, waiting).getByText(`補足の本文 ${label}`)).toBeVisible();
	await expect(reasonable(card(v.page, waiting))).toHaveCount(1);
	await expect(changed(card(v.page, waiting))).toHaveCount(1);
	// 答弁1件：カードに1組。スマホでも閉じたまま押せる
	await expect(reasonable(card(v.page, single))).toHaveCount(1);
	await expect(changed(card(v.page, single))).toHaveCount(1);
	// 答弁2件以上：答弁ごとに1組。スマホでは開いた中に出る
	if (w === 'sp') {
		await expect(reasonable(card(v.page, double))).toHaveCount(0);
		await card(v.page, double).getByRole('button', { name: /答弁を読む/ }).click();
	}
	await expect(reasonable(card(v.page, double))).toHaveCount(2);
	await expect(changed(card(v.page, double))).toHaveCount(2);
	for (const text of ['答弁その2', '答弁その3']) {
		await expect(reasonable(card(v.page, double).locator('section').filter({ hasText: text }))).toHaveCount(1);
	}

	// 閉じたまま答弁を評価すると、スマホでは評価した答弁が読めるように開く
	await press(v.page, reasonable(card(v.page, single)));
	await expect(card(v.page, single).getByText(`答弁その1 ${label}`)).toBeVisible();

	// 自分の投稿には出ない：質疑を書いた人の質疑
	await open(q.page, bill);
	await expect(reasonable(card(q.page, waiting))).toHaveCount(0);
	// 自分の答弁には出ず、ほかの人の答弁には出る。提出者は人の質疑に押せる
	await open(a.page, bill);
	await expect(reasonable(card(a.page, waiting))).toHaveCount(1);
	await expect(reasonable(card(a.page, single))).toHaveCount(0);
	if (w === 'sp') await card(a.page, double).getByRole('button', { name: /答弁を読む/ }).click();
	await expect(reasonable(card(a.page, double))).toHaveCount(1);
	await expect(reasonable(card(a.page, double).locator('section').filter({ hasText: '答弁その3' }))).toHaveCount(1);

	// 質疑に押したあとで答弁がつくと、押した人にだけ押したボタンが残り、取り消せる
	await open(v.page, bill);
	await press(v.page, reasonable(card(v.page, waiting)));
	await reply(a.page, bill, 'answer', waitingId, `あとからの答弁 ${label}`);
	await open(v.page, bill);
	const buttons = reasonable(card(v.page, waiting));
	await expect(buttons).toHaveCount(2);
	await expect(buttons.first()).toHaveAttribute('aria-pressed', 'true');
	await expect(buttons.last()).toHaveAttribute('aria-pressed', 'false');
	await expect(changed(card(v.page, waiting))).toHaveCount(1);
	await press(v.page, buttons.first());
	await expect(reasonable(card(v.page, waiting))).toHaveCount(1);
	await expect(reasonable(card(v.page, waiting))).toHaveAttribute('aria-pressed', 'false');
	// 押していない人には答弁の1組だけ
	await open(q.page, bill);
	await expect(reasonable(card(q.page, waiting))).toHaveCount(1);

	// PC は右の列に案の説明文が出る。スマホには出ない
	const hint = v.page.getByText('考えが違っても、筋が通っていると思えば「筋が通っている」を押してください。');
	if (w === 'pc') await expect(hint).toBeVisible();
	else await expect(hint).toBeHidden();
});

test('基準2：Turnstile なしで押せ、読み直しても残り、もう一度押すと外れる。賛同者も押せる。ほかの人の画面に押した状態も数も出ない', async ({ browser }, info) => {
	const w = info.project.name;
	const month = monthOf(w, 2);
	const { b, bill, label } = await proposed(browser, w, 2, month);
	const now = at(month, 15);
	const q = await user(browser, ip(w, 2, 5), now, `q-${label}`);
	const v = await user(browser, ip(w, 2, 6), now, `v-${label}`);
	const other = await user(browser, ip(w, 2, 7), now, `o-${label}`);
	const text = `評価する質疑 ${label}`;
	// 立場を選んでおく（ほかの人のデータに立場が入らないことを確かめるため）
	expect((await billRequest(q.page, `${qa(bill)}?/stance`, { stance: 'against' })).status()).toBe(200);
	expect((await billRequest(v.page, `${qa(bill)}?/stance`, { stance: 'for' })).status()).toBe(200);
	await writeQuestion(q.page, bill, text);

	await open(v.page, bill);
	await expect(reasonable(card(v.page, text))).toHaveAttribute('aria-pressed', 'false');
	await press(v.page, reasonable(card(v.page, text)));
	await expect(reasonable(card(v.page, text))).toHaveAttribute('aria-pressed', 'true');
	await press(v.page, changed(card(v.page, text)));
	await expect(changed(card(v.page, text))).toHaveAttribute('aria-pressed', 'true');

	await open(v.page, bill);
	await expect(reasonable(card(v.page, text))).toHaveAttribute('aria-pressed', 'true');
	await expect(changed(card(v.page, text))).toHaveAttribute('aria-pressed', 'true');

	// 賛同者もほかの人の投稿に押せる
	await open(b.page, bill);
	await press(b.page, reasonable(card(b.page, text)));
	await expect(reasonable(card(b.page, text))).toHaveAttribute('aria-pressed', 'true');

	// ほかの人の画面には、押した状態も数も出ない（ボタンの名前に数がなく、データにも入らない）
	await open(other.page, bill);
	await expect(reasonable(card(other.page, text))).toHaveAttribute('aria-pressed', 'false');
	await expect(changed(card(other.page, text))).toHaveAttribute('aria-pressed', 'false');
	const data = await (await other.page.request.get(`${qa(bill)}/__data.json`)).text();
	expect(data).not.toContain('"for"');
	expect(data).not.toContain('"against"');
	expect(data).not.toContain(`v-${label}`);

	// もう一度押すと外れる
	await open(v.page, bill);
	await press(v.page, reasonable(card(v.page, text)));
	await expect(reasonable(card(v.page, text))).toHaveAttribute('aria-pressed', 'false');
	await open(v.page, bill);
	await expect(reasonable(card(v.page, text))).toHaveAttribute('aria-pressed', 'false');
	await expect(changed(card(v.page, text))).toHaveAttribute('aria-pressed', 'true');
});

test('基準3：ログインなしはログインへ移り絞り込みを保つ。3週目の前と締切のあとは出ず、直接送ると 409。採決の期間は押せる', async ({ browser, page }, info) => {
	const w = info.project.name;
	const month = monthOf(w, 3);
	const { bill, label } = await proposed(browser, w, 3, month);
	const now = at(month, 15);
	const q = await user(browser, ip(w, 3, 5), now, `q-${label}`);
	const v = await user(browser, ip(w, 3, 6), now, `v-${label}`);
	const text = `時期の質疑 ${label}`;
	const id = await writeQuestion(q.page, bill, text);

	// ログインなし：押すとログインへ。読んだ記録は送らない
	await page.context().setExtraHTTPHeaders({ 'x-test-ip': ip(w, 3, 7), 'x-test-now': now });
	const anonymous = watchReads(page);
	await page.goto(`${qa(bill)}?mati=1`);
	await hydrated(page);
	await pause(page, 3500);
	expect(anonymous).toEqual([]);
	await expect(reasonable(card(page, text))).toHaveAttribute('aria-pressed', 'false');
	await reasonable(card(page, text)).click();
	await expect(page).toHaveURL(/\/login\?/);
	expect(new URL(page.url()).searchParams.get('next')).toBe(`${qa(bill)}?mati=1`);

	const form = { post: id, kind: 'reasonable', op: 'add' };
	// 3週目の前（発議の週）：出ず、送ると 409
	await v.setNow(at(month, 5));
	await open(v.page, bill);
	await expect(card(v.page, text)).toBeVisible();
	await expect(reasonable(v.page)).toHaveCount(0);
	expect((await evaluateRequest(v.page, bill, form)).status()).toBe(409);
	expect((await readRequest(v.page, bill, [id])).status()).toBe(409);

	// 採決の期間：押せる
	await v.setNow(at(month, 22));
	await open(v.page, bill);
	await press(v.page, reasonable(card(v.page, text)));
	await expect(reasonable(card(v.page, text))).toHaveAttribute('aria-pressed', 'true');

	// 締切のあと：出ず、送ると 409（取り消しも）
	await v.setNow(at(nextMonth(month), 2));
	await open(v.page, bill);
	await expect(reasonable(v.page)).toHaveCount(0);
	expect((await evaluateRequest(v.page, bill, { ...form, op: 'remove' })).status()).toBe(409);
	expect((await readRequest(v.page, bill, [id])).status()).toBe(409);
});

test('基準3：登録から7日未満の人にはボタンも説明文も出ず、直接送ると 403', async ({ browser }, info) => {
	const w = info.project.name;
	// 登録から7日を時刻の範囲の中で確かめるので、x-test-now を本当の時刻より前の月にする
	const past = new Date(Date.now() - 62 * 86_400_000);
	const month = `${past.getUTCFullYear()}-${String(past.getUTCMonth() + 1).padStart(2, '0')}`;
	const daysSince = (day: number) => Math.ceil((Date.now() - Date.parse(at(month, day))) / 86_400_000);
	const { bill, label } = await proposed(browser, w, 4, month, daysSince(5) + 8);
	const now = at(month, 15);
	const q = await user(browser, ip(w, 4, 5), now, `q-${label}`, daysSince(5) + 8);
	const text = `新しい人が見る質疑 ${label}`;
	const id = await writeQuestion(q.page, bill, text);

	// 15日の時点で登録から3日
	const fresh = await user(browser, ip(w, 4, 6), now, `f-${label}`, daysSince(12));
	const reads = watchReads(fresh.page);
	await open(fresh.page, bill);
	await expect(card(fresh.page, text)).toBeVisible();
	await pause(fresh.page, 3500);
	await expect(reasonable(fresh.page)).toHaveCount(0);
	await expect(fresh.page.getByText('考えが違っても')).toHaveCount(0);
	expect(reads).toEqual([]);
	expect((await evaluateRequest(fresh.page, bill, { post: id, kind: 'reasonable', op: 'add' })).status()).toBe(403);
	expect((await readRequest(fresh.page, bill, [id])).status()).toBe(403);
});

test('基準4：3秒以上画面に出た投稿を読んだことにし、3秒未満では送らない。自分の投稿と答弁のある質疑は送らない。スマホは開くとすぐに送る', async ({ browser }, info) => {
	const w = info.project.name;
	const month = monthOf(w, 5);
	const { a, bill, label } = await proposed(browser, w, 5, month);
	const now = at(month, 15);
	const q = await user(browser, ip(w, 5, 5), now, `q-${label}`);
	const v = await user(browser, ip(w, 5, 6), now, `v-${label}`);
	const waiting = `読む質疑 ${label}`;
	const answered = `答弁のある質疑 ${label}`;
	const waitingId = await writeQuestion(q.page, bill, waiting);
	const answeredId = await writeQuestion(q.page, bill, answered);
	await reply(a.page, bill, 'answer', answeredId, `読む答弁 ${label}`);

	const reads = watchReads(v.page);
	await open(v.page, bill);
	// 開いた直後から2秒は送らない
	await pause(v.page, 2000);
	expect(reads.flat()).not.toContain(waitingId);
	await expect.poll(() => reads.flat(), { timeout: 6000 }).toContain(waitingId);
	expect(reads.flat()).not.toContain(answeredId);

	const answerId = async () => {
		const flat = reads.flat();
		return flat.find((id) => id !== waitingId);
	};
	if (w === 'sp') {
		// スマホは閉じている答弁を読んだことにしない。開くとすぐに送る
		await pause(v.page, 1500);
		expect(await answerId()).toBeUndefined();
		await card(v.page, answered).getByRole('button', { name: /答弁を読む/ }).click();
		await expect.poll(answerId, { timeout: 2500 }).toBeDefined();
	} else {
		// PC は答弁が最初から出ているので、3秒で送る
		await expect.poll(answerId, { timeout: 2000 }).toBeDefined();
	}
	// 同じページで同じ番号を2回送らない
	await pause(v.page, 1500);
	expect(new Set(reads.flat()).size).toBe(reads.flat().length);

	// 自分の投稿は送らない
	const own = watchReads(q.page);
	await open(q.page, bill);
	await pause(q.page, 4500);
	expect(own.flat()).not.toContain(waitingId);
	expect(own.flat()).not.toContain(answeredId);

	// 3秒より短く出ただけなら送らない
	const short = await user(browser, ip(w, 5, 7), now, `s-${label}`);
	const shortReads = watchReads(short.page);
	await open(short.page, bill);
	await pause(short.page, 1000);
	await short.page.goto('/');
	await pause(short.page, 3000);
	expect(shortReads).toEqual([]);
});

test('信頼の境界：?/evaluate は形の違う値を 400、ほかの法案と補足を 404、自分の投稿を 403 にする', async ({ browser }, info) => {
	const w = info.project.name;
	const month = monthOf(w, 6);
	const { bill, label } = await proposed(browser, w, 6, month);
	const now = at(month, 15);
	const other = await proposed(browser, w, 7, month);
	const q = await user(browser, ip(w, 6, 5), now, `q-${label}`);
	const v = await user(browser, ip(w, 6, 6), now, `v-${label}`);
	const id = await writeQuestion(q.page, bill, `境界の質疑 ${label}`);
	const otherId = await writeQuestion(q.page, other.bill, `別の法案の質疑 ${label}`);
	const supplement = await reply(v.page, bill, 'supplement', id, `境界の補足 ${label}`);
	expect(supplement.status()).toBe(200);
	const form = { post: id, kind: 'reasonable', op: 'add' };

	for (const bad of [
		{ ...form, post: 'abc' },
		{ ...form, post: '' },
		{ ...form, kind: 'support' },
		{ ...form, kind: '' },
		{ ...form, op: 'toggle' },
		{ kind: 'reasonable', op: 'add' }
	]) {
		expect((await evaluateRequest(v.page, bill, bad as Record<string, string>)).status(), JSON.stringify(bad)).toBe(400);
	}
	expect((await evaluateRequest(v.page, bill, { ...form, post: otherId })).status()).toBe(404);
	expect((await evaluateRequest(v.page, bill, { ...form, post: '99999999' })).status()).toBe(404);
	// 補足は番号が画面に出ないので、DB のテスト（evaluationTarget）で確かめる
	expect((await evaluateRequest(q.page, bill, form)).status()).toBe(403);
	expect((await billRequest(v.page, '/houan/abc/shitsugi?/evaluate', form)).status()).toBe(404);
	expect((await billRequest(v.page, '/houan/99999999/shitsugi?/evaluate', form)).status()).toBe(404);
	// 断ったあとも押されていない
	await open(v.page, bill);
	await expect(reasonable(card(v.page, `境界の質疑 ${label}`))).toHaveAttribute('aria-pressed', 'false');
});

test('信頼の境界：?/read は形の違う番号と51個以上を 400、ログインなしを 401、ほかの法案の番号は黙って無視する', async ({ browser, page }, info) => {
	const w = info.project.name;
	const month = monthOf(w, 8);
	const { bill, label } = await proposed(browser, w, 8, month);
	const now = at(month, 15);
	const q = await user(browser, ip(w, 8, 5), now, `q-${label}`);
	const v = await user(browser, ip(w, 8, 6), now, `v-${label}`);
	const id = await writeQuestion(q.page, bill, `読む境界の質疑 ${label}`);
	await open(v.page, bill);

	expect((await readRequest(v.page, bill, [])).status()).toBe(400);
	expect((await readRequest(v.page, bill, ['abc'])).status()).toBe(400);
	expect((await readRequest(v.page, bill, [id, '-1'])).status()).toBe(400);
	expect((await readRequest(v.page, bill, Array.from({ length: 51 }, (_, i) => String(i + 1)))).status()).toBe(400);
	// 50個までは受け付け、この法案の見える投稿でない番号は無視する（保存の絞り込みは DB のテスト）
	expect((await readRequest(v.page, bill, Array.from({ length: 50 }, (_, i) => String(90_000_000 + i)))).status()).toBe(200);
	expect((await readRequest(v.page, bill, [id])).status()).toBe(200);
	expect((await billRequest(v.page, '/houan/abc/shitsugi?/read', { post: id })).status()).toBe(404);

	await page.context().setExtraHTTPHeaders({ 'x-test-ip': ip(w, 8, 7), 'x-test-now': now });
	await page.goto(qa(bill));
	expect((await readRequest(page, bill, [id])).status()).toBe(401);
});
