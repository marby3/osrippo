// Issue #73 結果の確認。判定と保留の中身は src/lib/domain/anomalies.test.ts と src/lib/db/reviews.test.ts。
// 同じ回線の5票を除くと定足数に届かない形で保留させる
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { billRequest, billSupportRequest, createAmendBill, ifTarget, IF_LAW, issueWithSolutions, newUser, postIssue, proposeRequest } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});
test.use({ actionTimeout: 15_000 });
test.beforeEach(() => test.setTimeout(240_000));

type Width = 'sp' | 'pc';
const stamp = () => Date.now() % 1e8;
const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
/** 基準ごと・幅ごとに別の年を使う（2256年までは IF世界のテストが使っている） */
const monthOf = (w: string, group: number) => `${2300 + group * 3 + (w === 'sp' ? 0 : 1)}-05`;
const shift = (month: string, n: number) => month.replace(/-05$/, `-${String(5 + n).padStart(2, '0')}`);
const at = (month: string, day: number) => `${month}-${String(day).padStart(2, '0')}T09:00:00+09:00`;
/** IF_LAW の条の位置（if-sekai.spec.ts が可決しない位置） */
const slot = (w: string, n: number) => 34 + n * 2 + (w === 'sp' ? 0 : 1);

type User = { page: Page; setNow: (now: string) => Promise<void> };

async function user(browser: Browser, address: string, now: string, name?: string, role?: 'moderator' | 'operator'): Promise<User> {
	const u = await newUser(browser, { name, ip: address, days: 8, role });
	contexts.push(u.context);
	const setNow = (t: string) => u.context.setExtraHTTPHeaders({ 'x-test-ip': address, 'x-test-now': t });
	await setNow(now);
	return { page: u.page, setNow };
}

function setup(browser: Browser, w: string, group: number) {
	const month = monthOf(w, group);
	const label = `r${group}-${w}-${stamp()}`;
	let seq = 0;
	const nextIp = () => {
		seq += 1;
		return `10.${w === 'sp' ? 92 : 93}.${group}.${seq}`;
	};
	const person = (now: string, role?: 'moderator' | 'operator') => {
		const address = nextIp();
		return user(browser, address, now, `u${seq}-${label}`, role);
	};
	const anonymous = (now: string) => user(browser, nextIp(), now);
	const line = `10.${w === 'sp' ? 94 : 95}.${group}.1`;
	const backers: User[] = [];
	async function bill(title: string, body: string, n: number) {
		const a = await person(at(month, 5));
		const { ids } = await issueWithSolutions(a.page, title, [`解決策 ${title}`]);
		const target = await ifTarget(a.page, slot(w, n));
		const path = await createAmendBill(a.page, title, ids[0], { 'body.0': body }, target);
		for (let i = 0; i < 3; i++) {
			const b = await person(at(month, 5));
			backers.push(b);
			const res = await billSupportRequest(b.page, path, { op: 'add', rev: '1' });
			expect(res.status(), await res.text()).toBe(200);
		}
		const res = await proposeRequest(a.page, path);
		expect(res.status(), await res.text()).toBe(200);
		return { a, path, id: path.replace('/houan/', ''), title, target };
	}
	/** 賛成10票。うち5票は同じ回線 */
	async function heldVotes(id: string) {
		for (let i = 0; i < 10; i++) {
			const name = `v${i}-${label}`;
			const u = await user(browser, i < 5 ? line : nextIp(), at(shift(month, -1), 10), name);
			await postIssue(u.page, { title: `前の月の課題 ${label} ${i}` });
			await u.setNow(at(month, 22));
			const res = await billRequest(u.page, `/saiketsu/${id}?/vote`, { choice: 'yes', 'cf-turnstile-response': 'test-pass' });
			expect(res.status(), await res.text()).toBe(200);
		}
	}
	return { month, label, person, anonymous, bill, heldVotes, backers };
}

const kekkaOf = (id: string) => `/saiketsu/${id}/kekka`;
const main = (u: Page) => u.getByRole('main');
const open = async (u: Page, path: string) => {
	await u.goto(path);
	await hydrated(u);
};
const status = (u: Page, w: Width, name: string) => (w === 'sp' ? u.getByText(`いま：${name}`, { exact: true }) : u.getByText(`${name}（いまここ）`, { exact: true }));
const staffCard = (u: Page, title: string) => u.locator('article').filter({ hasText: title });
const decide = (u: Page, action: 'confirmReview' | 'voidReview', form: Record<string, string>) => billRequest(u, `/kanri?/${action}`, form);
const sessionKey = (month: string) => month;

test('基準4：確認中は結果のページ・法案のページ・一覧に「結果を確認しています」と出て、可否と票の数が出ない。IF世界に反映されない', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const s = setup(browser, w, 1);
	const body = `確認中の本文 ${s.label}`;
	const { id, path, title, target } = await s.bill(`確認中の法案 ${s.label}`, body, 0);
	await s.heldVotes(id);

	const v = await s.anonymous(`${shift(s.month, 1)}-01T09:00:00+09:00`);
	await open(v.page, kekkaOf(id));
	await expect(v.page.getByText('結果を確認しています')).toBeVisible();
	await expect(v.page.locator('[data-if-band]')).toBeVisible();
	await expect(v.page.getByText('可決', { exact: true })).toHaveCount(0);
	await expect(main(v.page)).not.toContainText(/数えた票|(賛成|反対|棄権)\s*\d/);
	const data = await (await v.page.request.get(`${kekkaOf(id)}/__data.json`)).text();
	expect(data).not.toMatch(/outcome|passed|refYes|abstain/);

	await open(v.page, path);
	await expect(status(v.page, w, '結果を確認しています')).toBeVisible();
	await expect(v.page.getByRole('link', { name: '結果を見る' })).toBeVisible();

	for (let page = 1; page <= 30; page++) {
		await v.page.goto(page === 1 ? '/houan?tab=owari' : `/houan?tab=owari&page=${page}`);
		const row = v.page.getByRole('row').filter({ hasText: title });
		if (await row.count()) {
			await expect(row).toContainText('結果を確認しています');
			break;
		}
		expect(await v.page.getByRole('link', { name: '次のページ' }).count()).toBeGreaterThan(0);
	}

	await open(v.page, `/if/hourei/${IF_LAW}`);
	await expect(v.page.getByRole('article', { name: target.label, exact: true })).not.toContainText(body);
});

test('基準5：運営が確定すると結果が出て、可決なら IF世界に反映される', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const s = setup(browser, w, 2);
	const body = `確定する本文 ${s.label}`;
	const { id, title, target } = await s.bill(`確定する法案 ${s.label}`, body, 1);
	await s.heldVotes(id);
	const next = `${shift(s.month, 1)}-02T09:00:00+09:00`;
	const v = await s.anonymous(next);
	await open(v.page, kekkaOf(id));
	await expect(v.page.getByText('結果を確認しています')).toBeVisible();

	const operator = await s.person(next, 'operator');
	await open(operator.page, '/kanri');
	const card = staffCard(operator.page, title);
	await expect(card).toContainText('同じ回線からの票の集中');
	await expect(card).toContainText(/賛成\s*10/);
	await expect(card).toContainText(/除いたときの結果[：\s]*廃案/);
	await card.getByRole('button', { name: '結果を確定する' }).click();
	await expect(staffCard(operator.page, title)).toHaveCount(0);

	await open(v.page, kekkaOf(id));
	await expect(v.page.getByText('可決', { exact: true })).toBeVisible();
	await expect(v.page.getByText('IF世界の法律になりました')).toBeVisible();
	await v.page.getByRole('link', { name: 'IF世界の条文を見る' }).click();
	await expect(v.page.getByRole('article', { name: target.label, exact: true })).toContainText(body);
});

test('基準6：運営が無効にすると廃案になり、理由が出て、可否の文字と比べが出ず、IF世界に反映されない。理由がなければ断る', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const s = setup(browser, w, 3);
	const body = `無効にする本文 ${s.label}`;
	const { id, path, title, target } = await s.bill(`無効にする法案 ${s.label}`, body, 2);
	await s.heldVotes(id);
	const next = `${shift(s.month, 1)}-02T09:00:00+09:00`;
	const v = await s.anonymous(next);
	await open(v.page, kekkaOf(id));

	const operator = await s.person(next, 'operator');
	for (const note of ['', '   ']) {
		const res = await decide(operator.page, 'voidReview', { bill: id, session: sessionKey(s.month), note });
		expect(res.status(), JSON.stringify(note)).toBe(400);
	}
	await open(operator.page, '/kanri');
	const card = staffCard(operator.page, title);
	const reason = `同じ回線の票が結果を左右しました ${s.label}`;
	await card.getByLabel('無効にする理由').fill(reason);
	await card.getByRole('button', { name: 'この採決を無効にする' }).click();
	await expect(staffCard(operator.page, title)).toHaveCount(0);

	await open(v.page, kekkaOf(id));
	await expect(v.page.getByText('廃案', { exact: true })).toBeVisible();
	await expect(v.page.getByText('確認の結果、この採決は無効になりました')).toBeVisible();
	await expect(main(v.page)).toContainText(reason);
	await expect(v.page.getByText('可決', { exact: true })).toHaveCount(0);
	await expect(v.page.getByText('IF世界の法律になりました')).toHaveCount(0);
	await expect(v.page.getByRole('link', { name: 'IF世界の条文を見る' })).toHaveCount(0);
	await expect(v.page.getByText(/数えた票と同じでした|可否が逆/)).toHaveCount(0);
	expect(await (await v.page.request.get(`${kekkaOf(id)}/__data.json`)).text()).not.toContain('passed');

	await open(v.page, path);
	await expect(status(v.page, w, '廃案')).toBeVisible();
	await open(v.page, `/if/hourei/${IF_LAW}`);
	await expect(v.page.getByRole('article', { name: target.label, exact: true })).not.toContainText(body);
});

test('基準7：運営と運営協力者のほかは確認できない。提出者と賛同者は確認できず賛否の数も見えない。確定は1回だけ', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 4);
	// 賛同者を運営協力者にする
	const a = await s.person(at(s.month, 5), 'moderator');
	const title = `関わりの法案 ${s.label}`;
	const { ids } = await issueWithSolutions(a.page, title, [`解決策 ${title}`]);
	const target = await ifTarget(a.page, slot(w, 3));
	const path = await createAmendBill(a.page, title, ids[0], { 'body.0': `関わりの本文 ${s.label}` }, target);
	const backer = await s.person(at(s.month, 5), 'moderator');
	expect((await billSupportRequest(backer.page, path, { op: 'add', rev: '1' })).status()).toBe(200);
	for (let i = 0; i < 2; i++) {
		const b = await s.person(at(s.month, 5));
		expect((await billSupportRequest(b.page, path, { op: 'add', rev: '1' })).status()).toBe(200);
	}
	expect((await proposeRequest(a.page, path)).status()).toBe(200);
	const id = path.replace('/houan/', '');
	await s.heldVotes(id);
	const next = `${shift(s.month, 1)}-02T09:00:00+09:00`;
	const v = await s.anonymous(next);
	await open(v.page, kekkaOf(id));
	const form = { bill: id, session: sessionKey(s.month), note: '理由' };

	// 一般の人とログインしていない人は 404
	const plain = await s.person(next);
	expect((await plain.page.request.get('/kanri')).status()).toBe(404);
	expect((await decide(plain.page, 'confirmReview', form)).status()).toBe(404);
	expect((await decide(v.page, 'confirmReview', form)).status()).toBe(404);

	// 提出者と賛同者（運営協力者）：ボタンも賛否の数も出ず、送っても断る
	for (const involved of [a, backer]) {
		await involved.setNow(next);
		await open(involved.page, '/kanri');
		const card = staffCard(involved.page, title);
		await expect(card).toContainText('自分が関わった法案は確認できません');
		await expect(card.getByRole('button', { name: '結果を確定する' })).toHaveCount(0);
		await expect(card).not.toContainText(/賛成\s*\d/);
		expect((await decide(involved.page, 'confirmReview', form)).status()).toBe(403);
	}

	// 確定は1回だけ
	const moderator = await s.person(next, 'moderator');
	expect((await decide(moderator.page, 'confirmReview', form)).status()).toBe(200);
	expect((await decide(moderator.page, 'voidReview', form)).status()).toBe(409);
});

test('基準8：/unei に偏りと確認の記録が出て、回線・人数・アカウントが出ない', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 5);
	const reason = `公開の理由 ${s.label}`;
	const { id, title } = await s.bill(`記録の法案 ${s.label}`, `記録の本文 ${s.label}`, 4);
	await s.heldVotes(id);
	const next = `${shift(s.month, 1)}-02T09:00:00+09:00`;
	const v = await s.anonymous(next);
	await open(v.page, kekkaOf(id));

	const row = () => v.page.getByRole('row').filter({ hasText: title });
	await v.page.goto('/unei');
	await expect(row()).toContainText('同じ回線からの票の集中');
	await expect(row()).toContainText('結果を確認しています');

	const operator = await s.person(next, 'operator');
	expect((await decide(operator.page, 'voidReview', { bill: id, session: sessionKey(s.month), note: reason })).status()).toBe(200);
	await v.page.goto('/unei');
	await expect(row()).toContainText('無効にした');
	await expect(row()).toContainText('運営');
	await expect(row()).toContainText(reason);
	await expect(row().getByRole('link', { name: title })).toHaveAttribute('href', `/houan/${id}`);
	const html = await (await v.page.request.get('/unei/__data.json')).text();
	for (const secret of ['flagged', 'maxLine', 'detail', 'decidedBy', `10.${w === 'sp' ? 94 : 95}`]) expect(html, secret).not.toContain(secret);
});

test('信頼の境界：確認のフォームの値が決まった形でなければ断る', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 6);
	const { id } = await s.bill(`境界の法案 ${s.label}`, `境界の本文 ${s.label}`, 5);
	await s.heldVotes(id);
	const next = `${shift(s.month, 1)}-02T09:00:00+09:00`;
	const v = await s.anonymous(next);
	await open(v.page, kekkaOf(id));
	const op = await s.person(next, 'operator');
	const session = sessionKey(s.month);
	for (const [label, action, form] of [
		['番号の形', 'confirmReview', { bill: 'abc', session }],
		['番号なし', 'confirmReview', { session }],
		['会期なし', 'confirmReview', { bill: id }],
		['会期の違い', 'confirmReview', { bill: id, session: '2000-01' }],
		['ない法案', 'confirmReview', { bill: '9999999999', session }],
		['理由が長い', 'voidReview', { bill: id, session, note: 'あ'.repeat(401) }],
		['理由に制御文字', 'voidReview', { bill: id, session, note: '\u202eあ' }]
	] as const) {
		const res = await decide(op.page, action, form as Record<string, string>);
		expect(res.status(), label).toBeGreaterThanOrEqual(400);
		expect(res.status(), label).toBeLessThan(500);
	}
	// どれも確定していない
	await v.page.goto(kekkaOf(id));
	await expect(v.page.getByText('結果を確認しています')).toBeVisible();
});

test('信頼の境界：/unei?kakunin= の形が違えば 404', async ({ page }) => {
	for (const q of ['abc', '0', '-1', '1.5', '99999']) expect((await page.request.get(`/unei?kakunin=${q}`)).status(), q).toBe(404);
});
