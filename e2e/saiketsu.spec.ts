// Issue #70 採決の一覧と投票の画面。票の記録と上限の数えは src/lib/db/votes.test.ts
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { billRequest, billSupportRequest, createAmendBill, issueWithSolutions, newUser, postIssue, proposeRequest, type BillForm } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});
test.use({ actionTimeout: 15_000 });
// 発議までの準備が重く、並列で流すと30秒を超えることがある
test.beforeEach(() => test.setTimeout(180_000));

const stamp = () => Date.now() % 1e8;
const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
/** 基準ごと・幅ごとに別の年を使う（2117年までは関連法案のテストが使っている） */
const monthOf = (w: string, group: number) => `${2120 + group * 2 + (w === 'sp' ? 0 : 1)}-05`;
const prevOf = (month: string) => month.replace(/-05$/, '-04');
const at = (month: string, day: number) => `${month}-${String(day).padStart(2, '0')}T09:00:00+09:00`;

type User = { page: Page; setNow: (now: string) => Promise<void> };

async function user(browser: Browser, address: string, now: string, name: string, opts: { token?: string; country?: string } = {}): Promise<User> {
	const u = await newUser(browser, { name, ip: address, days: 8, ...opts });
	contexts.push(u.context);
	const setNow = (t: string) =>
		u.context.setExtraHTTPHeaders({ 'x-test-ip': address, 'x-test-now': t, ...(opts.country ? { 'x-test-country': opts.country } : {}) });
	await setNow(now);
	return { page: u.page, setNow };
}

/** ひとつの基準の準備：回線の番号を分け、法案を発議し、投票する人を作る */
function setup(browser: Browser, w: string, group: number) {
	const month = monthOf(w, group);
	const label = `v${group}-${w}-${stamp()}`;
	let seq = 0;
	const nextIp = () => `10.${w === 'sp' ? 70 : 71}.${group}.${++seq}`;
	const person = (now: string, opts: { token?: string; country?: string } = {}) => user(browser, nextIp(), now, `u${seq + 1}-${label}`, opts);

	let backers: User[] | undefined;
	/** 発議した法案。賛同する3人はどの法案でも同じ人（くじの候補から外れる） */
	async function bill(title: string, day = 5, extra: BillForm = {}) {
		const a = await person(at(month, day));
		const { ids } = await issueWithSolutions(a.page, `${title}`, [`解決策 ${title}`]);
		const path = await createAmendBill(a.page, title, ids[0], extra);
		backers ??= [await person(at(month, day)), await person(at(month, day)), await person(at(month, day))];
		for (const b of backers) {
			await b.setNow(at(month, day));
			const res = await billSupportRequest(b.page, path, { op: 'add', rev: '1' });
			expect(res.status(), await res.text()).toBe(200);
		}
		const res = await proposeRequest(a.page, path);
		expect(res.status(), await res.text()).toBe(200);
		return { a, path, id: path.replace('/houan/', ''), title };
	}
	/** 投票資格のある人：前の月に課題を書いている */
	async function voter(now = at(month, 22)) {
		const u = await person(at(prevOf(month), 10));
		await postIssue(u.page, { title: `前の月の課題 ${label} ${seq}` });
		await u.setNow(now);
		return u;
	}
	return { month, label, bill, voter, person, backers: () => backers as User[] };
}

const votePath = (id: string) => `/saiketsu/${id}`;
const openPage = async (u: Page, path: string) => {
	await u.goto(path);
	await hydrated(u);
};
const main = (u: Page) => u.getByRole('main');
const radio = (u: Page, name: string | RegExp) => u.getByRole('radio', { name });
const voteForm = (choice: string, token = 'test-pass') => ({ choice, 'cf-turnstile-response': token });
const post = (u: Page, id: string, form: Record<string, string>) => billRequest(u, `${votePath(id)}?/vote`, form);
async function choose(u: Page, choice: string | RegExp) {
	await radio(u, choice).check();
	const [res] = await Promise.all([u.waitForResponse((r) => r.request().method() === 'POST'), u.getByRole('button', { name: '投票する' }).click()]);
	expect(res.status()).toBe(200);
	expect(await res.text()).not.toContain('"type":"failure"');
}

test('基準1：採決の一覧に、会期と締切・進み具合・割り当ての法案・ほかの法案へのリンクが出て、割り当ては開き直しても変わらない。賛同した法案は入らず、候補がなければ 0 / 0', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 1);
	for (const n of [1, 2, 3, 4]) await s.bill(`一覧の法案${n} ${s.label}`);
	const v = await s.voter();

	await openPage(v.page, '/');
	await v.page.getByRole('link', { name: '採決を見る' }).click();
	await expect(v.page).toHaveURL(/\/saiketsu$/);
	await expect(v.page.getByText(/割り当て法案\s*0\s*\/\s*3\s*投票済み/)).toBeVisible();
	await expect(v.page.getByText(/5月の会期.*締切 6月1日.*0時/)).toBeVisible();
	await expect(v.page.locator('[data-vote-progress] li')).toHaveCount(3);
	await expect(v.page.locator('[data-assignment]')).toHaveCount(3);
	await expect(v.page.locator('[data-assignment]').first()).toContainText('まだ');
	const titles = await v.page.locator('[data-assignment] a').allInnerTexts();
	expect(titles).toHaveLength(3);
	await expect(v.page.getByRole('link', { name: 'ほかの法案にも投票する' })).toHaveAttribute('href', '/saiketsu/hoka');

	await v.page.reload();
	expect(await v.page.locator('[data-assignment] a').allInnerTexts()).toEqual(titles);

	// 4本すべてに賛同した人には候補がない
	const backer = s.backers()[0];
	await backer.setNow(at(s.month, 22));
	await openPage(backer.page, '/saiketsu');
	await expect(backer.page.getByText(/割り当て法案\s*0\s*\/\s*0/)).toBeVisible();
	await expect(backer.page.locator('[data-assignment]')).toHaveCount(0);
});

test('基準2：採決の期間の前は開始の日を案内する。ログインしていなければログインへ送る', async ({ browser, page }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 2);
	const { id } = await s.bill(`期間の前の法案 ${s.label}`);
	const v = await s.voter(at(s.month, 15));
	await openPage(v.page, '/saiketsu');
	await expect(v.page.getByText(/採決は\s*5月22日.*から/)).toBeVisible();
	await expect(v.page.getByText(/割り当て法案/)).toHaveCount(0);
	await expect(v.page.getByRole('link', { name: 'ほかの法案にも投票する' })).toHaveCount(0);

	await page.context().setExtraHTTPHeaders({ 'x-test-now': at(s.month, 22) });
	for (const path of ['/saiketsu', '/saiketsu/hoka', votePath(id)]) {
		const res = await page.request.get(path, { maxRedirects: 0 });
		expect(res.status(), path).toBe(303);
		expect(res.headers()['location'], path).toBe(`/login?next=${encodeURIComponent(path)}`);
	}
});

test('基準3：ほかの法案のページに、割り当て以外でこの会期に採決する法案が出て、投票の画面へ進める。次の会期の法案は出ない', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 3);
	const titles = [1, 2, 3, 4].map((n) => `ほかの法案${n} ${s.label}`);
	const bills = [];
	for (const t of titles) bills.push(await s.bill(t));
	// 15日以降の発議は次の会期に採決する
	const later = await s.bill(`次の会期の法案 ${s.label}`, 16);
	const v = await s.voter();
	await openPage(v.page, '/saiketsu');
	const assigned = await v.page.locator('[data-assignment] a').allInnerTexts();
	const rest = bills.filter((b) => !assigned.includes(b.title));
	expect(rest).toHaveLength(1);

	await v.page.getByRole('link', { name: 'ほかの法案にも投票する' }).click();
	await expect(v.page).toHaveURL(/\/saiketsu\/hoka$/);
	const links = main(v.page).getByRole('list').getByRole('link');
	await expect(links).toHaveCount(1);
	await expect(links).toHaveText(rest[0].title);
	await expect(main(v.page)).not.toContainText(later.title);
	await links.click();
	await expect(v.page).toHaveURL(new RegExp(`${votePath(rest[0].id)}$`));
});

test('基準4：投票の画面に題名・3行要約・変更点・票の案内・質疑へのリンクが出る。割り当てなら番号が出る。変更点はスマホでは閉じ、PC では開いている。法案のページの入口は採決の期間だけ', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 4);
	const title = `投票の画面の法案 ${s.label}`;
	const { id, path, a } = await s.bill(title, 5, { summary: `要約の一行目 ${s.label}\n要約の二行目\n要約の三行目` });
	const v = await s.voter();

	await openPage(v.page, path);
	await v.page.getByRole('link', { name: '投票する' }).click();
	await expect(v.page).toHaveURL(new RegExp(`${votePath(id)}$`));
	await hydrated(v.page);
	await expect(v.page.getByRole('heading', { level: 1, name: title })).toBeVisible();
	await expect(main(v.page)).toContainText('割り当て 1 / 1');
	await expect(v.page.getByRole('heading', { name: '3行でいうと' })).toBeVisible();
	await expect(main(v.page)).toContainText(`要約の一行目 ${s.label}`);
	await expect(main(v.page)).toContainText(/変更点 1か所/);
	await expect(v.page.getByRole('heading', { name: 'あなたの票' })).toBeVisible();
	await expect(v.page.getByText('票の数は締切まで誰にも見えません')).toBeVisible();
	await expect(v.page.getByRole('link', { name: '質疑を読む' })).toHaveAttribute('href', `${path}/shitsugi`);

	const opener = v.page.getByRole('button', { name: /^変更点 1か所を見る/ });
	if (w === 'sp') {
		await expect(main(v.page).locator('ins').first()).toBeHidden();
		await opener.click();
	} else {
		await expect(opener).toHaveCount(0);
	}
	await expect(main(v.page).locator('ins').first()).toBeVisible();

	// 提出者には割り当てられない（投票はできる）
	await a.setNow(at(s.month, 22));
	await openPage(a.page, votePath(id));
	await expect(a.page.getByRole('heading', { level: 1, name: title })).toBeVisible();
	await expect(main(a.page)).not.toContainText('割り当て 1 / 1');

	// 採決の期間の前は、法案のページに入口を出さない
	await v.setNow(at(s.month, 15));
	await openPage(v.page, path);
	await expect(v.page.getByRole('link', { name: '投票する' })).toHaveCount(0);
});

test('基準5：票を選ぶまで投票のボタンは押せない。棄権は変更点の一覧を開くまで選べない。棄権を入れた人は開かずに選べる', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 5);
	const { id } = await s.bill(`選ぶ決まりの法案 ${s.label}`);
	const v = await s.voter();
	await openPage(v.page, votePath(id));
	await expect(v.page.getByRole('button', { name: '票を選んでください' })).toBeDisabled();

	const abstain = radio(v.page, /^棄権/);
	if (w === 'sp') {
		await expect(abstain).toBeDisabled();
		await v.page.getByRole('button', { name: /^変更点 1か所を見る/ }).click();
	}
	await expect(abstain).toBeEnabled();
	await choose(v.page, /^棄権/);

	await openPage(v.page, votePath(id));
	await expect(abstain).toBeChecked();
	await expect(abstain).toBeEnabled();
	await expect(v.page.getByRole('button', { name: '投票する' })).toBeEnabled();
});

test('基準6：投票すると一覧が投票済みになり、開き直すと自分の票が選ばれている。締切までは変えられ、最後の票が残る', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 6);
	const { id } = await s.bill(`投票と変更の法案 ${s.label}`);
	const v = await s.voter();
	await openPage(v.page, votePath(id));
	await choose(v.page, '賛成');
	await expect(v.page.getByText('投票しました')).toBeVisible();

	await openPage(v.page, '/saiketsu');
	await expect(v.page.getByText(/1\s*\/\s*1\s*投票済み/)).toBeVisible();
	await expect(v.page.locator('[data-assignment]')).toContainText('投票済み');

	await openPage(v.page, votePath(id));
	await expect(radio(v.page, '賛成')).toBeChecked();
	await choose(v.page, '反対');
	await openPage(v.page, votePath(id));
	await expect(radio(v.page, '反対')).toBeChecked();
	await expect(radio(v.page, '賛成')).not.toBeChecked();

	// ほかの人の画面には、自分の票が出ない
	const other = await s.voter();
	await openPage(other.page, votePath(id));
	await expect(radio(other.page, '反対')).not.toBeChecked();
});

test('基準7：投票資格がなければ参考の票と理由を出す。資格があって割り当てが残っていれば、すべて投票すると数えた票になると出す', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 7);
	const bills = [await s.bill(`案内の法案1 ${s.label}`), await s.bill(`案内の法案2 ${s.label}`)];

	// 前の月に何もしていない人
	const newcomer = await s.person(at(s.month, 22));
	for (const path of ['/saiketsu', votePath(bills[0].id)]) {
		await openPage(newcomer.page, path);
		await expect(newcomer.page.getByText('参考の票として数えます')).toBeVisible();
		await expect(newcomer.page.getByText(/数えた票になります/)).toHaveCount(0);
	}

	const v = await s.voter();
	await openPage(v.page, '/saiketsu');
	await expect(v.page.getByText(/2本すべてに投票すると、あなたの票が\s*数えた票\s*になります/)).toBeVisible();
	await expect(v.page.getByText('参考の票として数えます')).toHaveCount(0);
	await openPage(v.page, votePath(bills[0].id));
	await expect(v.page.getByText(/2本すべてに投票すると、あなたの票が\s*数えた票\s*になります/)).toBeVisible();
	await choose(v.page, '賛成');
	await openPage(v.page, votePath(bills[1].id));
	await choose(v.page, '反対');
	await openPage(v.page, '/saiketsu');
	await expect(v.page.getByText(/2本すべてに投票すると/)).toHaveCount(0);
	await expect(v.page.getByText(/すべて投票済みです。あなたの票は\s*数えた票\s*になります/)).toBeVisible();
});

/** 第2条を変える修正案を出し、2人の賛同で本案より先に採決する形にして、番号を返す */
async function priorAmendment(s: ReturnType<typeof setup>, bill: { path: string }, body: string) {
	const proposer = await s.person(at(s.month, 15));
	const res = await billRequest(proposer.page, `${bill.path}/shusei/kaku`, { rev: '1', reason: '', article: '0:2', body, 'cf-turnstile-response': 'test-pass' });
	expect(res.status(), await res.text()).toBe(303);
	await proposer.page.goto(`${bill.path}/shusei`);
	const raw = await proposer.page.locator('article').filter({ hasText: body }).getAttribute('id');
	const amendment = (raw as string).replace('shusei-', '');
	for (const backer of [await s.person(at(s.month, 15)), await s.person(at(s.month, 15))]) {
		const r = await billRequest(backer.page, `${bill.path}/shusei?/support`, { amendment, revision: '1', op: 'add' });
		expect(r.status(), await r.text()).toBe(200);
	}
	return amendment;
}

test('基準8：本案より先に採決する修正案がある法案にだけ、告知と修正案のタブへのリンクが出る', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 8);
	const withAmendment = await s.bill(`修正案のある法案 ${s.label}`);
	const plain = await s.bill(`修正案のない法案 ${s.label}`);
	await priorAmendment(s, withAmendment, `先に採決する修正案の本文 ${s.label}`);

	const v = await s.voter();
	await openPage(v.page, votePath(withAmendment.id));
	await expect(v.page.getByText('修正案が可決すると本文が変わることがあります')).toBeVisible();
	await expect(v.page.getByRole('link', { name: '修正案を見る' })).toHaveAttribute('href', `${withAmendment.path}/shusei`);

	await openPage(v.page, votePath(plain.id));
	await expect(v.page.getByText('修正案が可決すると本文が変わることがあります')).toHaveCount(0);
	await expect(v.page.getByRole('link', { name: '修正案を見る' })).toHaveCount(0);
	// 3行要約のない法案には欄を出さない
	await expect(v.page.getByRole('heading', { name: '3行でいうと' })).toHaveCount(0);
});

test('基準9：Turnstile・国・期間の外・採決の対象でない法案の投票は保存しない。上限は本案と修正案の票を合わせて数え、同じ票の入れ直しは数えない。締め出し中は入れられない', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 9);
	const bill = await s.bill(`断る場合の法案 ${s.label}`);
	const amendment = await priorAmendment(s, bill, `断る場合の修正案の本文 ${s.label}`);
	const later = await s.bill(`次の会期の断る法案 ${s.label}`, 16);

	const v = await s.voter();
	expect((await post(v.page, bill.id, voteForm('yes', 'bad-token'))).status()).toBe(400);
	const abroad = await s.person(at(s.month, 22), { country: 'US' });
	expect((await post(abroad.page, bill.id, voteForm('yes'))).status()).toBe(403);
	// 期間の外と対象でない法案：断ったあとのページの読み込みで法案のページへ移す（フォームの送信の形）
	const movedTo = async (id: string, to: string) => {
		const res = await post(v.page, id, voteForm('yes'));
		expect(res.status()).toBe(303);
		expect(res.headers()['location']).toBe(to);
	};
	await movedTo(later.id, later.path);
	await v.setNow(at(s.month, 15));
	await movedTo(bill.id, bill.path);
	await v.setNow(at(s.month, 22));

	// どれも保存されていない（次の会期の法案は、その会期の採決の期間に確かめる）
	await openPage(v.page, votePath(bill.id));
	await expect(radio(v.page, '賛成')).not.toBeChecked();
	await v.setNow(at(s.month.replace(/-05$/, '-06'), 22));
	await openPage(v.page, votePath(later.id));
	await expect(radio(v.page, '賛成')).not.toBeChecked();
	await v.setNow(at(s.month, 22));

	// 発議済みで今は対象でない法案の画面は、法案のページへ移す
	const moved = await v.page.request.get(votePath(later.id), { maxRedirects: 0 });
	expect(moved.status()).toBe(303);
	expect(moved.headers()['location']).toBe(later.path);

	// 5分に20回まで。票が変わるたびに数える
	const u = await s.voter();
	for (let i = 0; i < 20; i++) {
		const res = await post(u.page, bill.id, voteForm(i % 2 ? 'no' : 'yes'));
		expect(res.status(), `${i}回目`).toBe(200);
	}
	// 20回目の票（no）の入れ直しは票が変わらないので数えない
	expect((await post(u.page, bill.id, voteForm('no'))).status()).toBe(200);
	// 本案の票で上限に達すると、票を変えることも修正案の票も断る（違反が3回で締め出す）
	expect((await post(u.page, bill.id, voteForm('yes'))).status()).toBe(429);
	const toAmendment = () => billRequest(u.page, `${bill.path}/shusei?/vote`, { amendment, ...voteForm('yes') });
	expect((await toAmendment()).status()).toBe(429);
	const third = await post(u.page, bill.id, voteForm('abstain'));
	expect(third.status()).toBe(429);
	const banned = await post(u.page, bill.id, voteForm('no'));
	expect(banned.status()).toBe(429);
	expect(await banned.text()).toContain('制限を何度も超えた');
});

test('信頼の境界：URL の法案の番号が形の違うとき、存在しないとき、下書きのときは 404', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 10);
	const v = await s.voter();
	const { ids } = await issueWithSolutions(v.page, `下書き ${s.label}`, [`下書きの解決策 ${s.label}`]);
	const draft = (await createAmendBill(v.page, `下書きの法案 ${s.label}`, ids[0])).replace('/houan/', '');
	for (const id of ['abc', '01', '0', '-1', '1.5', '99999999999', '9999999999', draft]) {
		expect((await v.page.request.get(votePath(id))).status(), id).toBe(404);
		expect((await post(v.page, id, voteForm('yes'))).status(), id).toBe(404);
	}
	for (const q of ['?page=abc', '?page=0', '?page=9999']) expect((await v.page.request.get(`/saiketsu/hoka${q}`)).status(), q).toBe(404);
});

test('信頼の境界：票の値が決まった値でなければ 400 で、保存しない', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 11);
	const { id } = await s.bill(`票の値の法案 ${s.label}`);
	const v = await s.voter();
	for (const bad of ['', 'maybe', 'YES', '賛成', 'yes ']) expect((await post(v.page, id, voteForm(bad))).status(), bad).toBe(400);
	expect((await post(v.page, id, { 'cf-turnstile-response': 'test-pass' })).status()).toBe(400);
	await openPage(v.page, votePath(id));
	for (const name of ['賛成', '反対']) await expect(radio(v.page, name)).not.toBeChecked();
});
