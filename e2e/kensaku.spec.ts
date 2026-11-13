// Issue #38 全文検索（設計書 docs/spec/38.md）
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { newUser, postIssue, searchUrl, solutionRequest, staffRequest, supportRequest } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});

const ip = (project: string, test: number, n: number) => `10.${project === 'sp' ? 11 : 12}.${test}.${n}`;
/** テストごと・幅ごとに違う英字の印（タイトルに入れ、ほかのテストの課題と混ざらないように探す） */
const code = (project: string, n: number) =>
	[...(Date.now() * 4 + n * 2 + (project === 'sp' ? 0 : 1)).toString(26)]
		.map((c) => String.fromCharCode(97 + parseInt(c, 26)))
		.join('');

async function user(browser: Browser, name: string, ipAddress: string, opts: { role?: 'moderator' | 'operator' } = {}): Promise<Page> {
	const u = await newUser(browser, { name, ip: ipAddress, ...opts });
	contexts.push(u.context);
	return u.page;
}

/** ハイドレーションが済むまで待つ（済む前に入力すると、入力欄が空に戻される） */
const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });

const section = (page: Page, name: string) =>
	page.locator('section').filter({ has: page.getByRole('heading', { name: new RegExp(`^${name}\\s*\\d+件$`) }) });

test('基準1：法令・条文・課題・解決策の欄に分けて件数と20件までを出し、「もっと見る」でその種類だけを50件ずつ見る', async ({ browser, page }, info) => {
	test.setTimeout(120_000);
	const p = info.project.name;
	const c = code(p, 1);
	// 課題を21件（1アカウント5件・1回線20件の内側で）
	for (let a = 0; a < 5; a++) {
		const author = await user(browser, `ks1-a${a}-${p}-${c}`, ip(p, 1, a));
		for (let i = 0; i < (a < 4 ? 5 : 1); i++) await postIssue(author, { title: `${c} 検索の課題 ${a}-${i}` });
	}

	await page.goto(searchUrl(c));
	await expect(page.getByRole('heading', { level: 1, name: '探す' })).toBeVisible();
	await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
	for (const name of ['法令', '条文', '課題', '解決策']) await expect(section(page, name)).toBeVisible();
	await expect(section(page, '課題').getByRole('heading')).toHaveText(/^課題\s*21件$/);
	await expect(section(page, '課題').getByRole('listitem')).toHaveCount(20);
	await expect(section(page, '条文')).toContainText('見つかりませんでした');

	await section(page, '課題').getByRole('link', { name: 'もっと見る（21件）' }).click();
	await expect(page).toHaveURL(searchUrl(c, '&shurui=kadai'));
	await expect(page.getByRole('main').getByRole('listitem')).toHaveCount(21);

	// 法令名
	await page.goto(searchUrl('特定商取引'));
	await expect(section(page, '法令').getByRole('link', { name: '特定商取引に関する法律' })).toHaveAttribute('href', '/hourei/351AC0000000057');
});

test('基準2：条文はいまの版の条・項・号だけを、法令の順・条の順に、位置と該当部分とリンクつきで出す', async ({ page }) => {
	// 「訪問販売」は特定商取引法にだけ出る（法令の本文には「クーリング・オフ」という言葉は出てこない）
	await page.goto(searchUrl('訪問販売'));
	const rows = section(page, '条文').getByRole('listitem');
	await expect(rows.first()).toBeVisible();
	const first = rows.first();
	await expect(first).toContainText('特定商取引に関する法律');
	await expect(first.locator('mark').first()).toHaveText('訪問販売');
	await expect(first.getByRole('link')).toHaveAttribute('href', /^\/hourei\/351AC0000000057#jo-\d+(_\d+)*$/);
	// 位置は「第N条」から始まる。並びは条の番号の順
	const labels = await section(page, '条文').locator('.position').allInnerTexts();
	expect(labels.length).toBeGreaterThan(1);
	for (const l of labels) expect(l).toMatch(/^第.+条/);
	const hrefs = await rows.getByRole('link').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
	const nums = hrefs.map((h) => h.replace(/^.*#jo-/, '').split('_').map(Number));
	for (let i = 1; i < nums.length; i++) {
		const [a, b] = [nums[i - 1], nums[i]];
		const diff = a[0] - b[0] || (a[1] ?? 0) - (b[1] ?? 0);
		expect(diff, `${hrefs[i - 1]} → ${hrefs[i]}`).toBeLessThanOrEqual(0);
	}

	// 3法にまたがる言葉は、法令の番号の順（景品表示法 → 特定商取引法 → 消費者契約法）
	await page.goto(searchUrl('事業者', '&shurui=jobun'));
	const laws = await page.locator('.law').allInnerTexts();
	const order = ['不当景品類及び不当表示防止法', '特定商取引に関する法律', '消費者契約法'];
	const seen = laws.map((l) => order.indexOf(l));
	expect(seen.every((x) => x >= 0)).toBe(true);
	expect([...seen].sort((a, b) => a - b)).toEqual(seen);

	// 過去の版にだけある言葉は出ない
	await page.goto(searchUrl('該処分通知等'));
	await expect(section(page, '条文').getByRole('heading')).toHaveText(/^条文\s*0件$/);
});

test('基準3：課題と解決策は表示中のものだけを「わかる」の多い順に。解決策には課題の題名と解決策へのリンク', async ({ browser, page }, info) => {
	const p = info.project.name;
	const c = code(p, 3);
	const author = await user(browser, `ks3-author-${p}-${c}`, ip(p, 3, 1));
	const low = await postIssue(author, { title: `${c} わかるの少ない課題` });
	const high = await postIssue(author, { title: `${c} わかるの多い課題` });
	const hidden = await postIssue(author, { title: `${c} 非表示の課題` });
	const merged = await postIssue(author, { title: `${c} 統合した課題` });
	const writer = await user(browser, `ks3-writer-${p}-${c}`, ip(p, 3, 2));
	expect((await solutionRequest(writer, high, `${c} 表示中の解決策`)).status()).toBe(303);
	const s = await user(browser, `ks3-s-${p}-${c}`, ip(p, 3, 3));
	expect((await supportRequest(s, high, 'add')).status()).toBeLessThan(400);
	const op = await user(browser, `ks3-op-${p}-${c}`, ip(p, 3, 4), { role: 'operator' });
	expect((await staffRequest(op, 'hide', { issue: String(hidden), reason: 'spam', note: 'テスト' })).status()).toBeLessThan(400);
	expect((await staffRequest(op, 'merge', { issue: String(merged), target: String(low), note: 'テスト' })).status()).toBeLessThan(400);

	await page.goto(searchUrl(c));
	const issues = await section(page, '課題').getByRole('link').allInnerTexts();
	expect(issues.filter((t) => t.includes(c))).toEqual([`${c} わかるの多い課題`, `${c} わかるの少ない課題`]);
	const sol = section(page, '解決策').getByRole('listitem');
	await expect(sol).toHaveCount(1);
	await expect(sol).toContainText(`${c} わかるの多い課題`);
	await expect(sol.locator('mark').first()).toHaveText(c);
	const href = await sol.getByRole('link').first().getAttribute('href');
	expect(href).toMatch(new RegExp(`^/kadai/${high}/kaiketsu#kaiketsu-\\d+$`));
});

test('基準4：2文字と3文字以上の言葉、AND、全角半角・大文字小文字・記号の違いを気にせず探せる', async ({ browser, page }, info) => {
	const p = info.project.name;
	const c = code(p, 4);
	const author = await user(browser, `ks4-author-${p}-${c}`, ip(p, 4, 1));
	const title = `${c} 定期購入のクーリング・オフ ＥＴＣ番号`;
	await postIssue(author, { title });
	const found = async (q: string) => {
		await page.goto(searchUrl(q));
		return section(page, '課題').getByRole('link', { name: title }).count();
	};
	expect(await found(`${c} クーリングオフ`)).toBe(1);
	expect(await found(`${c.toUpperCase()} etc`)).toBe(1);
	expect(await found(`${c} 番号`)).toBe(1);
	expect(await found(`${c} 定期`)).toBe(1);
	expect(await found(`${c} 見当たらない言葉`)).toBe(0);
});

test('基準5：1文字、60字を超える、言葉が6つ以上、使えない文字のときは探さずに理由を出す', async ({ page }) => {
	for (const [q, message] of [
		['あ', '2文字以上で入力してください'],
		['あ'.repeat(61), '60字まで、言葉は5つまでで入力してください'],
		['ああ いい うう ええ おお かか', '60字まで、言葉は5つまでで入力してください'],
		['契約\u0007', '使えない文字が入っています']
	]) {
		const res = await page.goto(searchUrl(q));
		expect(res?.status(), q).toBe(200);
		await expect(page.getByRole('alert')).toHaveText(message);
		await expect(page.locator('section')).toHaveCount(0);
	}
});

test('基準6：課題の一覧の「課題を探す」で課題だけを探し、並びと絞り込みと組み合わせる', async ({ browser, page }, info) => {
	const p = info.project.name;
	const c = code(p, 6);
	const author = await user(browser, `ks6-author-${p}-${c}`, ip(p, 6, 1));
	const a = await postIssue(author, { title: `${c} 探す課題1` });
	await postIssue(author, { title: `${c} 探す課題2` });
	await postIssue(author, { title: `関係のない課題 ${p}` });
	const writer = await user(browser, `ks6-writer-${p}-${c}`, ip(p, 6, 2));
	expect((await solutionRequest(writer, a, '解決策')).status()).toBe(303);

	await page.goto('/kadai?sort=new');
	await hydrated(page);
	await page.getByLabel('課題を探す').fill(c);
	// 見えるボタンはなく、Enter で探す（Issue #120）
	await page.getByLabel('課題を探す').press('Enter');
	await expect(page).toHaveURL(`/kadai?sort=new&q=${c}`);
	await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
	const titles = await page.locator('main a[href^="/kadai/"]:not([href="/kadai/kaku"])').allInnerTexts();
	expect(titles).toEqual([`${c} 探す課題2`, `${c} 探す課題1`]);
	// 絞り込みと組み合わせる（言葉は残る）
	await page.getByRole('link', { name: '解決策あり' }).click();
	await expect(page).toHaveURL(`/kadai?sort=new&kaiketsu=ari&q=${c}`);
	expect(await page.locator('main a[href^="/kadai/"]:not([href="/kadai/kaku"])').allInnerTexts()).toEqual([`${c} 探す課題1`]);
	// 言葉の形が違えば理由を出し、一覧は空
	await page.goto('/kadai?q=%E3%81%82');
	await expect(page.getByRole('alert')).toHaveText('2文字以上で入力してください');
	await expect(page.locator('main a[href^="/kadai/"]:not([href="/kadai/kaku"])')).toHaveCount(0);
});

test('基準7：トップページと法令のページから探せる。新しく書いた課題と解決策もすぐ探せる', async ({ browser, page }, info) => {
	const p = info.project.name;
	const c = code(p, 7);
	const author = await user(browser, `ks7-author-${p}-${c}`, ip(p, 7, 1));
	const id = await postIssue(author, { title: `${c} 書いたばかりの課題` });
	expect((await solutionRequest(author, id, `${c} 書いたばかりの解決策`)).status()).toBe(303);

	await page.goto('/');
	await hydrated(page);
	await page.getByLabel('法令や課題を探す').fill(c);
	// 見えるボタンはなく、Enter で探す（Issue #120）
	await page.getByLabel('法令や課題を探す').press('Enter');
	await expect(page).toHaveURL(searchUrl(c));
	await expect(section(page, '課題').getByRole('link', { name: `${c} 書いたばかりの課題` })).toBeVisible();
	await expect(section(page, '解決策')).toContainText(`${c} 書いたばかりの解決策`);

	await page.goto('/hourei/412AC0000000061');
	await page.getByRole('link', { name: '法令や課題を探す' }).click();
	await expect(page).toHaveURL('/kensaku');
	await expect(page.getByLabel('探す言葉')).toBeVisible();
});

test('信頼の境界：shurui と page の形が違えば 404', async ({ request }) => {
	for (const extra of ['&shurui=hourei', '&shurui=', '&shurui=KADAI', '&shurui=kadai&page=1', '&shurui=kadai&page=abc', '&shurui=kadai&page=99']) {
		expect((await request.get(searchUrl('事業者', extra))).status(), extra).toBe(404);
	}
	// 条文は並べた1000件（20ページ）まで
	expect((await request.get(searchUrl('事業者', '&shurui=jobun&page=21'))).status()).toBe(404);
	expect((await request.get(searchUrl('事業者', '&shurui=jobun&page=2'))).status()).toBe(200);
});

// Issue #208 全体の検索に読める法律を足す。読める法律は db:reset でテストデータの一覧から入る（民法・日本国憲法と、遊べる3法）
test('#208 基準1：法令の欄に、読める法律が法令名・読み・略称・法令番号で出る。遊べる法律は先に出る', async ({ page }) => {
	const titles = async (q: string) => {
		await page.goto(searchUrl(q));
		return section(page, '法令').getByRole('listitem').allInnerTexts();
	};
	// 法令名
	await page.goto(searchUrl('民法'));
	await expect(section(page, '法令').getByRole('link', { name: '民法', exact: true })).toHaveAttribute('href', '/hourei/129AC0000000089');
	// 読み・法令番号（算用数字でも）
	expect(await titles('けんぽう')).toEqual(['日本国憲法']);
	expect(await titles('明治29年法律第89号')).toEqual(['民法']);
	// 遊べる法律（題名で当たる）が先、読める法律（民法は法令番号の「法律」で当たる）があと。遊べる法律は二重に出さない
	expect(await titles('法律')).toEqual(['特定商取引に関する法律', '民法']);
	await expect(section(page, '法令').getByRole('heading')).toHaveText(/^法令\s*2件$/);
});

test('#208 基準2：読める法律の条文は3文字以上の言葉で当たり、条だけのページへのリンクが出る。2文字の言葉では探さない', async ({ page }) => {
	await page.goto(searchUrl('公共の福祉'));
	const jobun = section(page, '条文');
	await expect(jobun.getByRole('link', { name: /^民法 第1条$/ })).toHaveAttribute('href', '/hourei/129AC0000000089/1');
	await expect(jobun.getByRole('link', { name: /^日本国憲法 第\d+条$/ }).first()).toHaveAttribute('href', /^\/hourei\/321CONSTITUTION\/\d+$/);
	await expect(jobun.locator('mark').first()).toHaveText('公共の福祉');

	// 2文字の言葉：読める法律の条文は探さず、遊べる法律の条文はいまのまま当たる
	await page.goto(searchUrl('私権'));
	await expect(section(page, '条文').locator('a[href^="/hourei/129AC0000000089"]')).toHaveCount(0);
	await expect(section(page, '条文')).toContainText('ほかの法律の条文は3文字以上で探せます');
	await page.goto(searchUrl('契約'));
	await expect(section(page, '条文').getByRole('link').first()).toHaveAttribute('href', /^\/hourei\/(337AC0000000134|351AC0000000057|412AC0000000061)#jo-/);
});
