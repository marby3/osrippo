// Issue #171「わたしの記録」をキャラクターシートにする（受入基準は Issue #198 の「#171」の節）。
// 基準4（立候補できるまでの判定が standBlock と同じになる）は src/lib/db/watashi.test.ts
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { billRequest, billSupportRequest, createAmendBill, issueWithSolutions, newUser, ORIGIN, postIssue, proposeRequest } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});
test.use({ actionTimeout: 15_000 });
test.beforeEach(() => test.setTimeout(240_000));

const stamp = () => Date.now() % 1e8;
const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
/** 基準ごと・幅ごと・ワーカーごとに別の年（ほかのテストが使っていない6000年から） */
const monthOf = (w: string, group: number) => `${6000 + test.info().workerIndex * 12 + group * 2 + (w === 'sp' ? 0 : 1)}-05`;
const prevOf = (month: string) => month.replace(/-05$/, '-04');
const nextOf = (month: string) => month.replace(/-05$/, '-06');
const at = (month: string, day: number) => `${month}-${String(day).padStart(2, '0')}T09:00:00+09:00`;
const yearOf = (month: string) => Number(month.slice(0, 4));
const passed = { 'cf-turnstile-response': 'test-pass' };

type User = {
	page: Page;
	name: string;
	setNow: (now: string) => Promise<void>;
};
async function user(browser: Browser, address: string, now: string, name: string): Promise<User> {
	const u = await newUser(browser, { name, ip: address, days: 8 });
	contexts.push(u.context);
	const setNow = (t: string) => u.context.setExtraHTTPHeaders({ 'x-test-ip': address, 'x-test-now': t });
	await setNow(now);
	return { page: u.page, name, setNow };
}

function setup(browser: Browser, w: string, group: number) {
	const month = monthOf(w, group);
	const label = `k${group}${w}${stamp()}`;
	let seq = 0;
	const person = (now: string) => {
		seq += 1;
		return user(browser, `10.${w === 'sp' ? 171 : 172}.${group}.${seq}`, now, `u${seq}-${label}`);
	};
	/** 下書きの法案（保存済み） */
	async function draft(a: User, title: string) {
		const { ids } = await issueWithSolutions(a.page, title, [`解決策 ${title}`]);
		return createAmendBill(a.page, title, ids[0]);
	}
	/** 3人の賛同を集めて発議する（5日） */
	async function propose(a: User, path: string) {
		for (let i = 0; i < 3; i++) {
			const b = await person(at(month, 5));
			const res = await billSupportRequest(b.page, path, {
				op: 'add',
				rev: '1'
			});
			expect(res.status(), await res.text()).toBe(200);
		}
		const res = await proposeRequest(a.page, path);
		expect(res.status(), await res.text()).toBe(200);
	}
	/** 投票資格のある人：前の月に課題を書いている */
	async function voter(now: string) {
		const u = await person(at(prevOf(month), 10));
		await postIssue(u.page, { title: `前の月の課題 ${label} ${seq}` });
		await u.setNow(now);
		return u;
	}
	return { month, label, person, draft, propose, voter };
}

const card = (page: Page) => page.locator('[data-profile]');
const drafted = (page: Page) => page.getByRole('region', { name: '起草した法案' });
const adopted = (page: Page) => page.getByRole('region', { name: '採用された修正案' });

test('基準1：所属している委員会と、いまの役（委員長・理事）が出る。得票と順位は出さない', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 1);
	const a = await s.person(at(s.month, 5));
	const path = await s.draft(a, `委員会の法案 ${s.label}`);
	await s.propose(a, path);

	// 何もしていない人は、まだ所属していない。役もない
	const idle = await s.person(at(s.month, 22));
	await idle.page.goto('/watashi');
	await expect(card(idle.page).locator('[data-membership]')).toHaveText('まだ所属していません');
	await expect(card(idle.page).locator('[data-role]')).toHaveText('なし');

	// 法案を書いた人は、その会期に委員会に所属している
	await a.setNow(at(s.month, 22));
	await a.page.goto('/watashi');
	await expect(card(a.page).locator('[data-membership]')).toHaveText('消費者保護委員会');

	// 委員長と理事を選ぶ：2人が3週目に質疑を書き、4週目に立候補する。2人と1人が投票する
	const chair = await s.person(at(s.month, 16));
	const director = await s.person(at(s.month, 16));
	for (const c of [chair, director]) {
		const res = await billRequest(c.page, `${path}/shitsugi/kaku`, {
			body: `質疑 ${s.label} ${c.name}`,
			...passed
		});
		expect(res.status(), await res.text()).toBeLessThan(400);
		await c.setNow(at(s.month, 22));
		const stood = await billRequest(c.page, '/iinkai?/stand', passed);
		expect(stood.status()).toBe(200);
		expect(await stood.text()).not.toContain('"type":"failure"');
	}
	for (const whom of [chair, chair, director]) {
		const v = await s.voter(at(s.month, 23));
		await v.page.goto('/iinkai');
		await hydrated(v.page);
		await v.page.getByRole('radio', { name: whom.name }).check();
		const [res] = await Promise.all([v.page.waitForResponse((r) => r.request().method() === 'POST'), v.page.getByRole('button', { name: '投票する', exact: true }).click()]);
		expect(await res.text()).not.toContain('"type":"failure"');
	}

	// 次の会期：委員長と理事に役が出る（会期つき）
	const next = nextOf(s.month);
	const term = `${yearOf(next)}年6月の会期`;
	for (const [u, role] of [
		[chair, '委員長'],
		[director, '理事']
	] as const) {
		await u.setNow(at(next, 1));
		// 次の会期にも何かをすると所属が出る
		await postIssue(u.page, { title: `次の会期の課題 ${s.label} ${u.name}` });
		await u.page.goto('/watashi');
		await expect(card(u.page).locator('[data-role]')).toHaveText(`${role}（${term}）`);
		await expect(card(u.page).locator('[data-membership]')).toHaveText('消費者保護委員会');
		// 得票と順位は出さない
		for (const word of ['得票', '票数', '順位']) await expect(u.page.getByRole('main').getByText(word)).toHaveCount(0);
		const data = await (await u.page.request.get('/watashi/__data.json')).text();
		for (const word of ['"rank"', '"votes"', 'totalVotes']) expect(data, word).not.toContain(word);
	}
});

test('基準2：「起草した法案」に、提出者か共同提出者の法案が、状態か結果と一緒に出る', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 2);
	const now = at(s.month, 5);
	const a = await s.person(now);
	const co = await s.person(now);
	const other = await s.person(now);

	// 共同提出者のいる法案を発議し、もう1本は下書きのまま
	const proposedTitle = `発議した法案 ${s.label}`;
	const path = await s.draft(a, proposedTitle);
	const cosponsor = await billRequest(co.page, `${path}?/cosponsor`, {
		op: 'request'
	});
	expect(cosponsor.status()).toBeLessThan(400);
	await a.page.goto(path);
	await hydrated(a.page);
	await a.page.getByRole('button', { name: '承認する', exact: true }).click();
	await expect(a.page.getByText(`共同提出者 ${co.name}`, { exact: true })).toBeVisible();
	await s.propose(a, path);
	const draftTitle = `下書きの法案 ${s.label}`;
	await s.draft(a, draftTitle);

	const row = (page: Page, title: string) => drafted(page).getByRole('row').filter({ hasText: title });
	await a.page.goto('/watashi');
	await expect(row(a.page, proposedTitle)).toContainText('提出者');
	await expect(row(a.page, proposedTitle)).toContainText('発議');
	await expect(row(a.page, proposedTitle).getByRole('link', { name: proposedTitle })).toHaveAttribute('href', path);
	await expect(row(a.page, draftTitle)).toContainText('提出者');
	await expect(row(a.page, draftTitle)).toContainText('下書き');
	await co.page.goto('/watashi');
	await expect(row(co.page, proposedTitle)).toContainText('共同提出者');
	await expect(row(co.page, proposedTitle)).toContainText('発議');
	await expect(row(co.page, draftTitle)).toHaveCount(0);
	// 起草していない人には、ほかの人の法案は出ない
	await other.page.goto('/watashi');
	await expect(drafted(other.page).getByText('起草した法案はまだありません')).toBeVisible();

	// 3週目は質疑中
	await a.setNow(at(s.month, 15));
	await a.page.goto('/watashi');
	await expect(row(a.page, proposedTitle)).toContainText('質疑中');

	// 会期が終わると結果（だれも投票していないので廃案）と会期が出る
	await a.setNow(at(nextOf(s.month), 1));
	await a.page.goto('/watashi');
	await expect(row(a.page, proposedTitle)).toContainText('廃案');
	await expect(row(a.page, proposedTitle)).toContainText(`${yearOf(s.month)}年5月の会期`);
});

test('基準3：「採用された修正案」に、取り込まれたか可決した自分の修正案が出る', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 3);
	const a = await s.person(at(s.month, 5));
	const title = `修正案の法案 ${s.label}`;
	const path = await s.draft(a, title);
	await s.propose(a, path);

	// 3週目に2本の修正案を出し、提出者が1本を取り込む
	const g = await s.person(at(s.month, 15));
	await a.setNow(at(s.month, 15));
	const amend = async (article: string, body: string) => {
		const res = await billRequest(g.page, `${path}/shusei/kaku`, {
			rev: '1',
			reason: '',
			article,
			body,
			...passed
		});
		expect(res.status(), await res.text()).toBe(303);
		await g.page.goto(`${path}/shusei`);
		const id = await g.page.locator('article').filter({ hasText: body }).getAttribute('id');
		return (id as string).replace('shusei-', '');
	};
	const taken = await amend('0:2', `取り込まれる修正案 ${s.label}`);
	await amend('0:3', `取り込まれない修正案 ${s.label}`);

	await g.page.goto('/watashi');
	await expect(adopted(g.page).getByText('採用された修正案はまだありません')).toBeVisible();

	const res = await billRequest(a.page, `${path}/shusei?/accept`, {
		amendment: taken,
		revision: '1'
	});
	expect(res.status(), await res.text()).toBe(200);

	await g.page.goto('/watashi');
	const items = adopted(g.page).getByRole('listitem');
	await expect(items).toHaveCount(1);
	await expect(items.getByRole('link', { name: title })).toHaveAttribute('href', `${path}/shusei`);
	await expect(items).toContainText('消費者契約法 第2条');
	await expect(items).toContainText('取り込まれました');
	// 修正案を出していない提出者には出ない
	await a.page.goto('/watashi');
	await expect(adopted(a.page).getByText('採用された修正案はまだありません')).toBeVisible();
});

test('基準5：賛否の傾向、自分の票、立場は出さない。本人にしか見えない', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 5);
	const a = await s.person(at(s.month, 5));
	const title = `投票する法案 ${s.label}`;
	const path = await s.draft(a, title);
	await s.propose(a, path);

	// 投票する人は、自分の下書きも持つ。立場を決めて、賛成に投票する
	const v = await s.voter(at(s.month, 5));
	const own = `本人の下書き ${s.label}`;
	await s.draft(v, own);
	await v.setNow(at(s.month, 16));
	const stance = await billRequest(v.page, `${path}/shitsugi?/stance`, {
		stance: 'for'
	});
	expect(stance.status()).toBe(200);
	expect(await stance.text()).not.toContain('"type":"failure"');
	await v.setNow(at(s.month, 22));
	const vote = await billRequest(v.page, `/saiketsu/${path.replace('/houan/', '')}?/vote`, { choice: 'yes', ...passed });
	expect(vote.status()).toBe(200);
	expect(await vote.text()).not.toContain('"type":"failure"');

	await v.page.goto('/watashi');
	await expect(drafted(v.page).getByText(own)).toBeVisible();
	await expect(v.page.getByText('自分だけに見えます')).toBeVisible();
	const main = v.page.getByRole('main');
	for (const word of ['賛成', '反対', '棄権', '立場', '寄り', title]) await expect(main.getByText(word)).toHaveCount(0);
	const data = await (await v.page.request.get('/watashi/__data.json')).text();
	for (const word of ['stance', 'choice', '"yes"', '"for"', title]) expect(data, word).not.toContain(word);

	// ほかの人のページには出ない。ログインしていなければログインに送る
	const other = await s.person(at(s.month, 22));
	await other.page.goto('/watashi');
	await expect(other.page.getByText(other.name, { exact: true })).toBeVisible();
	for (const word of [v.name, own]) await expect(other.page.getByRole('main').getByText(word)).toHaveCount(0);
	const anonymous = await browser.newContext({
		baseURL: ORIGIN,
		extraHTTPHeaders: { 'x-test-now': at(s.month, 22) }
	});
	contexts.push(anonymous);
	const stranger = await anonymous.newPage();
	await stranger.goto('/watashi');
	await expect(stranger).toHaveURL(/\/login\?next=%2Fwatashi$/);
});
