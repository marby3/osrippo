// Issue #77 基準8と信頼の境界：委員会のページ。選挙と解任の中身は src/lib/db/chairs.test.ts
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { billRequest, billSupportRequest, createAmendBill, issueWithSolutions, newUser, ORIGIN, postIssue, proposeRequest, reportRequest, staffRequest, supportRequest } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});
test.use({ actionTimeout: 15_000 });
test.beforeEach(() => test.setTimeout(240_000));

const stamp = () => Date.now() % 1e8;
const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
/** 幅ごとに別の年を使う（2369年までは共同提出者のテスト、2410年までは一時の撮影が使っている） */
const monthOf = (w: string, group: number) => `${2420 + group * 3 + (w === 'sp' ? 0 : 1)}-05`;
const prevOf = (month: string) => month.replace(/-05$/, '-04');
const nextOf = (month: string) => month.replace(/-05$/, '-06');
const at = (month: string, day: number) => `${month}-${String(day).padStart(2, '0')}T09:00:00+09:00`;

type User = { page: Page; name: string; setNow: (now: string) => Promise<void> };
async function user(browser: Browser, address: string, now: string, name: string, opts: { days?: number; country?: string } = {}): Promise<User> {
	const u = await newUser(browser, { name, ip: address, days: opts.days ?? 8, ...(opts.country ? { country: opts.country } : {}) });
	contexts.push(u.context);
	const setNow = (t: string) => u.context.setExtraHTTPHeaders({ 'x-test-ip': address, 'x-test-now': t, ...(opts.country ? { 'x-test-country': opts.country } : {}) });
	await setNow(now);
	return { page: u.page, name, setNow };
}

function setup(browser: Browser, w: string, group: number) {
	const month = monthOf(w, group);
	const label = `c${group}${w}${stamp()}`;
	let seq = 0;
	const person = (now: string, opts: { days?: number; country?: string } = {}) => {
		seq += 1;
		return user(browser, `10.${w === 'sp' ? 100 : 101}.${group}.${seq}`, now, `u${seq}-${label}`, opts);
	};
	/** 投票資格のある人：前の月に課題を書いている */
	async function voter(now: string) {
		const u = await person(at(prevOf(month), 10));
		await postIssue(u.page, { title: `前の月の課題 ${label} ${seq}` });
		await u.setNow(now);
		return u;
	}
	/** 発議した法案（質疑を書く先） */
	async function bill() {
		const now = at(month, 5);
		const a = await person(now);
		const title = `委員会の法案 ${label}`;
		const { ids } = await issueWithSolutions(a.page, title, [`解決策 ${title}`]);
		const path = await createAmendBill(a.page, title, ids[0]);
		for (let i = 0; i < 3; i++) {
			const b = await person(now);
			const res = await billSupportRequest(b.page, path, { op: 'add', rev: '1' });
			expect(res.status(), await res.text()).toBe(200);
		}
		const res = await proposeRequest(a.page, path);
		expect(res.status(), await res.text()).toBe(200);
		return path;
	}
	return { month, label, person, voter, bill };
}

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const post = (page: Page, action: string, form: Record<string, string> = {}) => billRequest(page, `/iinkai?/${action}`, form);
const passed = { 'cf-turnstile-response': 'test-pass' };

/** 押して、応答を待つ。断られていないことも確かめる */
async function press(page: Page, name: string) {
	const [res] = await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/iinkai')), button(page, name).click()]);
	expect(res.status()).toBe(200);
	expect(await res.text()).not.toContain('"type":"failure"');
}

/** 質疑を書く（立候補の資格） */
async function ask(u: User, path: string, label: string) {
	const res = await billRequest(u.page, `${path}/shitsugi/kaku`, { body: `質疑 ${label} ${u.name}`, ...passed });
	expect(res.status(), await res.text()).toBeLessThan(400);
}

test('基準8：委員会のページに委員長と理事、選挙、解任動議が出て、立候補と投票と署名ができ、委員長に運営の画面が開く', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 1);
	const path = await s.bill();

	// 候補の2人は3週目に質疑を書く
	const candidate = await s.person(at(s.month, 16));
	const second = await s.person(at(s.month, 16));
	const noPost = await s.person(at(s.month, 22));
	await ask(candidate, path, s.label);
	await ask(second, path, s.label);
	await candidate.setNow(at(s.month, 22));
	await second.setNow(at(s.month, 22));

	// 初回の会期は委員長がいない。投票の前は立候補できない
	const anonymous = await browser.newContext({ baseURL: ORIGIN, extraHTTPHeaders: { 'x-test-now': at(s.month, 5), 'x-test-ip': '10.102.1.1' } });
	contexts.push(anonymous);
	const stranger = await anonymous.newPage();
	await stranger.goto('/iinkai');
	await expect(stranger.getByText('今月は委員長がいません。運営が事務局を務めています。')).toBeVisible();
	await expect(button(stranger, '立候補する')).toHaveCount(0);
	await expect(stranger.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');

	// 4週目：質疑を書いていない人には理由が出る
	await noPost.page.goto('/iinkai');
	await expect(noPost.page.getByText('この会期に質疑か答弁を書いた人が立候補できます', { exact: false })).toBeVisible();
	await expect(button(noPost.page, '立候補する')).toHaveCount(0);

	// 立候補と取り下げ、もう一度立候補
	await candidate.page.goto('/iinkai');
	await hydrated(candidate.page);
	await press(candidate.page, '立候補する');
	await expect(button(candidate.page, '立候補を取り下げる')).toBeVisible();
	await press(candidate.page, '立候補を取り下げる');
	await expect(button(candidate.page, '立候補する')).toBeVisible();
	await press(candidate.page, '立候補する');
	await expect(button(candidate.page, '立候補を取り下げる')).toBeVisible();
	await second.page.goto('/iinkai');
	await hydrated(second.page);
	await press(second.page, '立候補する');

	// 投票：自分の票が分かり、変えられる
	const v1 = await s.voter(at(s.month, 23));
	const v2 = await s.voter(at(s.month, 23));
	const v3 = await s.voter(at(s.month, 23));
	await v1.page.goto('/iinkai');
	await hydrated(v1.page);
	await v1.page.getByRole('radio', { name: second.name }).check();
	await press(v1.page, '投票する');
	await expect(v1.page.getByText('票を入れました。締切まで変えられます。')).toBeVisible();
	await v1.page.goto('/iinkai');
	await hydrated(v1.page);
	await expect(v1.page.getByRole('radio', { name: second.name })).toBeChecked();
	await v1.page.getByRole('radio', { name: candidate.name }).check();
	await press(v1.page, '投票する');
	for (const [who, whom] of [[v2, candidate], [v3, second]] as const) {
		await who.page.goto('/iinkai');
		await hydrated(who.page);
		await who.page.getByRole('radio', { name: whom.name }).check();
		await press(who.page, '投票する');
	}
	// 前の月に行動がない人は投票できず、理由が出る
	await candidate.page.goto('/iinkai');
	await expect(candidate.page.getByText('今回は投票できません', { exact: false })).toBeVisible();

	// 得票数、合計の票数、順位、入れた人、質疑と答弁の数は出ない
	const data = await (await v2.page.request.get('/iinkai/__data.json')).text();
	for (const word of [v1.name, v3.name, '"rank"', '"votes"', 'totalVotes', 'ipHash', 'userId', 'questions', 'answers']) expect(data, word).not.toContain(word);
	await v2.page.goto('/iinkai');
	for (const word of ['得票', '票数']) await expect(v2.page.getByRole('main').getByText(word)).toHaveCount(0);

	// 締切から1分は集計中。そのあと読むと確定する（2票と1票）
	const next = nextOf(s.month);
	await v1.setNow(`${next}-01T00:00:30+09:00`);
	await v1.page.goto('/iinkai');
	await expect(v1.page.getByText('選挙の結果を集計しています')).toBeVisible();
	const after = at(next, 1);
	for (const u of [v1, v2, v3, candidate, second]) await u.setNow(after);
	await v1.page.goto('/iinkai');
	const chairArea = v1.page.getByRole('region', { name: '委員長と理事' });
	await expect(chairArea.getByText(candidate.name)).toBeVisible();
	await expect(chairArea.getByText(second.name)).toBeVisible();
	await expect(chairArea.getByText('理事が代行しています')).toHaveCount(0);

	// ログインしていなくても読める
	await stranger.context().setExtraHTTPHeaders({ 'x-test-now': after, 'x-test-ip': '10.102.1.1' });
	await stranger.goto('/iinkai');
	await expect(stranger.getByText(candidate.name)).toBeVisible();

	// 委員長に運営の画面が開き、ほかの人と7日前の理事は 404
	await candidate.page.goto('/iinkai');
	await candidate.page.getByRole('link', { name: '通報と確認の対応の画面へ' }).click();
	await expect(candidate.page).toHaveURL(/\/kanri$/);
	await expect(candidate.page.getByRole('heading', { name: '通報を受けた課題' })).toBeVisible();
	for (const u of [v1, second]) expect((await u.page.goto('/kanri'))?.status(), u.name).toBe(404);

	// ほかの人の課題は対応でき、記録に委員長と出る。自分の課題は扱えず、通報の文面も読めない
	const reporter = await s.voter(after);
	const others = await postIssue(v1.page, { title: `ほかの人の課題 ${s.label}` });
	const own = await postIssue(candidate.page, { title: `委員長の課題 ${s.label}` });
	const ownNote = `自分への通報 ${s.label}`;
	const otherNote = `ほかの人への通報 ${s.label}`;
	expect((await reportRequest(reporter.page, own, { reason: 'other', note: ownNote })).status()).toBe(200);
	expect((await reportRequest(reporter.page, others, { reason: 'other', note: otherNote })).status()).toBe(200);
	await candidate.page.goto(`/kanri?issue=${own}`);
	const ownCard = candidate.page.getByRole('article').filter({ hasText: `委員長の課題 ${s.label}` });
	await expect(ownCard.getByText('通報 1件')).toBeVisible();
	await expect(candidate.page.getByText(ownNote)).toHaveCount(0);
	await expect(ownCard.getByRole('button', { name: '非表示にする' })).toHaveCount(0);
	expect((await staffRequest(candidate.page, 'hide', { issue: String(own), reason: 'spam', note: 'メモ' })).status()).toBe(403);
	await candidate.page.goto(`/kanri?issue=${others}`);
	await expect(candidate.page.getByText(otherNote)).toBeVisible();
	const memo = `委員長のメモ ${s.label}`;
	expect((await staffRequest(candidate.page, 'hide', { issue: String(others), reason: 'spam', note: memo })).status()).toBe(200);
	await stranger.goto('/unei');
	await expect(stranger.locator('tr', { hasText: memo })).toContainText('委員長');

	// 非表示の課題を読めるのも運営と同じ
	expect((await candidate.page.goto(`/kadai/${others}`))?.status()).toBe(200);
	expect((await reporter.page.goto(`/kadai/${others}`))?.status()).toBe(404);

	// 解任動議：署名の人数と必要な人数が出て、署名と取り消しができる。本人には署名のボタンが出ない
	await v2.page.goto('/iinkai');
	await hydrated(v2.page);
	await expect(v2.page.getByText('署名 0人／必要 10人')).toBeVisible();
	await press(v2.page, '解任に署名する');
	await expect(v2.page.getByText('署名 1人／必要 10人')).toBeVisible();
	await press(v2.page, '署名を取り消す');
	await expect(v2.page.getByText('署名 0人／必要 10人')).toBeVisible();
	await candidate.page.goto('/iinkai');
	await expect(button(candidate.page, '解任に署名する')).toHaveCount(0);

	// 入口：採決の一覧から委員会のページへ
	await v2.page.goto('/saiketsu');
	await v2.page.getByRole('link', { name: '委員会', exact: true }).click();
	await expect(v2.page).toHaveURL(/\/iinkai$/);
});

test('信頼の境界：候補の入力と、受け付けの確かめ（ログイン、国、締め出し、登録から7日、Turnstile）', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 2);
	const now = at(s.month, 23);
	const v = await s.voter(now);

	// candidate の形は 400、ない候補は 409
	for (const bad of [undefined, '', 'abc', '0', '-1', '1e3', '1.5']) {
		const form = bad === undefined ? passed : { candidate: bad, ...passed };
		expect((await post(v.page, 'vote', form)).status(), String(bad)).toBe(400);
	}
	const none = await post(v.page, 'vote', { candidate: '999999999', ...passed });
	expect(none.status()).toBe(409);
	expect(await none.text()).toContain('その候補には入れられません');

	// Turnstile
	for (const action of ['stand', 'vote', 'recall']) expect((await post(v.page, action, { candidate: '1', 'cf-turnstile-response': 'bad' })).status(), action).toBe(400);

	// 期間の外と、委員長がいないときは断る
	await v.setNow(at(s.month, 5));
	expect((await post(v.page, 'stand', passed)).status()).toBe(409);
	expect((await post(v.page, 'withdraw')).status()).toBe(409);
	expect((await post(v.page, 'vote', { candidate: '1', ...passed })).status()).toBe(409);
	expect((await post(v.page, 'recall', passed)).status()).toBe(409);
	expect((await post(v.page, 'cancelRecall')).status()).toBe(409);
	await v.setNow(now);

	// ログインしていなければログインへ
	const anonymous = await browser.newContext({ baseURL: ORIGIN, extraHTTPHeaders: { 'x-test-now': now, 'x-test-ip': '10.102.2.1' } });
	contexts.push(anonymous);
	const stranger = await anonymous.newPage();
	for (const action of ['stand', 'withdraw', 'vote', 'recall', 'cancelRecall']) {
		const res = await post(stranger, action, { candidate: '1', ...passed });
		expect(res.status(), action).toBe(303);
		expect(res.headers()['location']).toContain('/login?next=');
	}

	// 国：どの操作も日本からだけ
	const abroad = await s.person(now, { country: 'US' });
	for (const action of ['stand', 'withdraw', 'vote', 'recall', 'cancelRecall']) expect((await post(abroad.page, action, { candidate: '1', ...passed })).status(), action).toBe(403);

	// 登録から7日：x-test-now は使わず本当の時刻で確かめる
	const fresh = await s.person(now, { days: 1 });
	await fresh.setNow(new Date().toISOString());
	for (const action of ['stand', 'vote', 'recall']) {
		const res = await post(fresh.page, action, { candidate: '1', ...passed });
		expect(res.status(), action).toBe(403);
		expect(await res.text()).toContain('登録から7日');
	}

	// 締め出し：違反を3回で締め出される。立候補と投票と署名はできず、取り下げと取り消しは締め出しで断らない
	const owner = await s.person(now);
	const issue = await postIssue(owner.page, { title: `押す課題 ${s.label}` });
	const banned = await s.person(now);
	for (let i = 0; i < 10; i++) await supportRequest(banned.page, issue, i % 2 ? 'remove' : 'add');
	for (let i = 0; i < 3; i++) await supportRequest(banned.page, issue, 'add');
	for (const action of ['stand', 'vote', 'recall']) {
		const res = await post(banned.page, action, { candidate: '1', ...passed });
		expect(res.status(), action).toBe(429);
		expect(await res.text()).toContain('制限を何度も超えたため');
	}
	for (const action of ['withdraw', 'cancelRecall']) expect((await post(banned.page, action)).status(), action).toBe(409);
});
