// Issue #68 修正案のタブ（設計書 docs/spec/68.md）。締切のあとの処理と数え方は src/lib/db/amendments.test.ts
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { billRequest, billSupportRequest, createAmendBill, issueWithSolutions, newUser, proposeRequest } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});
test.use({ actionTimeout: 15_000 });

const ip = (w: string, group: number, n: number) => `10.${w === 'sp' ? 66 : 67}.${group}.${n}`;
const stamp = () => Date.now() % 1e8;
const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });

/** 基準ごと・幅ごとに別の年を使う（2084年までは質疑と評価のテストが使っている） */
const monthOf = (w: string, group: number) => `${2086 + group * 2 + (w === 'sp' ? 0 : 1)}-05`;
const at = (month: string, day: number) => `${month}-${String(day).padStart(2, '0')}T09:00:00+09:00`;
const nextMonth = (month: string) => month.replace(/-05$/, '-06');

type User = { page: Page; setNow: (now: string) => Promise<void>; name: string };

async function user(browser: Browser, ipAddress: string, now: string, name: string, days = 8): Promise<User> {
	const u = await newUser(browser, { name, ip: ipAddress, days });
	contexts.push(u.context);
	const setNow = (t: string) => u.context.setExtraHTTPHeaders({ 'x-test-ip': ipAddress, 'x-test-now': t });
	await setNow(now);
	return { page: u.page, setNow, name };
}

/** 発議した法案。a は提出者、b は賛同者。どちらも15日にする */
async function proposed(browser: Browser, w: string, group: number, month: string) {
	const label = `s${group}-${w}-${stamp()}`;
	const now = at(month, 5);
	const a = await user(browser, ip(w, group, 1), now, `a-${label}`);
	const { ids } = await issueWithSolutions(a.page, label, [`修正案の解決策 ${label}`]);
	const bill = await createAmendBill(a.page, `修正案の法案 ${label}`, ids[0]);
	let b: User | undefined;
	for (const n of [2, 3, 4]) {
		const u = await user(browser, ip(w, group, n), now, `u${n}-${label}`);
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

const tabPath = (bill: string) => `${bill}/shusei`;
const billTab = (page: Page) => page.getByRole('navigation', { name: '法案のページ' }).getByRole('link', { name: /^修正案/ });
const card = (page: Page, text: string) => page.locator('article').filter({ hasText: text });
const open = async (u: Page, bill: string) => {
	await u.goto(tabPath(bill));
	await hydrated(u);
};
/** 第1条は法案が変えている条、第2条はまだ変えていない条 */
const ARTICLE_1 = '0:1';
const ARTICLE_2 = '0:2';
const post = (u: Page, bill: string, form: { article: string; body: string; rev?: string; reason?: string }) =>
	billRequest(u, `${tabPath(bill)}/kaku`, { rev: '1', reason: '', 'cf-turnstile-response': 'test-pass', ...form });
const act = (u: Page, bill: string, action: string, form: Record<string, string>) => billRequest(u, `${tabPath(bill)}?/${action}`, form);
/** 修正案を出して、番号を返す */
async function amend(u: User, bill: string, article: string, body: string, rev = '1') {
	const res = await post(u.page, bill, { article, body, rev });
	expect(res.status(), await res.text()).toBe(303);
	await u.page.goto(tabPath(bill));
	const id = await card(u.page, body).getAttribute('id');
	expect(id).toMatch(/^shusei-\d+$/);
	return (id as string).replace('shusei-', '');
}
const pressAndWait = async (u: Page, button: Locator) => {
	const [res] = await Promise.all([u.waitForResponse((r) => r.request().method() === 'POST'), button.click()]);
	expect(res.status()).toBeLessThan(400);
	if (res.status() < 300) expect(await res.text()).not.toContain('"type":"failure"');
};

test('基準1：発議した法案に「修正案 N」のタブが出てログインなしで読める。カードに条・変更点・理由が出て名前は出ない。下書きはタブがなく 404', async ({ browser, page }, info) => {
	const w = info.project.name;
	const month = monthOf(w, 1);
	const draftLabel = `d-${w}-${stamp()}`;
	const d = await user(browser, ip(w, 1, 9), at(month, 5), `d-${draftLabel}`);
	const { ids } = await issueWithSolutions(d.page, draftLabel, [`下書きの解決策 ${draftLabel}`]);
	const draft = await createAmendBill(d.page, `下書き ${draftLabel}`, ids[0]);
	await d.page.goto(draft);
	await expect(billTab(d.page)).toHaveCount(0);
	expect((await d.page.request.get(tabPath(draft))).status()).toBe(404);
	expect((await d.page.request.get(`${tabPath(draft)}/kaku`)).status()).toBe(404);

	const { bill, label } = await proposed(browser, w, 1, month);
	await page.context().setExtraHTTPHeaders({ 'x-test-ip': ip(w, 1, 8), 'x-test-now': at(month, 15) });
	await page.goto(bill);
	await expect(billTab(page)).toHaveText('修正案 0');
	await billTab(page).click();
	await expect(page).toHaveURL(new RegExp(`${tabPath(bill)}$`));
	await expect(page.getByText('修正案はまだありません')).toBeVisible();

	const g = await user(browser, ip(w, 1, 5), at(month, 15), `g-${label}`);
	const body = `修正案の本文その1 ${label}`;
	const res = await post(g.page, bill, { article: ARTICLE_2, body, reason: `修正の理由 ${label}` });
	expect(res.status(), await res.text()).toBe(303);

	await page.goto(tabPath(bill));
	await expect(billTab(page)).toHaveText('修正案 1');
	const shown = card(page, body);
	await expect(shown).toContainText('第2条');
	await expect(shown).toContainText(`修正の理由 ${label}`);
	await expect(shown.locator('ins').first()).toBeVisible();
	await expect(page.getByRole('main')).not.toContainText(`g-${label}`);
	const data = await (await page.request.get(`${tabPath(bill)}/__data.json`)).text();
	expect(data).not.toContain(`g-${label}`);
});

test('基準2：3週目に登録から7日たった人が画面から出せる。提出者と時期の外は断る。本文の誤りと版の違いも断る', async ({ browser }, info) => {
	const w = info.project.name;
	const month = monthOf(w, 2);
	const { a, bill, label } = await proposed(browser, w, 2, month);
	const g = await user(browser, ip(w, 2, 5), at(month, 5), `g-${label}`);
	const body = `画面から出す本文 ${label}`;

	// 発議の週は出せない
	await open(g.page, bill);
	await expect(g.page.getByRole('link', { name: '修正案を出す' })).toHaveCount(0);
	expect((await post(g.page, bill, { article: ARTICLE_1, body })).status()).toBe(409);

	// 3週目：条を選ぶといまの本案の本文が入る。Turnstile を通して出す
	await g.setNow(at(month, 15));
	await open(g.page, bill);
	await g.page.getByRole('link', { name: '修正案を出す' }).click();
	await hydrated(g.page);
	await expect(g.page.getByText('採用されると、共同起草者として名前が出ます')).toBeVisible();
	await g.page.getByLabel('変える条').selectOption({ label: '第1条（目的）' });
	await expect(g.page.getByLabel('変更後の条文')).toHaveValue('この法律は、消費者がいつでも契約をやめられるようにすることを目的とする。');
	await g.page.getByLabel('変更後の条文').fill(body);
	await g.page.getByLabel('理由（任意）').fill(`画面の理由 ${label}`);
	await pressAndWait(g.page, g.page.getByRole('button', { name: '修正案を出す' }));
	await expect(g.page).toHaveURL(new RegExp(`${tabPath(bill)}$`));
	await expect(card(g.page, body)).toContainText(`画面の理由 ${label}`);

	// 提出者は出せない（リンクがなく、送ると断る）
	await open(a.page, bill);
	await expect(a.page.getByRole('link', { name: '修正案を出す' })).toHaveCount(0);
	expect((await post(a.page, bill, { article: ARTICLE_1, body: `提出者の本文 ${label}` })).status()).toBe(403);

	// いまの本案と同じ本文、形の違う本文は欄に理由を出して断る。版が違えば断る
	expect((await post(g.page, bill, { article: ARTICLE_1, body: 'この法律は、消費者がいつでも契約をやめられるようにすることを目的とする。' })).status()).toBe(400);
	expect((await post(g.page, bill, { article: ARTICLE_1, body: '' })).status()).toBe(400);
	expect((await post(g.page, bill, { article: ARTICLE_1, body: `古い版の本文 ${label}`, rev: '99' })).status()).toBe(409);

	// 登録から7日たっていない（本当の時刻で確かめる）
	const fresh = await user(browser, ip(w, 2, 6), at(month, 15), `f-${label}`, 6);
	await fresh.page.context().setExtraHTTPHeaders({ 'x-test-ip': ip(w, 2, 6) });
	expect((await post(fresh.page, bill, { article: ARTICLE_1, body: `新しい人の本文 ${label}` })).status()).toBe(403);

	// 3週目の後は出せない
	await g.setNow(at(month, 22));
	await open(g.page, bill);
	await expect(g.page.getByRole('link', { name: '修正案を出す' })).toHaveCount(0);
	expect((await post(g.page, bill, { article: ARTICLE_1, body: `遅い本文 ${label}` })).status()).toBe(409);
});

test('基準3：提出者が取り込むと変更点が修正案の本文になり、提案者が共同起草者に出る。賛同の数と答弁できる人は変わらない。ほかの人と最後の24時間は断る', async ({ browser }, info) => {
	const w = info.project.name;
	const month = monthOf(w, 3);
	const { a, b, bill, label } = await proposed(browser, w, 3, month);
	const g = await user(browser, ip(w, 3, 5), at(month, 15), `g-${label}`);
	const body = `取り込む本文 ${label}`;
	const id = await amend(g, bill, ARTICLE_1, body);

	// 提出者のほかには「取り込む」が出ず、送っても断る
	await expect(card(g.page, body).getByRole('button', { name: '取り込む' })).toHaveCount(0);
	expect((await act(g.page, bill, 'accept', { amendment: id, revision: '1' })).status()).toBe(403);
	expect((await act(b.page, bill, 'accept', { amendment: id, revision: '1' })).status()).toBe(403);

	await open(a.page, bill);
	await pressAndWait(a.page, card(a.page, body).getByRole('button', { name: '取り込む' }));
	await expect(card(a.page, body)).toContainText('取り込まれました');
	await expect(card(a.page, body).getByRole('button', { name: '取り込む' })).toHaveCount(0);
	// 取り込んだあとも、提案者が書いたときの変更点が残る
	await expect(card(a.page, body).locator('ins').first()).toBeVisible();

	await a.page.goto(`${bill}/henkou`);
	const after = a.page.getByRole('main').locator('section').filter({ hasText: '変更後' });
	expect((await after.innerText()).replace(/＋/g, '')).toContain(body);
	await expect(a.page.getByRole('main')).not.toContainText('いつでも契約をやめられる');

	// 共同起草者。発議した版の賛同者は変わらない
	await a.page.goto(bill);
	await expect(a.page.getByRole('main')).toContainText(`共同起草者 g-${label}`);
	await expect(a.page.getByRole('main')).toContainText('賛同 3人');
	const shitsugi = `${bill}/shitsugi`;
	const question = `答弁できる人の質疑 ${label}`;
	expect((await billRequest(g.page, `${shitsugi}/kaku`, { body: question, 'cf-turnstile-response': 'test-pass' })).status()).toBe(303);
	await g.page.goto(shitsugi);
	const q = ((await g.page.locator('article').filter({ hasText: question }).getAttribute('id')) as string).replace('shitsugi-', '');
	expect((await billRequest(b.page, `${shitsugi}?/answer`, { question: q, body: `賛同者の答弁 ${label}`, 'cf-turnstile-response': 'test-pass' })).status()).toBe(200);

	// 最後の24時間は取り込めない
	const late = `遅い修正案 ${label}`;
	const lateId = await amend(g, bill, ARTICLE_2, late, '2');
	await a.setNow(at(month, 21));
	await open(a.page, bill);
	await expect(card(a.page, late).getByRole('button', { name: '取り込む' })).toHaveCount(0);
	await expect(card(a.page, late)).toContainText('取り込めるのは採決の24時間前までです');
	expect((await act(a.page, bill, 'accept', { amendment: lateId, revision: '1' })).status()).toBe(409);
});

test('基準4：本案の版が変わると「更新が必要」になり、取り込みも賛同もできない。提案者が更新すると戻る。本文を変えると賛同は数え直し', async ({ browser }, info) => {
	const w = info.project.name;
	const month = monthOf(w, 4);
	const { a, bill, label } = await proposed(browser, w, 4, month);
	const now = at(month, 15);
	const g = await user(browser, ip(w, 4, 5), now, `g-${label}`);
	const h = await user(browser, ip(w, 4, 6), now, `h-${label}`);
	const s = await user(browser, ip(w, 4, 7), now, `s-${label}`);
	const taken = `先に取り込む本文 ${label}`;
	const kept = `賛同を保つ本文 ${label}`;
	const edited = `書き直す本文 ${label}`;
	const takenId = await amend(g, bill, ARTICLE_1, taken);
	const keptId = await amend(h, bill, ARTICLE_2, kept);
	const editedId = await amend(g, bill, '0:3', edited);
	for (const id of [keptId, editedId]) {
		expect((await act(s.page, bill, 'support', { amendment: id, revision: '1', op: 'add' })).status()).toBe(200);
	}
	expect((await act(a.page, bill, 'accept', { amendment: takenId, revision: '1' })).status()).toBe(200);

	await open(a.page, bill);
	await expect(card(a.page, kept)).toContainText('更新が必要です');
	await expect(card(a.page, kept).getByRole('button', { name: '取り込む' })).toHaveCount(0);
	expect((await act(a.page, bill, 'accept', { amendment: keptId, revision: '1' })).status()).toBe(409);
	expect((await act(g.page, bill, 'support', { amendment: keptId, revision: '1', op: 'add' })).status()).toBe(409);
	// 提案者のほかには更新のリンクが出ず、送っても断る
	await expect(card(a.page, kept).getByRole('link', { name: '更新する' })).toHaveCount(0);
	expect((await billRequest(g.page, `${tabPath(bill)}/kaku?koushin=${keptId}`, { rev: '2', body: `他人の更新 ${label}`, reason: '', 'cf-turnstile-response': 'test-pass' })).status()).toBe(403);

	// 提案者が本文を変えずに更新すると戻り、賛同を保つ
	await open(h.page, bill);
	await card(h.page, kept).getByRole('link', { name: '更新する' }).click();
	await hydrated(h.page);
	await expect(h.page.getByLabel('変更後の条文')).toHaveValue(kept);
	await pressAndWait(h.page, h.page.getByRole('button', { name: '更新する' }));
	await expect(h.page).toHaveURL(new RegExp(`${tabPath(bill)}$`));
	await expect(card(h.page, kept)).not.toContainText('更新が必要です');
	await expect(card(h.page, kept)).toContainText('賛同 1人');

	// 本文を変えて更新すると数え直し
	const rewritten = `書き直した本文 ${label}`;
	const res = await billRequest(g.page, `${tabPath(bill)}/kaku?koushin=${editedId}`, { rev: '2', body: rewritten, reason: '', 'cf-turnstile-response': 'test-pass' });
	expect(res.status(), await res.text()).toBe(303);
	await open(g.page, bill);
	await expect(card(g.page, rewritten)).toContainText('賛同 0人');
});

test('基準5：提案者と提出者のほかの人が賛同でき、取り消せる。要件と今の人数が出る。時期の外と本人は断る', async ({ browser }, info) => {
	const w = info.project.name;
	const month = monthOf(w, 5);
	const { a, bill, label } = await proposed(browser, w, 5, month);
	const now = at(month, 15);
	const g = await user(browser, ip(w, 5, 5), now, `g-${label}`);
	const s1 = await user(browser, ip(w, 5, 6), now, `s1-${label}`);
	const s2 = await user(browser, ip(w, 5, 7), now, `s2-${label}`);
	const body = `賛同を集める本文 ${label}`;
	const id = await amend(g, bill, ARTICLE_1, body);

	await open(s1.page, bill);
	await expect(card(s1.page, body)).toContainText('賛同 0人（あと 2人で本案より先に採決します）');
	await pressAndWait(s1.page, card(s1.page, body).getByRole('button', { name: '賛同する' }));
	await expect(card(s1.page, body)).toContainText('賛同 1人（あと 1人で本案より先に採決します）');

	await open(s2.page, bill);
	await pressAndWait(s2.page, card(s2.page, body).getByRole('button', { name: '賛同する' }));
	await expect(card(s2.page, body)).toContainText('賛同 2人（本案より先に採決します）');

	await pressAndWait(s2.page, card(s2.page, body).getByRole('button', { name: '賛同を取り消す' }));
	await expect(card(s2.page, body)).toContainText('賛同 1人（あと 1人で本案より先に採決します）');

	// 提案者と提出者は賛同できない
	await open(g.page, bill);
	await expect(card(g.page, body).getByRole('button', { name: '賛同する' })).toHaveCount(0);
	expect((await act(g.page, bill, 'support', { amendment: id, revision: '1', op: 'add' })).status()).toBe(403);
	await open(a.page, bill);
	await expect(card(a.page, body).getByRole('button', { name: '賛同する' })).toHaveCount(0);
	expect((await act(a.page, bill, 'support', { amendment: id, revision: '1', op: 'add' })).status()).toBe(403);

	// 登録から7日たっていない（本当の時刻で確かめる）
	const fresh = await user(browser, ip(w, 5, 8), now, `f-${label}`, 6);
	await fresh.page.context().setExtraHTTPHeaders({ 'x-test-ip': ip(w, 5, 8) });
	expect((await act(fresh.page, bill, 'support', { amendment: id, revision: '1', op: 'add' })).status()).toBe(403);

	// 3週目の後は賛同できない
	await s2.setNow(at(month, 22));
	expect((await act(s2.page, bill, 'support', { amendment: id, revision: '1', op: 'add' })).status()).toBe(409);
});

test('基準6：4週目に要件に届いた修正案にだけ投票できる。票は変えられ、数は出ない。投票資格がなければ参考の票と出る', async ({ browser }, info) => {
	const w = info.project.name;
	const month = monthOf(w, 6);
	const { bill, label } = await proposed(browser, w, 6, month);
	const now = at(month, 15);
	const g = await user(browser, ip(w, 6, 5), now, `g-${label}`);
	const s1 = await user(browser, ip(w, 6, 6), now, `s1-${label}`);
	const s2 = await user(browser, ip(w, 6, 7), now, `s2-${label}`);
	const v = await user(browser, ip(w, 6, 8), now, `v-${label}`);
	const voted = `投票する修正案 ${label}`;
	const short = `賛同が足りない修正案 ${label}`;
	const votedId = await amend(g, bill, ARTICLE_1, voted);
	const shortId = await amend(g, bill, ARTICLE_2, short);
	for (const s of [s1, s2]) expect((await act(s.page, bill, 'support', { amendment: votedId, revision: '1', op: 'add' })).status()).toBe(200);
	const form = { amendment: votedId, choice: 'yes', 'cf-turnstile-response': 'test-pass' };

	// 3週目はまだ投票できない
	expect((await act(v.page, bill, 'vote', form)).status()).toBe(409);

	await v.setNow(at(month, 22));
	await open(v.page, bill);
	await expect(card(v.page, voted)).toContainText('本案より先に採決します');
	await expect(card(v.page, voted)).toContainText('票の数は締切まで誰にも見えません');
	await expect(card(v.page, voted)).toContainText('参考の票として数えます');
	await expect(card(v.page, short)).toContainText('採決されません');
	await expect(card(v.page, short).getByRole('button', { name: '賛成', exact: true })).toHaveCount(0);
	expect((await act(v.page, bill, 'vote', { ...form, amendment: shortId })).status()).toBe(409);

	const choice = (name: string) => card(v.page, voted).getByRole('button', { name, exact: true });
	// 選んだカードにだけ「投票する」が出る
	await expect(card(v.page, voted).getByRole('button', { name: '投票する' })).toHaveCount(0);
	await choice('賛成').click();
	await pressAndWait(v.page, card(v.page, voted).getByRole('button', { name: '投票する' }));
	await expect(choice('賛成')).toHaveAttribute('aria-pressed', 'true');
	// 票を変えられる
	await open(v.page, bill);
	await expect(choice('賛成')).toHaveAttribute('aria-pressed', 'true');
	await choice('反対').click();
	await pressAndWait(v.page, card(v.page, voted).getByRole('button', { name: '投票する' }));
	await expect(choice('反対')).toHaveAttribute('aria-pressed', 'true');
	await expect(choice('賛成')).toHaveAttribute('aria-pressed', 'false');

	// ほかの人に票の数も押した状態も出ない
	await s1.setNow(at(month, 22));
	await open(s1.page, bill);
	await expect(card(s1.page, voted).getByRole('button', { name: '反対', exact: true })).toHaveAttribute('aria-pressed', 'false');
	expect(await card(s1.page, voted).innerText()).not.toMatch(/反対\s*\d/);

	// ログインしていなければ、押すとログインへ
	const anon = await newUser(browser, { ip: ip(w, 6, 9) });
	contexts.push(anon.context);
	await anon.context.setExtraHTTPHeaders({ 'x-test-ip': ip(w, 6, 9), 'x-test-now': at(month, 22) });
	await open(anon.page, bill);
	await card(anon.page, voted).getByRole('button', { name: '賛成', exact: true }).click();
	await expect(anon.page).toHaveURL(/\/login\?/);

	// 会期が終わったら投票できない
	await v.setNow(at(nextMonth(month), 2));
	expect((await act(v.page, bill, 'vote', form)).status()).toBe(409);
});

test('信頼の境界：修正案を出すフォームは形の違う値を 400、ない条を 400 にする。ない法案は 404', async ({ browser }, info) => {
	const w = info.project.name;
	const month = monthOf(w, 7);
	const { bill, label } = await proposed(browser, w, 7, month);
	const g = await user(browser, ip(w, 7, 5), at(month, 15), `g-${label}`);
	const body = `境界の本文 ${label}`;
	for (const bad of [
		{ article: 'abc', body },
		{ article: '', body },
		{ article: '9:1', body },
		{ article: '0:99999', body },
		{ article: ARTICLE_1, body, rev: 'x' },
		{ article: ARTICLE_1, body, reason: 'あ'.repeat(401) },
		{ article: ARTICLE_1, body: 'あ'.repeat(10001) }
	]) {
		expect((await post(g.page, bill, bad)).status(), JSON.stringify(bad).slice(0, 60)).toBe(400);
	}
	expect((await billRequest(g.page, '/houan/abc/shusei/kaku', { article: ARTICLE_1, body, rev: '1' })).status()).toBe(404);
	expect((await billRequest(g.page, '/houan/99999999/shusei/kaku', { article: ARTICLE_1, body, rev: '1' })).status()).toBe(404);
	// 更新の番号の形が違うか、ない修正案は 404
	expect((await billRequest(g.page, `${tabPath(bill)}/kaku?koushin=abc`, { rev: '1', body, reason: '', 'cf-turnstile-response': 'test-pass' })).status()).toBe(404);
	expect((await billRequest(g.page, `${tabPath(bill)}/kaku?koushin=99999999`, { rev: '1', body, reason: '', 'cf-turnstile-response': 'test-pass' })).status()).toBe(404);
});

test('信頼の境界：取り込む・賛同・票のフォームは形の違う値を 400、ほかの法案の修正案を 404 にする', async ({ browser }, info) => {
	const w = info.project.name;
	const month = monthOf(w, 8);
	const { a, bill, label } = await proposed(browser, w, 8, month);
	const other = await proposed(browser, w, 9, month);
	const g = await user(browser, ip(w, 8, 5), at(month, 15), `g-${label}`);
	const s = await user(browser, ip(w, 8, 6), at(month, 15), `s-${label}`);
	const id = await amend(g, bill, ARTICLE_1, `境界の修正案 ${label}`);
	const otherId = await amend(g, other.bill, ARTICLE_1, `別案別文 ${label}`);

	for (const bad of [
		{ amendment: 'abc', revision: '1' },
		{ amendment: id, revision: 'x' },
		{ revision: '1' }
	]) {
		expect((await act(a.page, bill, 'accept', bad as Record<string, string>)).status(), JSON.stringify(bad)).toBe(400);
	}
	expect((await act(a.page, bill, 'accept', { amendment: otherId, revision: '1' })).status()).toBe(404);
	for (const bad of [
		{ amendment: 'abc', revision: '1', op: 'add' },
		{ amendment: id, revision: 'x', op: 'add' },
		{ amendment: id, revision: '1', op: 'toggle' },
		{ amendment: id, revision: '1' }
	]) {
		expect((await act(s.page, bill, 'support', bad as Record<string, string>)).status(), JSON.stringify(bad)).toBe(400);
	}
	expect((await act(s.page, bill, 'support', { amendment: otherId, revision: '1', op: 'add' })).status()).toBe(404);
	// 読んだ本文（revision）が違えば、賛同も取り込みも断る
	expect((await act(s.page, bill, 'support', { amendment: id, revision: '9', op: 'add' })).status()).toBe(409);
	expect((await act(a.page, bill, 'accept', { amendment: id, revision: '9' })).status()).toBe(409);

	await s.setNow(at(month, 22));
	const vote = { amendment: id, choice: 'yes', 'cf-turnstile-response': 'test-pass' };
	for (const bad of [
		{ ...vote, amendment: 'abc' },
		{ ...vote, choice: 'maybe' },
		{ amendment: id, 'cf-turnstile-response': 'test-pass' }
	]) {
		expect((await act(s.page, bill, 'vote', bad as Record<string, string>)).status(), JSON.stringify(bad)).toBe(400);
	}
	expect((await act(s.page, bill, 'vote', { ...vote, amendment: otherId })).status()).toBe(404);
	// Turnstile を通らなければ断る
	expect((await act(s.page, bill, 'vote', { ...vote, 'cf-turnstile-response': 'bad' })).status()).toBe(400);
	expect((await billRequest(s.page, '/houan/abc/shusei?/vote', vote)).status()).toBe(404);
});
