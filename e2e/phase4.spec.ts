// フェーズ4 審議と採決の締めのテスト（Issue #63）。
// 通ったらフェーズ4完了として v0.4 を出す。それまでは test:phase でだけ回す。
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { ORIGIN, billSupportRequest, createAmendBill, issueWithSolutions, loginAs, proposeRequest, stubTurnstile, supportRequest } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});

type Width = 'sp' | 'pc';

// テスト全体の時間は長くする（test.setTimeout）ので、ボタンが見つからないときに全体の時間まで待たないよう、操作ごとの時間を決める
test.use({ actionTimeout: 15_000 });

/**
 * 幅ごとに別の月を使う。playwright.phase.config.ts は workers: 1 で、その月に審議中の法案はこの1本だけになる（割り当てが 0 / 1 になる）。
 * IF世界の条文は2つの幅で共有するので、本文は幅ごとに変える。sp が先に走り、pc は sp の可決のあとの IF世界を基にする
 */
const MONTH = {
	sp: { prev: '2035-04', now: '2035-05', next: '2035-06', nextNumber: 6 },
	pc: { prev: '2035-08', now: '2035-09', next: '2035-10', nextNumber: 10 }
} as const;
const at = (month: string, day: number) => `${month}-${String(day).padStart(2, '0')}T09:00:00+09:00`;

const LAW = '412AC0000000061';
/** 現実の第1条にあって、書きかえたあとの本文にはない言葉 */
const REAL_TEXT = '情報の質及び量並びに交渉力の格差';

type User = { page: Page; setNow: (now: string) => Promise<void> };

/** サーバーの「いま」を x-test-now で決めた利用者。name がなければログインしない */
async function user(browser: Browser, ip: string, now: string, name?: string): Promise<User> {
	const headers = { 'x-test-ip': ip };
	const context = await browser.newContext({ baseURL: ORIGIN, extraHTTPHeaders: { ...headers, 'x-test-now': now } });
	contexts.push(context);
	const page = await context.newPage();
	await stubTurnstile(page);
	if (name) await loginAs(page, name, 8);
	return { page, setNow: (t) => context.setExtraHTTPHeaders({ ...headers, 'x-test-now': t }) };
}

const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
const either = (page: Page, name: string | RegExp) => page.getByRole('link', { name }).or(page.getByRole('button', { name }));
const robots = (page: Page) => page.locator('meta[name="robots"]');

/** 法案の状態。スマホは「いま：」の1行、PC は段階の並びの「（いまここ）」 */
const status = (page: Page, w: Width, name: string) => (w === 'sp' ? page.getByText(`いま：${name}`, { exact: true }) : page.getByText(`${name}（いまここ）`, { exact: true }));

/** IF世界の帯（紫の斜線）。テストの目印として data-if-band を付ける（Issue #63 テストの作り方） */
const band = (page: Page) => page.locator('[data-if-band]');

/**
 * 操作をして、書き込みの応答が返るまで待つ（次の移動で送信が中断されないように）。
 * use:enhance の送信は fail() でも HTTP 200 で返るので、本文の type も確かめる
 */
async function posted(u: Page, act: () => Promise<void>) {
	const [res] = await Promise.all([u.waitForResponse((r) => r.request().method() === 'POST'), act()]);
	expect(res.status()).toBeLessThan(400);
	if (res.status() < 300) expect(await res.text()).not.toContain('"type":"failure"');
}

const submit = (u: Page, button: string) => posted(u, () => u.getByRole('button', { name: button }).click());

/** 開いている投票の画面で票を選んで送る */
async function choose(u: Page, choice: '賛成' | '反対' | RegExp) {
	await u.getByRole('radio', { name: choice }).check();
	await submit(u, '投票する');
}

/** 投票の画面を開く */
async function openVote(u: Page, path: string) {
	await u.goto(path);
	await hydrated(u);
}

/** 投票する。票は締切まで変えられるので、同じ手順で入れ直す */
async function vote(u: Page, path: string, choice: '賛成' | '反対') {
	await openVote(u, path);
	await choose(u, choice);
}

test('法案に質疑し、修正案を取り込み、採決で可決されると、IF世界の条文が変わる', async ({ browser }, info) => {
	test.setTimeout(240_000);
	const w = info.project.name as Width;
	const { prev, now, next, nextNumber } = MONTH[w];
	const suffix = `${w}-${Date.now() % 1e8}`;
	const ip = (n: number) => `10.${w === 'sp' ? 60 : 61}.0.${n}`;
	const name = (who: string) => `${who}4-${suffix}`;
	const title = `可決する法案 ${suffix}`;
	const amendedMark = `修正案の本文 ${suffix}`;
	const amended = `この法律は、${amendedMark}により消費者の利益を守ることを目的とする。`;

	// 1. 前の月：A・B・C・D と投票者 E〜N が課題に「わかる」を付ける。Z は何もしない
	const a = await user(browser, ip(1), at(prev, 10), name('A'));
	const { issueId, ids } = await issueWithSolutions(a.page, `4-${suffix}`, [`解約をいつでもできるようにする ${suffix}`]);
	expect((await supportRequest(a.page, issueId, 'add')).status()).toBeLessThan(400);
	const members = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N'];
	const people: Record<string, User> = {};
	for (const [i, who] of members.entries()) {
		people[who] = await user(browser, ip(i + 2), at(prev, 10), name(who));
		expect((await supportRequest(people[who].page, issueId, 'add')).status(), who).toBeLessThan(400);
	}
	const z = await user(browser, ip(30), at(prev, 10), name('Z'));
	const viewer = await user(browser, ip(31), at(now, 5));
	const v = viewer.page;

	// 2. 5日：A が法案を書き、B・C・D の賛同で発議する（画面の手順は e2e/phase3.spec.ts で確かめる）
	await a.setNow(at(now, 5));
	const bill = await createAmendBill(a.page, title, ids[0]);
	const billId = bill.replace('/houan/', '');
	for (const who of ['B', 'C', 'D']) {
		await people[who].setNow(at(now, 5));
		const res = await billSupportRequest(people[who].page, bill, { op: 'add', rev: '1' });
		expect(res.status(), await res.text()).toBe(200);
	}
	const proposed = await proposeRequest(a.page, bill);
	expect(proposed.status(), await proposed.text()).toBe(200);

	// 3. 15日：質疑と修正
	for (const u of [a, ...Object.values(people)]) await u.setNow(at(now, 15));
	const { E: e, F: f, G: g } = people;
	const openTab = async (u: Page, tab: RegExp) => {
		await u.goto(bill);
		await hydrated(u);
		await u.getByRole('navigation', { name: '法案のページ' }).getByRole('link', { name: tab }).click();
	};
	const stance = (u: Page, label: string) => u.getByRole('button', { name: label, exact: true });

	// 自分の考えは、自分にだけ見える
	await openTab(e.page, /^質疑/);
	await posted(e.page, () => stance(e.page, '賛成寄り').click());
	await openTab(e.page, /^質疑/);
	await expect(stance(e.page, '賛成寄り')).toHaveAttribute('aria-pressed', 'true');
	await openTab(f.page, /^質疑/);
	await expect(stance(f.page, '賛成寄り')).toHaveAttribute('aria-pressed', 'false');
	await posted(f.page, () => stance(f.page, '反対寄り').click());
	await openTab(f.page, /^質疑/);
	await expect(stance(f.page, '反対寄り')).toHaveAttribute('aria-pressed', 'true');

	// E が質疑を書くと「答弁待ち」、A が答弁すると消える
	const question = `解約の窓口は誰が用意しますか ${suffix}`;
	const answer = `事業者が自分のサイトに用意します ${suffix}`;
	await either(e.page, '質疑を書く').first().click();
	await e.page.getByLabel('質疑の内容').fill(question);
	await submit(e.page, '送る');
	const card = (u: Page) => u.locator('article').filter({ hasText: question });
	await expect(card(e.page).getByText('答弁待ち')).toBeVisible();

	await openTab(a.page, /^質疑/);
	// E と F の考えは、ほかの人の画面に出ない
	await expect(card(a.page)).not.toContainText(/賛成寄り|反対寄り/);
	await card(a.page).getByRole('button', { name: '答弁する' }).click();
	await a.page.getByLabel('答弁の内容').fill(answer);
	await submit(a.page, '送る');
	await expect(card(a.page).getByText('答弁待ち')).toHaveCount(0);

	// F が A の答弁に「筋が通っている」を付ける。答弁のあるカードのボタンは答弁の評価（Issue #63 テストの作り方）。
	// 答弁はスマホでは開くと読める（SpBillQA）。PC は最初から開いている（PcBillQA）
	await openTab(f.page, /^質疑/);
	if (w === 'sp') await card(f.page).getByRole('button', { name: /答弁を読む/ }).click();
	await expect(card(f.page).getByText(answer)).toBeVisible();
	const reasonable = () => card(f.page).getByRole('button', { name: '筋が通っている' });
	await reasonable().click();
	await expect(reasonable()).toHaveAttribute('aria-pressed', 'true');
	await openTab(f.page, /^質疑/);
	await expect(reasonable()).toHaveAttribute('aria-pressed', 'true');

	// G の修正案を A が取り込むと、変更点の「変更後」が修正案の本文になる
	await openTab(g.page, /^修正案/);
	await either(g.page, '修正案を出す').first().click();
	await g.page.getByLabel('変える条').selectOption({ label: '第1条（目的）' });
	await g.page.getByLabel('変更後の条文').fill(amended);
	await submit(g.page, '修正案を出す');
	await openTab(a.page, /^修正案/);
	await submit(a.page, '取り込む');
	await viewer.setNow(at(now, 15));
	await v.goto(`${bill}/henkou`);
	// 「変更後」の欄が修正案の本文になり、取り込む前の本文（createAmendBill）は消える。
	// 基にした本文と同じ部分は下線の外に出るので（pc は sp の可決のあとの IF世界が基）、欄の文字で比べる
	const after = v.getByRole('main').locator('section').filter({ hasText: '変更後' });
	expect((await after.innerText()).replace(/＋/g, '')).toContain(amended);
	await expect(v.getByRole('main')).not.toContainText('いつでも契約をやめられる');

	// 4. 22日：採決
	const voters = ['E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N'];
	for (const who of voters) await people[who].setNow(at(now, 22));
	const voteAt = `/saiketsu/${billId}`;

	await e.page.goto('/saiketsu');
	await expect(e.page.getByText(/割り当て法案\s*0\s*\/\s*1/)).toBeVisible();
	await expect(e.page.getByText(new RegExp(`締切 ${nextNumber}月1日.*0時`))).toBeVisible();
	await e.page.getByRole('link', { name: title }).click();
	await expect(e.page).toHaveURL(new RegExp(`${voteAt}$`));
	await hydrated(e.page);
	await expect(e.page.getByText('票の数は締切まで誰にも見えません')).toBeVisible();
	await expect(e.page.getByRole('main')).toContainText(/変更点 1か所/);
	// 票を選ぶまで、投票のボタンは押せない
	await expect(e.page.getByRole('button', { name: '票を選んでください' })).toBeDisabled();

	// 賛成7（E・G〜L）、反対2（F・M）、棄権1（N）。E は反対に変えてから賛成に戻す。数えるのは最後の票
	await vote(e.page, voteAt, '賛成');
	await e.page.goto('/saiketsu');
	await expect(e.page.getByText(/1\s*\/\s*1\s*投票済み/)).toBeVisible();
	await vote(e.page, voteAt, '反対');
	await openVote(e.page, voteAt);
	await expect(e.page.getByRole('radio', { name: '反対' })).toBeChecked();
	await choose(e.page, '賛成');
	await openVote(e.page, voteAt);
	await expect(e.page.getByRole('radio', { name: '賛成' })).toBeChecked();
	for (const who of ['G', 'H', 'I', 'J', 'K', 'L']) await vote(people[who].page, voteAt, '賛成');
	for (const who of ['F', 'M']) await vote(people[who].page, voteAt, '反対');

	// 棄権は変更点の一覧を開いてから（スマホは SpVote のとおり閉じていて、PC は PcVote のとおり最初から開いている）
	const n = people.N.page;
	await openVote(n, voteAt);
	const abstain = n.getByRole('radio', { name: /^棄権/ });
	if (w === 'sp') {
		await expect(abstain).toBeDisabled();
		await n.getByRole('button', { name: /^変更点 1か所を見る/ }).click();
	}
	await expect(n.locator('ins').first()).toBeVisible();
	await expect(abstain).toBeEnabled();
	await choose(n, /^棄権/);

	// Z は前の月に何もしていないので、参考の票になる
	await z.setNow(at(now, 22));
	await vote(z.page, voteAt, '賛成');
	await expect(z.page.getByText('参考の票として数えます')).toBeVisible();

	// A・B・C・D には割り当てられない（自分が提出・賛同した法案）
	await a.setNow(at(now, 22));
	for (const who of ['B', 'C', 'D']) await people[who].setNow(at(now, 22));
	for (const u of [a, people.B, people.C, people.D]) {
		await u.page.goto('/saiketsu');
		await expect(u.page.getByText(/割り当て法案\s*0\s*\/\s*0/)).toBeVisible();
		await expect(u.page.getByRole('main').getByRole('link', { name: title })).toHaveCount(0);
	}

	// 締切の前は、結果のページに票の数が出ない
	await viewer.setNow(at(now, 25));
	const kekka = `${voteAt}/kekka`;
	await v.goto(kekka);
	await expect(v.getByRole('heading', { level: 1, name: title })).toBeVisible();
	await expect(v.getByRole('main')).not.toContainText(/数えた票|(賛成|反対|棄権)\s*\d/);
	await expect(v.getByText('可決', { exact: true })).toHaveCount(0);

	// 5. 次の月の1日：その日に最初に読んだときに結果が確定する
	await viewer.setNow(at(next, 1));
	await v.goto(kekka);
	await hydrated(v);
	await expect(band(v)).toBeVisible();
	await expect(band(v)).toHaveCSS('background-image', /gradient/);
	await expect(v.getByText(w === 'sp' ? '架空の法律です' : 'このページの条文は架空のものです。現実の法律ではありません。')).toBeVisible();
	await expect(robots(v)).toHaveAttribute('content', /noindex/);
	await expect(v.getByText('可決', { exact: true })).toBeVisible();
	await expect(v.getByText('IF世界の法律になりました')).toBeVisible();
	await expect(v.getByText('ゲームの中の結果です。世論調査ではありません。')).toBeVisible();
	const main = v.getByRole('main');
	await expect(main).toContainText(/数えた票\s*10(?!\d)/);
	await expect(main).toContainText(/賛成\s*7(?!\d)/);
	await expect(main).toContainText(/反対\s*2(?!\d)/);
	await expect(main).toContainText(/棄権\s*1(?!\d)/);
	// 参考の票：スマホは開くと出る（SpResult）、PC は横に出ている（PcResult）
	if (w === 'sp') await v.getByRole('button', { name: /参考の票/ }).click();
	await expect(v.getByText(/参考の票（可否には使いません）/)).toBeVisible();
	await expect(v.getByText(/賛成 1 ・ 反対 0 ・ 棄権 0/)).toBeVisible();

	await v.goto(bill);
	await expect(status(v, w, '可決')).toBeVisible();
	await v.goto('/houan');
	await expect(v.getByRole('link', { name: title })).toHaveCount(0);
	await v.goto('/houan?tab=owari');
	await expect(v.getByRole('link', { name: title })).toHaveCount(1);

	// 6. IF世界の条文が変わる
	await v.goto(kekka);
	await hydrated(v);
	await v.getByRole('link', { name: 'IF世界の条文を見る' }).click();
	await expect(v).toHaveURL(new RegExp(`/if/hourei/${LAW}`));
	await expect(band(v)).toBeVisible();
	await expect(v.getByText('架空の法令').first()).toBeVisible();
	await expect(robots(v)).toHaveAttribute('content', /noindex/);
	await expect(v.getByRole('article', { name: '第1条', exact: true })).toContainText(amended);

	// 現実の法律は元のまま
	await v.goto(`/hourei/${LAW}`);
	const real = v.getByRole('article', { name: '第1条', exact: true });
	await expect(real).toContainText(REAL_TEXT);
	await expect(real).not.toContainText(amendedMark);
	await expect(band(v)).toHaveCount(0);
	await expect(v.getByText('架空の法令')).toHaveCount(0);

	// 可決した法案が、以後の法案の基になる
	await a.setNow(at(next, 3));
	await a.page.goto(`/houan/kaku?kaiketsu=${ids[0]}`);
	await hydrated(a.page);
	await a.page.getByRole('radio', { name: '改正' }).check();
	await a.page.getByLabel('対象の法令').selectOption({ label: '消費者契約法' });
	await a.page.getByLabel('変える条').selectOption({ label: '第1条（目的）' });
	await expect(a.page.getByLabel('変更後の条文')).toHaveValue(amended);
});
