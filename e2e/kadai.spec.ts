// Issue #25 課題の一覧・投稿・ページと「わかる」（設計書 docs/spec/25.md）
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { newUser, postIssue, postIssueRequest, stubTurnstile, supportRequest } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});

/** テストごと・幅ごとに別の回線（IP）にする */
const ip = (project: string, test: number, n: number) => `10.${project === 'sp' ? 1 : 2}.${test}.${n}`;

/** ハイドレーションが済むまで待つ（済む前に入力すると、段の切り替えやフォームの送り方が変わる） */
const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });

/** 一覧に並んだ課題のタイトル（上から） */
const listedTitles = (page: Page) =>
	page.locator('main a[href^="/kadai/"]:not([href="/kadai/kaku"])').allInnerTexts();

/**
 * url から「次の50件」をたどり、wanted がすべて出るまでのタイトルを上から集める。
 * ほかのテスト（もう一方の幅を含む）が同時に課題を足しても、並びの前後だけを比べられるように
 */
async function titlesUntil(page: Page, url: string, wanted: string[]) {
	const titles: string[] = [];
	const pageOf = new Map<string, string>();
	await page.goto(url);
	for (let i = 0; i < 20; i++) {
		for (const t of await listedTitles(page)) {
			titles.push(t);
			pageOf.set(t, page.url());
		}
		if (wanted.every((w) => titles.includes(w))) break;
		const next = page.getByRole('link', { name: '次の50件' });
		if ((await next.count()) === 0) break;
		await next.click();
		await page.waitForURL(/page=\d+/);
	}
	return { titles, pageOf };
}

test('基準1：一覧はログインなしで見られ、3つの並び・お題の絞り込み・50件ごとのページがある', async ({ browser, page }, info) => {
	test.setTimeout(120_000);
	const p = info.project.name;
	const stamp = Date.now();
	const tag = `${p}-${stamp}`;
	// 名前は実行ごとに変える（再試行で1アカウント5件の上限に当たらないように）
	const open = async (name: string, n: number) => {
		const u = await newUser(browser, { name: `${name}-${p}-${stamp % 1e8}`, ip: ip(p, 1, n) });
		contexts.push(u.context);
		return u.page;
	};

	// 51件を超えるように課題を足す（1アカウント5件、1回線20件の上限の内側で）
	for (let i = 0; i < 11; i++) {
		const filler = await open(`list${i}`, i);
		for (let j = 0; j < 5; j++) await postIssue(filler, { title: `一覧の埋め草 ${tag} ${i}-${j}` });
	}
	const author = await open('list-author', 20);
	const x = `並びX ${tag}`;
	const y = `並びY ${tag}`;
	const z = `並びZ ${tag}`;
	const xId = await postIssue(author, { title: x });
	const yId = await postIssue(author, { title: y });
	await postIssue(author, { title: z, topic: 'none' });
	for (const [n, ids] of [[21, [xId, yId]], [22, [xId]]] as const) {
		const s = await open(`list-s${n}`, n);
		for (const id of ids) expect((await supportRequest(s, id, 'add')).status()).toBeLessThan(400);
	}

	// トップページから行ける。既定は「わかる」の多い順
	await page.goto('/');
	await page.getByRole('link', { name: '課題を見る' }).click();
	await expect(page).toHaveURL('/kadai');
	await expect(page.getByRole('heading', { level: 1, name: '課題', exact: true })).toBeVisible();
	const titles = await listedTitles(page);
	expect(titles.indexOf(x)).toBeGreaterThanOrEqual(0);
	expect(titles.indexOf(x)).toBeLessThan(titles.indexOf(y));
	// 行には、わかるの数とお題の印（タイトルの数字と混ざらないよう、数のセルだけを見る）
	const row = (title: string) => page.locator('tr').filter({ has: page.getByRole('link', { name: title, exact: true }) });
	await expect(row(x).locator('td').nth(1)).toHaveText(/^\s*(わかる)?\s*2\s*$/);
	await expect(row(x)).toContainText('お題：消費者保護');

	// 50件ごと
	expect(titles).toHaveLength(50);
	await page.getByRole('link', { name: '次の50件' }).click();
	await expect(page).toHaveURL('/kadai?page=2');
	expect((await listedTitles(page)).length).toBeGreaterThan(0);

	// 新しい順（並びを選ぶと1ページ目から）
	await page.goto('/kadai');
	await page.getByLabel('並び').selectOption({ label: '新しい順' });
	await expect(page).toHaveURL('/kadai?sort=new');
	const byNew = await titlesUntil(page, '/kadai?sort=new', [x, y, z]);
	expect(byNew.titles.indexOf(z)).toBeGreaterThanOrEqual(0);
	expect(byNew.titles.indexOf(z)).toBeLessThan(byNew.titles.indexOf(y));
	expect(byNew.titles.indexOf(y)).toBeLessThan(byNew.titles.indexOf(x));
	await page.goto(byNew.pageOf.get(z)!);
	await expect(row(z)).not.toContainText('お題');

	// 今回のお題で絞り込む（並びはそのまま）。Z（ほかの話題）は X より新しいので、出るなら X より前に出る
	await page.goto('/kadai?sort=new');
	await page.getByRole('link', { name: '今回のお題' }).click();
	await expect(page).toHaveURL('/kadai?sort=new&topic=current');
	await expect(page.getByLabel('並び')).toHaveValue('new');
	const byTopic = await titlesUntil(page, '/kadai?sort=new&topic=current', [x]);
	expect(byTopic.titles).toContain(x);
	expect(byTopic.titles).not.toContain(z);

	// 最近「わかる」が増えている順
	await page.goto('/kadai?sort=rising');
	await expect(page.getByLabel('並び')).toHaveValue('rising');
	const byRising = await titlesUntil(page, '/kadai?sort=rising', [x, y]);
	expect(byRising.titles.indexOf(x)).toBeGreaterThanOrEqual(0);
	expect(byRising.titles.indexOf(x)).toBeLessThan(byRising.titles.indexOf(y));
});

test('基準2：3つの段で課題を書くと、課題のページに書いた内容とお題が出る', async ({ browser, page }, info) => {
	const p = info.project.name;
	const title = `定期購入の解約の電話がつながらない ${p}-${Date.now()}`;

	// ログインしていなければ、ログインの画面へ
	await page.goto('/kadai/kaku');
	await hydrated(page);
	await expect(page).toHaveURL('/login?next=%2Fkadai%2Fkaku');

	const { context, page: a } = await newUser(browser, { name: `write-${p}`, ip: ip(p, 2, 1), days: 0 });
	contexts.push(context);
	await a.goto('/kadai/kaku');
	await hydrated(a);
	await a.getByLabel('何に困っていますか？').fill(title);
	await a.getByRole('button', { name: '次へ' }).click();
	await a.getByLabel('困っている人').fill('ネット通販で定期購入を申し込んだ人');
	await a.getByLabel('具体的には').fill('1回だけのつもりだった。\n毎月届き続けている。');
	await a.getByRole('radio', { name: '関係ある（消費者保護）' }).check();
	await a.getByRole('button', { name: '次へ' }).click();
	// 確認の段：書いた内容がそのまま出る
	await expect(a.getByText(title)).toBeVisible();
	await a.getByRole('button', { name: '投稿する' }).click();

	await expect(a).toHaveURL(/\/kadai\/\d+$/);
	await expect(a.getByRole('heading', { level: 1, name: title })).toBeVisible();
	await expect(a.getByText('ネット通販で定期購入を申し込んだ人')).toBeVisible();
	await expect(a.getByText(/1回だけのつもりだった。\s+毎月届き続けている。/)).toBeVisible();
	await expect(a.getByText('お題：消費者保護')).toBeVisible();
});

test('基準3：入力に誤りがあれば保存せず、その欄の横に理由を出す', async ({ browser }, info) => {
	const p = info.project.name;
	const { context, page } = await newUser(browser, { name: `invalid-${p}`, ip: ip(p, 3, 1) });
	contexts.push(context);
	const title = `長すぎるタイトル ${p}-${Date.now()} `.padEnd(61, 'あ');

	await page.goto('/kadai/kaku');
	await hydrated(page);
	const field = page.getByLabel('何に困っていますか？');
	// ブラウザの検証を外して、サーバーの判定を確かめる
	await field.evaluate((el) => el.removeAttribute('maxlength'));
	await field.fill(title);
	await page.getByRole('button', { name: '次へ' }).click();
	await page.getByLabel('困っている人').fill('困っている人');
	await page.getByLabel('具体的には').fill('具体例');
	await page.getByRole('radio', { name: 'ほかの話題' }).check();
	await page.getByRole('button', { name: '次へ' }).click();
	await page.getByRole('button', { name: '投稿する' }).click();

	// 誤りのある段に戻り、欄の横に理由。入力は残る
	await expect(field).toHaveAccessibleDescription('60字以内で書いてください');
	await expect(field).toHaveValue(title);
	const other = await newUser(browser, { ip: ip(p, 3, 2) });
	contexts.push(other.context);
	await other.page.goto('/kadai?sort=new');
	expect(await listedTitles(other.page)).not.toContain(title);

	// 直して出し直せば通る（使い終わった Turnstile は作り直される）
	await field.fill(title.slice(0, 60));
	await page.getByRole('button', { name: '次へ' }).click();
	await page.getByRole('button', { name: '次へ' }).click();
	await page.getByRole('button', { name: '投稿する' }).click();
	await expect(page).toHaveURL(/\/kadai\/\d+$/);
});

test('基準4：「わかる」を押すと数が増えて押した状態に、もう一度押すと取り消す。ログインしていなければログインへ', async ({ browser, page }, info) => {
	const p = info.project.name;
	const author = await newUser(browser, { name: `support-author-${p}`, ip: ip(p, 4, 1) });
	contexts.push(author.context);
	const id = await postIssue(author.page, { title: `わかるのテスト ${p}-${Date.now()}` });

	await stubTurnstile(page);
	await page.setExtraHTTPHeaders({ 'x-test-ip': ip(p, 4, 9) });
	await page.goto(`/kadai/${id}`);
	await expect(page.getByText('同じことで困っていたら押してください')).toBeVisible();
	await page.getByRole('button', { name: /^わかる/ }).click();
	await expect(page).toHaveURL(`/login?next=%2Fkadai%2F${id}`);

	const b = await newUser(browser, { name: `supporter-${p}`, ip: ip(p, 4, 2) });
	contexts.push(b.context);
	await b.page.goto(`/kadai/${id}`);
	const wakaru = b.page.getByRole('button', { name: /^わかる/ });
	await expect(wakaru).toHaveText(/わかる\s*0$/);
	await expect(wakaru).toHaveAttribute('aria-pressed', 'false');
	await wakaru.click();
	await expect(wakaru).toHaveText(/わかる\s*1$/);
	await expect(wakaru).toHaveAttribute('aria-pressed', 'true');
	await b.page.reload();
	await expect(wakaru).toHaveText(/わかる\s*1$/);
	await wakaru.click();
	await expect(wakaru).toHaveText(/わかる\s*0$/);
	await expect(wakaru).toHaveAttribute('aria-pressed', 'false');
});

test('基準5：Turnstile が通らなければ、課題を保存せず、ログインでも提供元へ送らない', async ({ browser }, info) => {
	const p = info.project.name;
	const { context, page } = await newUser(browser, { name: `turnstile-${p}`, ip: ip(p, 5, 1), token: 'test-fail' });
	contexts.push(context);
	const title = `通らない ${p}-${Date.now()}`;

	await page.goto('/kadai/kaku');
	await hydrated(page);
	await page.getByLabel('何に困っていますか？').fill(title);
	await page.getByRole('button', { name: '次へ' }).click();
	await page.getByLabel('困っている人').fill('困っている人');
	await page.getByLabel('具体的には').fill('具体例');
	await page.getByRole('radio', { name: 'ほかの話題' }).check();
	await page.getByRole('button', { name: '次へ' }).click();
	await page.getByRole('button', { name: '投稿する' }).click();
	await expect(page.getByText('確認できませんでした')).toBeVisible();
	await page.goto('/kadai?sort=new');
	expect(await listedTitles(page)).not.toContain(title);

	// ログインの確かめは、ログインしていない人で（ログイン済みだと、断った画面の代わりに戻り先へ送られる）
	const guest = await newUser(browser, { ip: ip(p, 5, 2), token: 'test-fail' });
	contexts.push(guest.context);
	await guest.page.goto('/login');
	const res = await guest.page.request.post('/login?/google', {
		form: { next: '/', 'cf-turnstile-response': 'test-fail' },
		headers: { origin: 'http://localhost:4173', accept: 'text/html' },
		maxRedirects: 0
	});
	expect(res.status()).toBe(400);
	expect(res.headers()['location']).toBeUndefined();
	expect(await res.text()).toContain('確認できませんでした');
});

test('基準6：日本以外からのログイン・投稿・「わかる」は断る。見ることはできる', async ({ browser }, info) => {
	const p = info.project.name;
	const jp = await newUser(browser, { name: `country-jp-${p}`, ip: ip(p, 6, 1) });
	contexts.push(jp.context);
	const id = await postIssue(jp.page, { title: `国のテスト ${p}-${Date.now()}` });

	for (const country of ['US', 'T1']) {
		const { context, page } = await newUser(browser, { name: `country-${country}-${p}`, ip: ip(p, 6, 2), country });
		contexts.push(context);
		await page.goto('/kadai');
		await expect(page.getByRole('heading', { level: 1, name: '課題', exact: true })).toBeVisible();
		await page.goto(`/kadai/${id}`);
		await expect(page.getByRole('button', { name: /^わかる/ })).toBeVisible();

		const guest = await newUser(browser, { ip: ip(p, 6, 3), country });
		contexts.push(guest.context);
		const login = await guest.page.request.post('/login?/google', {
			form: { next: '/', 'cf-turnstile-response': 'test-pass' },
			headers: { origin: 'http://localhost:4173', accept: 'text/html' },
			maxRedirects: 0
		});
		expect(login.status(), country).toBe(403);
		expect(await login.text()).toContain('日本国内からのみ参加できます');

		const posted = await postIssueRequest(page, { title: `国外から ${country} ${p}` });
		expect(posted.status(), country).toBe(403);
		expect(await posted.text()).toContain('日本国内からのみ参加できます');

		const supported = await supportRequest(page, id, 'add');
		expect(supported.status(), country).toBe(403);
		await page.goto(`/kadai/${id}`);
		await expect(page.getByRole('button', { name: /^わかる/ })).toHaveText(/わかる\s*0$/);
	}
});

test('基準7・8（画面）：断ったときは理由を、締め出したときはいつまでかを出す', async ({ browser }, info) => {
	const p = info.project.name;
	const author = await newUser(browser, { name: `limit-author-${p}`, ip: ip(p, 8, 1) });
	contexts.push(author.context);
	const id = await postIssue(author.page, { title: `制限のテスト ${p}-${Date.now()}` });

	// 同じ課題に同じ回線から4人目
	for (let n = 1; n <= 4; n++) {
		const u = await newUser(browser, { name: `limit-ip${n}-${p}`, ip: ip(p, 8, 2) });
		contexts.push(u.context);
		const res = await supportRequest(u.page, id, 'add');
		if (n < 4) {
			expect(res.status(), String(n)).toBeLessThan(400);
			continue;
		}
		expect(res.status()).toBe(429);
		expect(await res.text()).toContain('この回線からは、この課題にこれ以上「わかる」を付けられません');
	}

	// 5分に10回を超えると理由を出し、3回超えると締め出して期限を出す
	const { context, page } = await newUser(browser, { name: `limit-burst-${p}`, ip: ip(p, 8, 3) });
	contexts.push(context);
	for (let i = 0; i < 10; i++) {
		expect((await supportRequest(page, id, i % 2 ? 'remove' : 'add')).status(), String(i)).toBeLessThan(400);
	}
	const refused = await supportRequest(page, id, 'add');
	expect(refused.status()).toBe(429);
	expect(await refused.text()).toContain('短いあいだに「わかる」や「考えが変わった」を何度も押しました');
	await supportRequest(page, id, 'add');
	await supportRequest(page, id, 'add');
	const banned = await supportRequest(page, id, 'add');
	expect(banned.status()).toBe(429);
	expect(await banned.text()).toMatch(/制限を何度も超えたため、\d+月\d+日 \d+時\d{2}分まで、課題や解決策の投稿、「わかる」「考えが変わった」、通報ができません/);
	// 締め出しの間は、課題の投稿もできない
	const posted = await postIssueRequest(page, { title: `締め出し中 ${p}` });
	expect(posted.status()).toBe(429);
	expect(await posted.text()).toContain('制限を何度も超えたため');
});

test('信頼の境界：課題の番号の形が違えば 404', async ({ request }) => {
	for (const id of ['abc', '01', '0', '-1', '1.5', '99999999999', '9999999999']) {
		expect((await request.get(`/kadai/${id}`)).status(), id).toBe(404);
		const res = await request.post(`/kadai/${id}?/support`, {
			form: { op: 'add' },
			headers: { origin: 'http://localhost:4173', accept: 'text/html' },
			maxRedirects: 0
		});
		// ログインしていなくても、番号の形が違えば先に 404
		expect(res.status(), id).toBe(404);
	}
});

test('信頼の境界：「わかる」の op が add・remove 以外なら 400', async ({ browser }, info) => {
	const p = info.project.name;
	const { context, page } = await newUser(browser, { name: `op-${p}`, ip: ip(p, 7, 1) });
	contexts.push(context);
	const id = await postIssue(page, { title: `op のテスト ${p}-${Date.now()}` });
	for (const op of ['toggle', '', 'ADD', undefined]) {
		expect((await supportRequest(page, id, op)).status(), String(op)).toBe(400);
	}
	await page.goto(`/kadai/${id}`);
	await expect(page.getByRole('button', { name: /^わかる/ })).toHaveText(/わかる\s*0$/);
});

test('信頼の境界：一覧の page・topic・sort の形が違えば 404', async ({ request }) => {
	for (const q of [
		'page=1',
		'page=0',
		'page=-1',
		'page=abc',
		'page=02',
		'page=10000',
		'page=9999',
		'topic=all',
		'topic=',
		'topic=CURRENT',
		'sort=old',
		'sort=',
		'sort=NEW'
	]) {
		expect((await request.get(`/kadai?${q}`)).status(), q).toBe(404);
	}
	expect((await request.get('/kadai?sort=rising&topic=current')).status()).toBe(200);
});
