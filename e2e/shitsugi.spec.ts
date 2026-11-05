// Issue #66 質疑・答弁・補足と自分の考え（設計書 docs/spec/66.md）。回数の上限の DB の側は src/lib/db/posts.test.ts
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { billRequest, billSupportRequest, createAmendBill, issueWithSolutions, newUser, proposeRequest } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});
test.use({ actionTimeout: 15_000 });
// 発議までの準備が重く、並列で流すと30秒を超えることがある
test.beforeEach(() => test.setTimeout(120_000));

const ip = (w: string, group: number, n: number) => `10.${w === 'sp' ? 62 : 63}.${group}.${n}`;
const stamp = () => Date.now() % 1e8;
const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });

/** 基準ごと・幅ごとに別の年を使う（2031〜2044年はほかのテストが使っている）。どの基準も5月と次の月を使う */
const monthOf = (w: string, group: number) => `${2045 + group * 2 + (w === 'sp' ? 0 : 1)}-05`;
const at = (month: string, day: number) => `${month}-${String(day).padStart(2, '0')}T09:00:00+09:00`;

type User = { page: Page; setNow: (now: string) => Promise<void> };

async function user(browser: Browser, ipAddress: string, now: string, name?: string, days = 8): Promise<User> {
	const u = await newUser(browser, { name, ip: ipAddress, days });
	contexts.push(u.context);
	const setNow = (t: string) => u.context.setExtraHTTPHeaders({ 'x-test-ip': ipAddress, 'x-test-now': t });
	await setNow(now);
	return { page: u.page, setNow };
}

/** 発議した法案。a は提出者、b は賛同者 */
async function proposed(browser: Browser, w: string, group: number, month: string) {
	const label = `q${group}-${w}-${stamp()}`;
	const now = at(month, 5);
	const a = await user(browser, ip(w, group, 1), now, `a-${label}`);
	const { ids } = await issueWithSolutions(a.page, label, [`質疑の解決策 ${label}`]);
	const bill = await createAmendBill(a.page, `質疑の法案 ${label}`, ids[0]);
	let b: User | undefined;
	for (const n of [2, 3, 4]) {
		const u = await user(browser, ip(w, group, n), now, `u${n}-${label}`);
		const res = await billSupportRequest(u.page, bill, { op: 'add', rev: '1' });
		expect(res.status(), await res.text()).toBe(200);
		b ??= u;
	}
	const res = await proposeRequest(a.page, bill);
	expect(res.status(), await res.text()).toBe(200);
	return { a, b: b as User, bill, label };
}

const qa = (bill: string) => `${bill}/shitsugi`;
const tab = (page: Page) => page.getByRole('navigation', { name: '法案のページ' }).getByRole('link', { name: /^質疑/ });
const card = (page: Page, text: string) => page.locator('article').filter({ hasText: text });
const posted = async (u: Page, act: () => Promise<void>) => {
	const [res] = await Promise.all([u.waitForResponse((r) => r.request().method() === 'POST' && !r.url().includes('?/read')), act()]);
	// use:enhance の送信は fail() でも HTTP 200 で返るので、本文の type も確かめる
	expect(res.status()).toBeLessThan(400);
	if (res.status() < 300) expect(await res.text()).not.toContain('"type":"failure"');
};
const writeQuestion = async (u: Page, bill: string, text: string) => {
	await u.goto(qa(bill));
	await hydrated(u);
	await u.getByRole('link', { name: '質疑を書く' }).click();
	await hydrated(u);
	await u.getByLabel('質疑の内容').fill(text);
	await posted(u, () => u.getByRole('button', { name: '送る' }).click());
	await expect(card(u, text)).toBeVisible();
};
const questionRequest = (u: Page, bill: string, body: string, token = 'test-pass') =>
	billRequest(u, `${qa(bill)}/kaku`, { body, 'cf-turnstile-response': token });
const answerRequest = (u: Page, bill: string, question: string, body: string) =>
	billRequest(u, `${qa(bill)}?/answer`, { question, body, 'cf-turnstile-response': 'test-pass' });
const supplementRequest = (u: Page, bill: string, question: string, body: string) =>
	billRequest(u, `${qa(bill)}?/supplement`, { question, body, 'cf-turnstile-response': 'test-pass' });
const questionId = async (u: Page, bill: string, text: string) => {
	await u.goto(qa(bill));
	const id = await card(u, text).getAttribute('id');
	expect(id).toMatch(/^shitsugi-\d+$/);
	return (id as string).replace('shitsugi-', '');
};

test('基準1：発議した法案に「質疑 N」のタブが出て、ログインしていなくても読める。下書きにはタブがなく URL は 404', async ({ browser, page }, info) => {
	const w = info.project.name;
	const month = monthOf(w, 1);
	const label = `q0-${w}-${stamp()}`;
	const a = await user(browser, ip(w, 1, 9), at(month, 5), `d-${label}`);
	const { ids } = await issueWithSolutions(a.page, label, [`下書きの解決策 ${label}`]);
	const draft = await createAmendBill(a.page, `下書き ${label}`, ids[0]);
	await a.page.goto(draft);
	await expect(tab(a.page)).toHaveCount(0);
	expect((await a.page.request.get(qa(draft))).status()).toBe(404);

	const { bill } = await proposed(browser, w, 1, month);
	await page.goto(bill);
	await expect(tab(page)).toHaveText('質疑 0');
	await tab(page).click();
	await expect(page).toHaveURL(new RegExp(`${qa(bill)}$`));
	await expect(page.getByText('質疑はまだありません')).toBeVisible();
});

test('基準2：登録から7日たった人が3週目に質疑を書ける。外ではボタンが出ず断る。7日たっていなければいつからかを出す', async ({ browser }, info) => {
	const w = info.project.name;
	const month = monthOf(w, 2);
	const { bill, label } = await proposed(browser, w, 2, month);
	const q = await user(browser, ip(w, 2, 5), at(month, 5), `q-${label}`);

	await q.page.goto(qa(bill));
	await expect(q.page.getByRole('link', { name: '質疑を書く' })).toHaveCount(0);
	expect((await questionRequest(q.page, bill, '早すぎる質疑')).status()).toBe(409);

	const text = `解約の窓口は誰が用意しますか ${label}`;
	await q.setNow(at(month, 15));
	await writeQuestion(q.page, bill, text);
	await expect(card(q.page, text).getByText('答弁待ち')).toBeVisible();
	await expect(tab(q.page)).toHaveText('質疑 1');

	await q.setNow(at(month, 22));
	await q.page.goto(qa(bill));
	await expect(q.page.getByRole('link', { name: '質疑を書く' })).toHaveCount(0);
	expect((await questionRequest(q.page, bill, '遅すぎる質疑')).status()).toBe(409);

	const fresh = await user(browser, ip(w, 2, 6), at(month, 15), `n-${label}`, 6);
	// x-test-now の月では登録から7日を過ぎるので、本当の時刻で確かめる
	await fresh.page.context().setExtraHTTPHeaders({ 'x-test-ip': ip(w, 2, 6) });
	await fresh.page.goto(`${qa(bill)}/kaku`);
	await expect(fresh.page.getByLabel('質疑の内容')).toHaveCount(0);
	expect((await questionRequest(fresh.page, bill, '新しいアカウントの質疑')).status()).toBe(403);
});

test('基準3：提出者と賛同者が答弁でき、役割だけが出て「答弁待ち」が消える。ほかの人と自分の質疑は断る。書いた人の番号はデータにない', async ({ browser }, info) => {
	const w = info.project.name;
	const month = monthOf(w, 3);
	const { a, b, bill, label } = await proposed(browser, w, 3, month);
	const q = await user(browser, ip(w, 3, 5), at(month, 15), `q-${label}`);
	const text = `質疑の本文 ${label}`;
	await writeQuestion(q.page, bill, text);
	const id = await questionId(q.page, bill, text);

	// ほかの人にはボタンが出ず、送っても断る
	await expect(card(q.page, text).getByRole('button', { name: '答弁する' })).toHaveCount(0);
	expect((await answerRequest(q.page, bill, id, '権限のない答弁')).status()).toBe(403);

	await a.setNow(at(month, 15));
	await a.page.goto(qa(bill));
	await hydrated(a.page);
	await card(a.page, text).getByRole('button', { name: '答弁する' }).click();
	const answer = `提出者の答弁 ${label}`;
	await a.page.getByLabel('答弁の内容').fill(answer);
	await posted(a.page, () => a.page.getByRole('button', { name: '送る' }).click());
	await expect(card(a.page, text).getByText('答弁待ち')).toHaveCount(0);
	await expect(card(a.page, text).getByText('答弁（提出者）')).toBeAttached();

	// 採決の締切まで、賛同者も答弁できる（複数の答弁）
	await b.setNow(at(month, 22));
	const answer2 = `賛同者の答弁 ${label}`;
	const res = await answerRequest(b.page, bill, id, answer2);
	expect(res.status(), await res.text()).toBe(200);
	await b.page.goto(qa(bill));
	await expect(card(b.page, text).getByText('答弁（賛同者）')).toBeAttached();

	// 自分の質疑には答弁できない。自分の質疑にはどちらのボタンも出ない
	await b.setNow(at(month, 15));
	const own = `賛同者の質疑 ${label}`;
	await writeQuestion(b.page, bill, own);
	await expect(card(b.page, own).getByRole('button', { name: /答弁する|補足する/ })).toHaveCount(0);
	expect((await answerRequest(b.page, bill, await questionId(b.page, bill, own), '自分への答弁')).status()).toBe(403);

	// 締切のあとは断る
	const next = month.replace('-05', '-06');
	await b.setNow(at(next, 1));
	expect((await answerRequest(b.page, bill, id, '遅すぎる答弁')).status()).toBe(409);

	// 名前も、書いた人の番号も出さない
	await q.page.goto(qa(bill));
	const html = await (await q.page.request.get(`${qa(bill)}/__data.json`)).text();
	expect(html).not.toMatch(/user_?id/i);
	// 提出者の名前は法案の見出しに出す（#46）。質疑を書いた人と、答弁した賛同者の名前は出さない
	expect(html).not.toContain(`q-${label}`);
	expect(html).not.toContain(`u2-${label}`);
});

test('基準4：提出者と賛同者のほかの人が3週目に補足でき、「答弁待ち」は消えない', async ({ browser, page }, info) => {
	const w = info.project.name;
	const month = monthOf(w, 4);
	const { a, bill, label } = await proposed(browser, w, 4, month);
	const q = await user(browser, ip(w, 4, 5), at(month, 15), `q-${label}`);
	const other = await user(browser, ip(w, 4, 6), at(month, 15), `o-${label}`);
	const text = `質疑の本文 ${label}`;
	await writeQuestion(q.page, bill, text);

	await other.page.goto(qa(bill));
	await hydrated(other.page);
	await card(other.page, text).getByRole('button', { name: '補足する' }).click();
	const note = `補足の本文 ${label}`;
	await other.page.getByLabel('補足の内容').fill(note);
	await posted(other.page, () => other.page.getByRole('button', { name: '送る' }).click());
	await expect(card(other.page, text).getByText(note)).toBeVisible();
	await expect(card(other.page, text).getByText('答弁待ち')).toBeVisible();

	// 提出者は補足できない
	await a.setNow(at(month, 15));
	await a.page.goto(qa(bill));
	await expect(card(a.page, text).getByRole('button', { name: '補足する' })).toHaveCount(0);
	const id = await questionId(a.page, bill, text);
	expect((await supplementRequest(a.page, bill, id, '提出者の補足')).status()).toBe(403);

	// 3週目の外は断る
	await other.setNow(at(month, 22));
	await other.page.goto(qa(bill));
	await expect(card(other.page, text).getByRole('button', { name: '補足する' })).toHaveCount(0);
	expect((await supplementRequest(other.page, bill, id, '遅すぎる補足')).status()).toBe(409);

	// ログインしていなければ、押すとログインへ
	await page.setExtraHTTPHeaders({ 'x-test-now': at(month, 15) });
	await page.goto(qa(bill));
	await card(page, text).getByRole('button', { name: '補足する' }).click();
	await expect(page.getByRole('button', { name: 'Googleでログイン' }).or(page.getByRole('link', { name: 'Googleでログイン' }))).toBeVisible();
});

test('基準5：「すべて」と「答弁待ち N」で切りかえられる。質疑は新しい順で20件ごとに分かれる', async ({ browser }, info) => {
	test.setTimeout(120_000);
	const w = info.project.name;
	const month = monthOf(w, 5);
	const { a, bill, label } = await proposed(browser, w, 5, month);
	await a.setNow(at(month, 15));
	const now = at(month, 15);
	// 1アカウント24時間に10件、5分に10回までなので、3人で21件書く
	const writers = [await user(browser, ip(w, 5, 5), now, `w1-${label}`), await user(browser, ip(w, 5, 6), now, `w2-${label}`), await user(browser, ip(w, 5, 7), now, `w3-${label}`)];
	const texts = Array.from({ length: 21 }, (_, i) => `質疑${String(i + 1).padStart(2, '0')} ${label}`);
	for (const [i, text] of texts.entries()) {
		const res = await questionRequest(writers[Math.floor(i / 10)].page, bill, text);
		expect(res.status(), await res.text()).toBe(303);
	}

	const u = a.page;
	await u.goto(qa(bill));
	await expect(tab(u)).toHaveText('質疑 21');
	// 新しい順で、1ページに20件
	await expect(u.locator('article')).toHaveCount(20);
	await expect(u.locator('article').first()).toContainText(texts[20]);
	await u.getByRole('link', { name: '質疑をもっと見る（21件）' }).click();
	await expect(u.locator('article')).toHaveCount(1);
	await expect(u.locator('article').first()).toContainText(texts[0]);

	// 絞り込みの2ページ目で最後の1件に答弁すると、ページが空になるので1ページ目へ移る
	await u.goto(`${qa(bill)}?mati=1&page=2`);
	await hydrated(u);
	const answered = texts[0];
	await card(u, answered).getByRole('button', { name: '答弁する' }).click();
	await u.getByLabel('答弁の内容').fill(`答弁 ${label}`);
	await posted(u, () => u.getByRole('button', { name: '送る' }).click());
	await expect(u).toHaveURL(new RegExp(`${qa(bill)}\\?mati=1$`));

	await expect(u.getByRole('link', { name: '答弁待ち 20' })).toBeVisible();
	await expect(card(u, answered)).toHaveCount(0);
	await expect(u.locator('article')).toHaveCount(20);
	await u.getByRole('link', { name: 'すべて' }).click();
	await expect(u.locator('article').first()).toContainText(texts[20]);
	await u.getByRole('link', { name: '質疑をもっと見る' }).click();
	await expect(card(u, answered)).toHaveCount(1);
});

test('基準6：自分の考えは残り、ほかの人に出ない。最初の選択は数えず2回変えられ、3回目は断る。発議から会期末まで', async ({ browser, page }, info) => {
	const w = info.project.name;
	const month = monthOf(w, 6);
	const { bill, label } = await proposed(browser, w, 6, month);
	const e = await user(browser, ip(w, 6, 5), at(month, 5), `e-${label}`);
	const f = await user(browser, ip(w, 6, 6), at(month, 5), `f-${label}`);
	const stance = (u: Page, name: string) => u.getByRole('button', { name, exact: true });
	const press = async (u: Page, name: string) => {
		await u.goto(qa(bill));
		await hydrated(u);
		await posted(u, () => stance(u, name).click());
		await u.goto(qa(bill));
	};
	const left = (u: Page, n: number) => expect(u.getByText(`この会期はあと${n}回変えられます`)).toBeVisible();

	// 何も選んでいなければ未定。未定を押しても回数を失わない
	await e.page.goto(qa(bill));
	await expect(e.page.getByText('自分だけに見えます')).toBeVisible();
	await expect(stance(e.page, '未定')).toHaveAttribute('aria-pressed', 'true');
	await left(e.page, 2);
	await press(e.page, '未定');
	await left(e.page, 2);

	// 最初の選択は数えない。読み直しても残る（発議のうちから持てる）
	await press(e.page, '賛成寄り');
	await expect(stance(e.page, '賛成寄り')).toHaveAttribute('aria-pressed', 'true');
	await left(e.page, 2);

	// ほかの人とログインしていない人には出ない
	await f.page.goto(qa(bill));
	await expect(stance(f.page, '賛成寄り')).toHaveAttribute('aria-pressed', 'false');
	await page.setExtraHTTPHeaders({ 'x-test-now': at(month, 5) });
	await page.goto(qa(bill));
	for (const name of ['賛成寄り', '未定', '反対寄り']) await expect(stance(page, name)).toHaveAttribute('aria-pressed', 'false');
	await expect(page.getByText(/あと\d回変えられます/)).toHaveCount(0);
	await stance(page, '賛成寄り').click();
	await expect(page.getByRole('button', { name: 'Googleでログイン' }).or(page.getByRole('link', { name: 'Googleでログイン' }))).toBeVisible();

	await press(e.page, '反対寄り');
	await left(e.page, 1);
	await press(e.page, '未定');
	await expect(e.page.getByText('この会期はもう変えられません')).toBeVisible();
	await expect(stance(e.page, '賛成寄り')).toBeDisabled();
	expect((await billRequest(e.page, `${qa(bill)}?/stance`, { stance: 'for' })).status()).toBe(409);

	// 会期が終わると出ない。送っても断る
	const next = month.replace('-05', '-06');
	await f.setNow(at(next, 1));
	await f.page.goto(qa(bill));
	await expect(f.page.getByText('あなたの今の考え')).toHaveCount(0);
	expect((await billRequest(f.page, `${qa(bill)}?/stance`, { stance: 'for' })).status()).toBe(409);
});

test('基準7：答弁はスマホでは開くと出て、PC は最初から出ている', async ({ browser }, info) => {
	const w = info.project.name;
	const month = monthOf(w, 7);
	const { a, b, bill, label } = await proposed(browser, w, 7, month);
	const q = await user(browser, ip(w, 7, 5), at(month, 15), `q-${label}`);
	const text = `開閉の質疑 ${label}`;
	await writeQuestion(q.page, bill, text);
	const id = await questionId(q.page, bill, text);
	const answer = `開閉の答弁 ${label}`;
	await a.setNow(at(month, 15));
	expect((await answerRequest(a.page, bill, id, answer)).status()).toBe(200);

	const v = q.page;
	await v.goto(qa(bill));
	await hydrated(v);
	const open = card(v, text).getByRole('button', { name: '答弁を読む（提出者）' });
	if (w === 'sp') {
		await expect(card(v, text).getByText(answer)).toBeHidden();
		await expect(open).toHaveAttribute('aria-expanded', 'false');
		await open.click();
		await expect(open).toHaveAttribute('aria-expanded', 'true');
	} else {
		await expect(open).toBeHidden();
	}
	await expect(card(v, text).getByText(answer)).toBeVisible();

	// 2件以上は件数で出す
	await b.setNow(at(month, 15));
	expect((await answerRequest(b.page, bill, id, `2つ目の答弁 ${label}`)).status()).toBe(200);
	await v.goto(qa(bill));
	// PC ではボタンを CSS で隠しているので、隠れたものも探す
	await expect(card(v, text).getByRole('button', { name: '答弁を読む（2件）', includeHidden: true })).toBeAttached();
});

test('信頼の境界：形の違う値は 400、ほかの法案の質疑は 404、下書きは 404。本文の誤りはそのカードの欄に入力を残して出す', async ({ browser }, info) => {
	const w = info.project.name;
	const month = monthOf(w, 8);
	const { a, bill, label } = await proposed(browser, w, 8, month);
	const other = await proposed(browser, w, 9, month);
	const q = await user(browser, ip(w, 8, 5), at(month, 15), `q-${label}`);
	const text = `境界の質疑 ${label}`;
	await writeQuestion(q.page, bill, text);
	const id = await questionId(q.page, bill, text);
	await a.setNow(at(month, 15));

	for (const value of ['', 'abc', '0', '-1', '1.5']) expect((await answerRequest(a.page, bill, value, '答弁')).status(), value).toBe(400);
	for (const stance of ['', 'maybe', 'FOR']) expect((await billRequest(q.page, `${qa(bill)}?/stance`, { stance })).status(), stance).toBe(400);
	expect((await questionRequest(q.page, bill, '質疑', 'bad-token')).status()).toBe(400);
	// ほかの法案の質疑への答弁は 404（どちらの法案でも提出者である人が送っても）
	await other.a.setNow(at(month, 15));
	expect((await answerRequest(other.a.page, other.bill, id, '別の法案への答弁')).status()).toBe(404);
	expect((await answerRequest(a.page, bill, '999999999', 'ない質疑')).status()).toBe(404);

	// 下書きと、ない法案は 404
	const { ids } = await issueWithSolutions(a.page, `q8-${label}`, [`下書きの解決策 ${label}`]);
	const draft = await createAmendBill(a.page, `境界の下書き ${label}`, ids[0]);
	expect((await questionRequest(q.page, draft, '下書きへの質疑')).status()).toBe(404);
	expect((await answerRequest(q.page, draft, id, '下書きへの答弁')).status()).toBe(404);
	expect((await billRequest(q.page, `${qa(draft)}?/stance`, { stance: 'for' })).status()).toBe(404);
	expect((await questionRequest(q.page, '/houan/999999999', '質疑')).status()).toBe(404);

	// 本文の誤り：そのカードの欄に入力を残して出す
	await a.page.goto(qa(bill));
	await hydrated(a.page);
	await card(a.page, text).getByRole('button', { name: '答弁する' }).click();
	const tooLong = 'あ'.repeat(801);
	await a.page.getByLabel('答弁の内容').evaluate((el, v) => {
		(el as HTMLTextAreaElement).removeAttribute('maxlength');
		(el as HTMLTextAreaElement).value = v;
		el.dispatchEvent(new Event('input', { bubbles: true }));
	}, tooLong);
	await a.page.getByRole('button', { name: '送る' }).click();
	await expect(card(a.page, text).getByText(/800字/)).toBeVisible();
	await expect(a.page.getByLabel('答弁の内容')).toHaveValue(tooLong);
	expect((await answerRequest(a.page, bill, id, '   ')).status()).toBe(400);
});
