// Issue #46 法案を書く画面と法案のページ（改正・廃止）。表とルールは docs/spec/45.md
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { ORIGIN, newUser, postIssue, solutionRequest, solutionStaffRequest } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});

type Width = 'sp' | 'pc';
const ip = (project: string, test: number, n: number) => `10.${project === 'sp' ? 40 : 41}.${test}.${n}`;
const stamp = () => Date.now() % 1e8;
const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });

/** 消費者契約法（委員会の対象の3本の1つ） */
const LAW = '412AC0000000061';
const LAW_TITLE = '消費者契約法';
/** 第1条（目的）のいまの条文の一部 */
const ARTICLE1 = '消費者と事業者との間の情報の質及び量並びに交渉力の格差に鑑み';

async function user(
	browser: Browser,
	name: string,
	ipAddress: string,
	opts: { days?: number; role?: 'moderator' | 'operator'; country?: string; now?: string } = {}
): Promise<Page> {
	// 下書きは登録から7日たったアカウントだけ（Issue #41 決めたこと6）
	const u = await newUser(browser, { name, ip: ipAddress, days: opts.days ?? 8, role: opts.role, country: opts.country });
	contexts.push(u.context);
	if (opts.now) await u.context.setExtraHTTPHeaders({ 'x-test-ip': ipAddress, ...(opts.country ? { 'x-test-country': opts.country } : {}), 'x-test-now': opts.now });
	return u.page;
}

/** 課題と解決策を書き、解決策の番号を返す */
async function solutions(page: Page, label: string, bodies: string[]) {
	const issueId = await postIssue(page, { title: `法案の元の課題 ${label}` });
	for (const body of bodies) {
		const res = await solutionRequest(page, issueId, body);
		expect(res.status(), await res.text()).toBe(303);
	}
	await page.goto(`/kadai/${issueId}/kaiketsu`);
	const ids: string[] = [];
	for (const body of bodies) {
		const id = await page.locator('article').filter({ hasText: body }).getAttribute('id');
		expect(id).toMatch(/^kaiketsu-\d+$/);
		ids.push((id as string).replace('kaiketsu-', ''));
	}
	return { issueId, ids };
}

/** いま施行されている版（書く画面が条文を取りに行くのと同じところから） */
async function currentBase(page: Page, law = LAW) {
	const res = await page.request.get(`/houan/kaku/joubun?law=${law}`);
	expect(res.status()).toBe(200);
	return ((await res.json()) as { revisionId: string }).revisionId;
}

type Form = Record<string, string | string[]>;

/** 書く画面のフォームと同じ POST（リダイレクトは追わない）。配列の値は同じ名前で並べる */
function billRequest(page: Page, path: string, form: Form) {
	const body = new URLSearchParams();
	for (const [k, v] of Object.entries(form)) for (const x of Array.isArray(v) ? v : [v]) body.append(k, x);
	return page.request.post(path, {
		data: body.toString(),
		headers: { origin: ORIGIN, accept: 'text/html', 'content-type': 'application/x-www-form-urlencoded' },
		maxRedirects: 0
	});
}

/** 第1条を書きかえる改正の法案のフォームの値 */
const amendForm = (base: string, solution: string, title: string, extra: Form = {}): Form => ({
	kind: 'amend',
	title,
	law: LAW,
	base,
	'op.0': 'amend',
	'target.0': '1',
	'caption.0': '（目的）',
	'body.0': 'この法律は、消費者がいつでも契約をやめられるようにすることを目的とする。',
	affected: '解約できずに困っている人',
	sideEffects: '事業者の負担が増える',
	solution,
	'cf-turnstile-response': 'test-pass',
	...extra
});

/** 法案のページのパス（作ったときのリダイレクト先） */
function billPath(res: { status(): number; headers(): Record<string, string> }) {
	expect(res.status()).toBe(303);
	const path = res.headers()['location'] ?? '';
	expect(path).toMatch(/^\/houan\/\d+$/);
	return path;
}

/** 書く画面で、1つ目の変更を第1条の書きかえにして、共通の欄を書く */
async function fillCommon(page: Page, title: string) {
	await page.getByRole('radio', { name: '改正' }).check();
	await page.getByLabel('題名').fill(title);
	await page.getByLabel('対象の法令').selectOption({ label: LAW_TITLE });
	await page.getByLabel('誰が困っているか').fill('定期購入の解約ができずに困っている人');
	await page.getByLabel('副作用').fill('事業者の解約窓口の負担が増える');
}

/** 状態：スマホは「いま：下書き」の1行、PC は「いまの段階」の並びの「下書き（いまここ）」 */
function status(page: Page, w: Width, name: string) {
	return w === 'sp' ? page.getByText(new RegExp(`^いま：\\s*${name}$`)) : page.getByText(new RegExp(`^${name}\\s*（いまここ）$`));
}

test('基準1：解決策から書き始める。同じ課題の解決策を足せ、ログインが要り、解決策がなければ案内する', async ({ browser, page }, info) => {
	const p = info.project.name;
	const s = stamp();
	const a = await user(browser, `h1-a-${p}-${s}`, ip(p, 1, 1));
	const [first, second] = [`書き始めの解決策 ${p}-${s}`, `足せる解決策 ${p}-${s}`];
	const { issueId, ids } = await solutions(a, `h1-${p}-${s}`, [first, second]);

	await a.goto(`/kadai/${issueId}`);
	await a.locator('article').filter({ hasText: first }).getByRole('link', { name: 'この解決策から法案を書く' }).click();
	await expect(a).toHaveURL(new RegExp(`/houan/kaku\\?kaiketsu=${ids[0]}$`));
	await expect(a.getByRole('heading', { level: 1, name: '法案を書く' })).toBeVisible();
	const cited = a.getByRole('group', { name: '元になった解決策' });
	await expect(cited.getByRole('checkbox', { name: first })).toBeChecked();
	await expect(cited.getByRole('checkbox', { name: second })).not.toBeChecked();
	await cited.getByRole('checkbox', { name: second }).check();
	await expect(cited.getByRole('checkbox', { name: second })).toBeChecked();

	// ログインしていなければログインへ
	await page.goto(`/houan/kaku?kaiketsu=${ids[0]}`);
	await expect(page.getByRole('button', { name: 'Googleでログイン' }).or(page.getByRole('link', { name: 'Googleでログイン' }))).toBeVisible();

	// 解決策がなければ、解決策から書き始めることを案内する
	await a.goto('/houan/kaku');
	await expect(a.getByText('法案は、課題の解決策から書き始めます')).toBeVisible();
	await expect(a.getByRole('link', { name: '課題の一覧へ' })).toHaveAttribute('href', '/kadai');
	await expect(a.getByRole('button', { name: '下書きを保存する' })).toHaveCount(0);
});

test('基準2：登録から7日たっていないアカウントには、いつから書けるかを出し、送っても保存しない', async ({ browser }, info) => {
	const p = info.project.name;
	const s = stamp();
	const a = await user(browser, `h2-a-${p}-${s}`, ip(p, 2, 1));
	const { ids } = await solutions(a, `h2-${p}-${s}`, [`7日の解決策 ${p}-${s}`]);
	const fresh = await user(browser, `h2-new-${p}-${s}`, ip(p, 2, 2), { days: 6 });

	await fresh.goto(`/houan/kaku?kaiketsu=${ids[0]}`);
	await expect(fresh.getByText(/登録から7日たつと、法案を書けます。\d+月\d+日 \d+時\d{2}分から書けます。/)).toBeVisible();
	await expect(fresh.getByRole('button', { name: '下書きを保存する' })).toHaveCount(0);

	const res = await billRequest(fresh, '/houan/kaku', amendForm(await currentBase(fresh), ids[0], `7日たたない ${p}-${s}`));
	expect(res.status()).toBe(403);
	expect(await res.text()).toContain('登録から7日たつと、法案を書けます');
});

test('基準3：改正の下書きを保存すると、法案のページに札・正式名・状態・概要・元になった解決策・提出者が出る', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const s = stamp();
	const name = `h3-a-${w}-${s}`;
	const a = await user(browser, name, ip(w, 3, 1));
	const body = `解約はネットでいつでもできるようにする ${w}-${s}`;
	const { issueId, ids } = await solutions(a, `h3-${w}-${s}`, [body]);
	const title = `解約をいつでもできるようにする ${w}-${s}`;

	await a.goto(`/houan/kaku?kaiketsu=${ids[0]}`);
	await hydrated(a);
	await fillCommon(a, title);
	await a.getByLabel('変える条').selectOption({ label: '第1条（目的）' });
	// 条を選ぶと、いま施行されている版の見出しと条文が入る
	await expect(a.getByLabel('見出し')).toHaveValue('（目的）');
	await expect(a.getByLabel('変更後の条文')).toHaveValue(new RegExp(ARTICLE1));
	await a.getByLabel('変更後の条文').fill('この法律は、消費者がいつでも契約をやめられるようにすることを目的とする。');
	await a.getByLabel('3行要約').fill('解約をいつでもできるようにします。\n罰則はつけません。');
	await a.getByLabel('附則').fill('この法律は、公布の日から起算して一年を経過した日から施行する。');
	await a.getByRole('button', { name: '下書きを保存する' }).click();

	await expect(a.getByRole('heading', { level: 1, name: title })).toBeVisible();
	await expect(a).toHaveURL(/\/houan\/\d+$/);
	await expect(a.getByText('改正', { exact: true })).toBeVisible();
	await expect(a.getByText('消費者契約法の一部を改正する法律案', { exact: true })).toBeVisible();
	await expect(status(a, w, '下書き')).toBeVisible();
	if (w === 'pc') await expect(a.getByRole('heading', { name: 'いまの段階' })).toBeVisible();
	await expect(a.getByRole('heading', { name: '3行でいうと' })).toBeVisible();
	await expect(a.getByRole('listitem').filter({ hasText: '罰則はつけません。' })).toBeVisible();
	await expect(a.getByText('定期購入の解約ができずに困っている人')).toBeVisible();
	await expect(a.getByText('事業者の解約窓口の負担が増える')).toBeVisible();
	const cited = a.locator('section').filter({ has: a.getByRole('heading', { name: '元になった解決策' }) });
	await expect(cited.getByText(body)).toBeVisible();
	await expect(cited.getByRole('link', { name: `法案の元の課題 h3-${w}-${s}` })).toHaveAttribute('href', `/kadai/${issueId}`);
	await expect(a.getByText(`提出者 ${name}`)).toBeVisible();
});

test('基準4：書きかえ・新しく追加・削除の条を並べて保存し、変更点のタブで条ごとに取り消し線と「−」、下線と「＋」で出す', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const s = stamp();
	const a = await user(browser, `h4-a-${w}-${s}`, ip(w, 4, 1));
	const { ids } = await solutions(a, `h4-${w}-${s}`, [`変更点の解決策 ${w}-${s}`]);
	const title = `3つの条を変える ${w}-${s}`;

	await a.goto(`/houan/kaku?kaiketsu=${ids[0]}`);
	await hydrated(a);
	await fillCommon(a, title);
	const row = (n: number) => a.getByRole('group', { name: `変更 ${n}` });
	await row(1).getByLabel('変える条').selectOption({ label: '第1条（目的）' });
	await expect(row(1).getByLabel('変更後の条文')).toHaveValue(new RegExp(ARTICLE1));
	const text1 = await row(1).getByLabel('変更後の条文').inputValue();
	await row(1).getByLabel('変更後の条文').fill(text1.replace('格差に鑑み', '格差と解約の難しさに鑑み'));

	await a.getByRole('button', { name: '変える条を足す' }).click();
	await row(2).getByLabel('変え方').selectOption({ label: '新しく追加' });
	await row(2).getByLabel('足す条の番号').fill('第1条の2');
	await row(2).getByLabel('見出し').fill('（解約の申出）');
	await row(2).getByLabel('変更後の条文').fill('消費者は、いつでも契約の解約を申し出ることができる。');

	await a.getByRole('button', { name: '変える条を足す' }).click();
	await row(3).getByLabel('変え方').selectOption({ label: '削除' });
	await row(3).getByLabel('変える条').selectOption({ label: '第2条（定義）' });
	await expect(row(3).getByLabel('変更後の条文')).toHaveCount(0);

	await a.getByLabel('附則').fill('この法律は、公布の日から施行する。');
	await a.getByRole('button', { name: '下書きを保存する' }).click();
	await expect(a.getByRole('heading', { level: 1, name: title })).toBeVisible();

	await a.getByRole('link', { name: '変更点 4' }).click();
	await expect(a).toHaveURL(/\/houan\/\d+\/henkou$/);
	const change = (heading: string) => a.locator('article').filter({ has: a.getByRole('heading', { name: heading }) });
	const amended = change('1. 第1条 ・ 書きかえ');
	await expect(amended.locator('del').filter({ hasText: '−' }).first()).toHaveCSS('text-decoration-line', /line-through/);
	await expect(amended.locator('ins').filter({ hasText: '＋と解約の難しさ' })).toHaveCSS('text-decoration-line', /underline/);
	const added = change('2. 第1条の2 ・ 新しく追加');
	await expect(added.locator('ins').filter({ hasText: '消費者は、いつでも契約の解約を申し出ることができる。' })).toBeVisible();
	await expect(added.getByText('（なし）')).toBeVisible();
	const deleted = change('3. 第2条 ・ 削除');
	await expect(deleted.locator('del').filter({ hasText: '「消費者」とは' })).toBeVisible();
	await expect(deleted.getByText('削除', { exact: true })).toBeVisible();
	await expect(change('附則 ・ 新しく追加').locator('ins').filter({ hasText: '公布の日から施行する' })).toBeVisible();

	// スマホは「いま」と「変更後」を縦に、PC は「場所・変更後・いま」の表
	const side = (name: string) => amended.locator('section').filter({ has: a.getByRole('heading', { name, exact: true }) });
	const now = (await side('いま').boundingBox())!;
	const after = (await side('変更後').boundingBox())!;
	const head = a.getByText('場所', { exact: true });
	if (w === 'pc') {
		await expect(head).toBeVisible();
		expect(now.x).toBeGreaterThan(after.x);
		expect(Math.abs(now.y - after.y)).toBeLessThan(4);
	} else {
		await expect(head).toBeHidden();
		expect(after.y).toBeGreaterThan(now.y);
	}
});

test('基準5：廃止の下書きは条を選ばずに保存でき、正式名と、法令をまるごと廃止することを出す', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const s = stamp();
	const a = await user(browser, `h5-a-${w}-${s}`, ip(w, 5, 1));
	const { ids } = await solutions(a, `h5-${w}-${s}`, [`廃止の解決策 ${w}-${s}`]);
	const title = `消費者契約法をやめる ${w}-${s}`;

	await a.goto(`/houan/kaku?kaiketsu=${ids[0]}`);
	await hydrated(a);
	await a.getByRole('radio', { name: '廃止' }).check();
	await expect(a.getByLabel('変える条')).toHaveCount(0);
	await a.getByLabel('題名').fill(title);
	await a.getByLabel('対象の法令').selectOption({ label: LAW_TITLE });
	await a.getByLabel('誰が困っているか').fill('二重の規制に困っている事業者');
	await a.getByLabel('副作用').fill('消費者の守りが弱くなる');
	await a.getByRole('button', { name: '下書きを保存する' }).click();

	await expect(a.getByRole('heading', { level: 1, name: title })).toBeVisible();
	await expect(a.getByText('廃止', { exact: true })).toBeVisible();
	await expect(a.getByText('消費者契約法を廃止する法律案', { exact: true })).toBeVisible();
	await a.getByRole('link', { name: /^変更点/ }).click();
	await expect(a.getByText('消費者契約法をまるごと廃止します。')).toBeVisible();
});

test('基準6：提出者だけが直せる。先に保存された画面と、新しい版が施行されたあとの画面からは保存せず、入力を残す', async ({ browser, page }, info) => {
	const p = info.project.name;
	const s = stamp();
	const a = await user(browser, `h6-a-${p}-${s}`, ip(p, 6, 1));
	const { ids } = await solutions(a, `h6-${p}-${s}`, [`直す解決策 ${p}-${s}`]);
	const title = `直す法案 ${p}-${s}`;
	const bill = billPath(await billRequest(a, '/houan/kaku', amendForm(await currentBase(a), ids[0], title)));

	await a.goto(bill);
	await a.getByRole('link', { name: '編集する' }).click();
	await expect(a).toHaveURL(`${bill}/kaku`);
	await hydrated(a);
	await expect(a.getByLabel('題名')).toHaveValue(title);
	await expect(a.getByLabel('変更後の条文')).toHaveValue(/いつでも契約をやめられる/);
	await a.getByLabel('題名').fill(`${title} 直した`);
	await a.getByRole('button', { name: '下書きを保存する' }).click();
	await expect(a.getByRole('heading', { level: 1, name: `${title} 直した` })).toBeVisible();

	// ほかの人とログインしていない人には「編集する」が出ず、編集の画面でも書けない
	const b = await user(browser, `h6-b-${p}-${s}`, ip(p, 6, 2));
	await b.goto(bill);
	await expect(b.getByRole('heading', { level: 1, name: `${title} 直した` })).toBeVisible();
	await expect(b.getByRole('link', { name: '編集する' })).toHaveCount(0);
	expect((await b.request.get(`${bill}/kaku`)).status()).toBe(403);
	const forged = await billRequest(b, `${bill}/kaku`, { ...amendForm(await currentBase(b), ids[0], '乗っ取り'), rev: '2' });
	expect(forged.status()).toBe(403);
	await page.goto(bill);
	await expect(page.getByRole('link', { name: '編集する' })).toHaveCount(0);
	await page.goto(`${bill}/kaku`);
	await expect(page.getByRole('button', { name: 'Googleでログイン' }).or(page.getByRole('link', { name: 'Googleでログイン' }))).toBeVisible();

	// 別の画面で先に保存されていたら、保存せずに開き直すよう案内する
	const other = await a.context().newPage();
	await other.goto(`${bill}/kaku`);
	await hydrated(other);
	await a.goto(`${bill}/kaku`);
	await hydrated(a);
	await a.getByLabel('題名').fill(`${title} 先に保存`);
	await a.getByRole('button', { name: '下書きを保存する' }).click();
	await expect(a.getByRole('heading', { level: 1, name: `${title} 先に保存` })).toBeVisible();
	await other.getByLabel('題名').fill(`${title} 後から保存`);
	await other.getByRole('button', { name: '下書きを保存する' }).click();
	await expect(other.getByRole('alert')).toContainText('別の画面で先に保存されました。開き直してください。');
	await expect(other.getByLabel('題名')).toHaveValue(`${title} 後から保存`);

	// 開いたあとで新しい版が施行された（開いたときの版を1つ前の版に差し替えて確かめる）
	await other.goto(`${bill}/kaku`);
	await hydrated(other);
	const base = other.locator('input[name="base"]');
	const current = await base.inputValue();
	const older = (await other.request.get(`/hourei/${LAW}/hikaku`).then((r) => r.text())).match(new RegExp(`value="(${LAW}_\\d{8}_\\w+)"`, 'g'))!
		.map((m) => m.slice(7, -1))
		.find((id) => id < current)!;
	expect(older).toBeTruthy();
	await base.evaluate((el, v) => ((el as HTMLInputElement).value = v), older);
	await other.getByLabel('題名').fill(`${title} 古い版`);
	await other.getByRole('button', { name: '下書きを保存する' }).click();
	await expect(other.getByRole('alert')).toContainText('条文が新しくなりました。開き直してください。');
	await expect(other.getByLabel('題名')).toHaveValue(`${title} 古い版`);
	await other.goto(bill);
	await expect(other.getByRole('heading', { level: 1, name: `${title} 先に保存` })).toBeVisible();
});

test('基準7：誤りは欄のそばに出し、入力を残す。変更後の条文の形の誤りは何行目かを出す', async ({ browser }, info) => {
	const p = info.project.name;
	const s = stamp();
	const a = await user(browser, `h7-a-${p}-${s}`, ip(p, 7, 1));
	const { ids } = await solutions(a, `h7-${p}-${s}`, [`誤りの解決策 ${p}-${s}`]);
	const title = `誤りのある法案 ${p}-${s}`;

	await a.goto(`/houan/kaku?kaiketsu=${ids[0]}`);
	await hydrated(a);
	await fillCommon(a, title);
	await a.getByLabel('変える条').selectOption({ label: '第1条（目的）' });
	await expect(a.getByLabel('変更後の条文')).toHaveValue(new RegExp(ARTICLE1));
	await a.getByLabel('変更後の条文').fill('第1項の本文\n3　2を飛ばした項');
	// 字数はブラウザでも止めるので、サーバーの確かめを見るために外す
	await a.getByLabel('副作用').evaluate((el) => el.removeAttribute('maxlength'));
	await a.getByLabel('副作用').fill('あ'.repeat(401));
	await a.getByRole('group', { name: '元になった解決策' }).getByRole('checkbox').uncheck();
	await a.getByRole('button', { name: '下書きを保存する' }).click();

	await expect(a.getByText('2行目：項の番号が順になっていません（2、3、4…と続けてください）。')).toBeVisible();
	await expect(a.getByLabel('変更後の条文')).toHaveAttribute('aria-invalid', 'true');
	await expect(a.getByText('長すぎます。字数を減らしてください。')).toBeVisible();
	await expect(a.getByLabel('副作用')).toHaveAttribute('aria-invalid', 'true');
	await expect(a.getByText('元になった解決策を1〜5つ選んでください。')).toBeVisible();
	await expect(a.getByLabel('題名')).toHaveValue(title);
	await expect(a.getByLabel('変更後の条文')).toHaveValue('第1項の本文\n3　2を飛ばした項');

	// 変える条のない改正
	await a.getByRole('group', { name: '元になった解決策' }).getByRole('checkbox').check();
	await a.getByLabel('副作用').fill('事業者の負担が増える');
	await a.getByRole('button', { name: 'この変更を外す' }).click();
	await a.getByRole('button', { name: '下書きを保存する' }).click();
	await expect(a.getByText('変える条を1つ以上選んでください。')).toBeVisible();
	await expect(a.getByLabel('題名')).toHaveValue(title);
});

test('基準8：国・締め出し・Turnstile を確かめ、作るのは24時間に3件、保存は60回、1回線20件まで。超えたら違反に数える', async ({ browser }, info) => {
	test.setTimeout(180_000);
	const p = info.project.name;
	const s = stamp();
	// 数えがほかのテストと混ざらないよう、この幅だけの時刻で書く
	const now = p === 'sp' ? '2031-03-10T09:00:00+09:00' : '2031-04-10T09:00:00+09:00';
	const a = await user(browser, `h8-a-${p}-${s}`, ip(p, 8, 1), { now });
	const { ids } = await solutions(a, `h8-${p}-${s}`, [`上限の解決策 ${p}-${s}`]);
	const base = await currentBase(a);
	const form = (n: string | number, extra: Form = {}) => amendForm(base, ids[0], `上限 ${n} ${p}-${s}`, extra);

	// 日本からだけ、Turnstile を通ったものだけ
	const us = await user(browser, `h8-us-${p}-${s}`, ip(p, 8, 2), { country: 'US', now });
	const outside = await billRequest(us, '/houan/kaku', form('us'));
	expect(outside.status()).toBe(403);
	expect(await outside.text()).toContain('日本国内からのみ参加できます');
	const badToken = await billRequest(a, '/houan/kaku', form('token', { 'cf-turnstile-response': 'bad' }));
	expect(badToken.status()).toBe(400);
	expect(await badToken.text()).toContain('確認できませんでした');

	// 作るのは24時間に3件
	const bill = billPath(await billRequest(a, '/houan/kaku', form(0)));
	for (let i = 1; i < 3; i++) billPath(await billRequest(a, '/houan/kaku', form(i)));
	const over = await billRequest(a, '/houan/kaku', form(3));
	expect(over.status()).toBe(429);
	expect(await over.text()).toContain('法案の下書きは24時間に3件まで作れます');

	// 保存は24時間に60回
	// 版の番号は作ったときが1で、保存のたびに1つずつ増える（ほかに保存する画面はない）
	for (let i = 0; i < 60; i++) {
		const res = await billRequest(a, `${bill}/kaku`, { ...form(`保存 ${i}`), rev: String(i + 1) });
		expect(res.status(), String(i)).toBe(303);
	}
	const saveOver = await billRequest(a, `${bill}/kaku`, { ...form('保存 60'), rev: '61' });
	expect(saveOver.status()).toBe(429);
	expect(await saveOver.text()).toContain('法案の下書きの保存は24時間に60回までです');

	// 3回目の違反で締め出す
	expect((await billRequest(a, '/houan/kaku', form(4))).status()).toBe(429);
	const banned = await billRequest(a, '/houan/kaku', form(5));
	expect(banned.status()).toBe(429);
	expect(await banned.text()).toContain('制限を何度も超えたため');

	// 1回線24時間に20件（同じ回線の別の人が合わせて20件作ったあと）
	const shared = ip(p, 8, 3);
	for (let n = 0; n < 7; n++) {
		const u = await user(browser, `h8-ip${n}-${p}-${s}`, shared, { now });
		for (let i = 0; i < 3; i++) {
			const res = await billRequest(u, '/houan/kaku', form(`回線 ${n}-${i}`));
			if (n * 3 + i < 20) {
				billPath(res);
				continue;
			}
			expect(res.status()).toBe(429);
			expect(await res.text()).toContain('この回線から作れる法案の下書きの数を超えました');
		}
	}
});

test('基準9：引用した解決策があとで非表示になったら、本文の代わりに「この解決策は非表示になっています」と出す', async ({ browser, page }, info) => {
	const p = info.project.name;
	const s = stamp();
	const a = await user(browser, `h9-a-${p}-${s}`, ip(p, 9, 1));
	const body = `あとで非表示になる解決策 ${p}-${s}`;
	const { ids } = await solutions(a, `h9-${p}-${s}`, [body]);
	const title = `非表示を引用した法案 ${p}-${s}`;
	const bill = billPath(await billRequest(a, '/houan/kaku', amendForm(await currentBase(a), ids[0], title)));

	const mod = await user(browser, `h9-mod-${p}-${s}`, ip(p, 9, 2), { role: 'moderator' });
	const hide = await solutionStaffRequest(mod, 'hideSolution', { solution: ids[0], reason: 'spam', note: '法案の引用' });
	expect(hide.status()).toBeLessThan(400);

	await page.goto(bill);
	await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
	await expect(page.getByText('この解決策は非表示になっています')).toBeVisible();
	await expect(page.getByText(body)).toHaveCount(0);
});

test('信頼の境界：作り変えたフォームの値は 400 で、保存しない', async ({ browser }, info) => {
	const p = info.project.name;
	const s = stamp();
	const a = await user(browser, `hb1-a-${p}-${s}`, ip(p, 10, 1));
	const { ids } = await solutions(a, `hb1-${p}-${s}`, [`境界の解決策 ${p}-${s}`, `隠す解決策 ${p}-${s}`]);
	const mod = await user(browser, `hb1-mod-${p}-${s}`, ip(p, 10, 2), { role: 'moderator' });
	expect((await solutionStaffRequest(mod, 'hideSolution', { solution: ids[1], reason: 'spam', note: '境界' })).status()).toBeLessThan(400);
	const base = await currentBase(a);
	const form = (extra: Form) => amendForm(base, ids[0], `作り変え ${p}-${s}`, extra);
	const rows = Object.fromEntries(
		Array.from({ length: 51 }, (_, i) => [
			[`op.${i}`, 'add'],
			[`num.${i}`, `第1条の${i + 2}`],
			[`body.${i}`, '足す条']
		]).flat()
	);

	const cases: [string, Form][] = [
		['ない条', form({ 'target.0': '999' })],
		['ほかの法令の条', form({ 'target.0': '67' })],
		['条の形でない値', form({ 'target.0': '1 OR 1=1' })],
		['委員会の対象でない法令', form({ law: '129AC0000000089' })],
		['ない法令', form({ law: 'nope' })],
		['ほかの法令の版', form({ base: '337AC0000000134_20160401_426AC0000000069' })],
		['非表示の解決策', form({ solution: ids[1] })],
		['数字でない解決策', form({ solution: 'abc' })],
		['種類「制定」', form({ kind: 'enact' })],
		['ない種類', form({ kind: 'bogus' })],
		['ない変え方', form({ 'op.0': 'rename' })],
		['廃止に変える条', form({ kind: 'repeal' })],
		['51条', { ...form({}), 'op.0': 'add', 'num.0': '第1条の2', 'target.0': '', ...rows }]
	];
	for (const [label, f] of cases) {
		const res = await billRequest(a, '/houan/kaku', f);
		expect(res.status(), label).toBe(400);
	}
	// どれも保存していない（作れる3件の上限に1件も数えていない）
	for (let i = 0; i < 3; i++) billPath(await billRequest(a, '/houan/kaku', form({ title: `通る ${i} ${p}-${s}` })));
});

test('信頼の境界：?kaiketsu= の形が違う・ないときは、解決策から書き始めることを案内する', async ({ browser }, info) => {
	const p = info.project.name;
	const s = stamp();
	const a = await user(browser, `hb2-a-${p}-${s}`, ip(p, 11, 1));
	for (const q of ['abc', '0', '01', '-1', '1e3', '9999999999', '99999999', '1&kaiketsu=2']) {
		const res = await a.request.get(`/houan/kaku?kaiketsu=${q}`);
		expect(res.status(), q).toBe(200);
		expect(await res.text(), q).toContain('法案は、課題の解決策から書き始めます');
	}
});

test('信頼の境界：法案のページのパスの番号が違う・ないときは 404', async ({ request }) => {
	for (const id of ['abc', '0', '01', '-1', '1.5', '9999999999', '99999999']) {
		for (const path of [`/houan/${id}`, `/houan/${id}/henkou`, `/houan/${id}/kaku`]) {
			expect((await request.get(path, { maxRedirects: 0 })).status(), path).toBe(404);
		}
	}
});
