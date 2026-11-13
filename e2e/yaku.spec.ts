// Issue #169 発言に役のタグ（#198 の受入基準。基準2は決定2で、委員会の名前と会期を入れる形）。
// 委員長・理事は、書いた時点の会期（posts.session_key）の chair_terms で決める
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { billRequest, billSupportRequest, createAmendBill, issueWithSolutions, newUser, ORIGIN, postIssue, proposeRequest } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});
test.use({ actionTimeout: 15_000 });
// 発議と委員長選挙の準備が重い
test.beforeEach(() => test.setTimeout(240_000));

const stamp = () => Date.now() % 1e8;
const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
const ip = (w: string, group: number, n: number) => `10.${w === 'sp' ? 174 : 175}.${group}.${n}`;
/** 基準ごと・幅ごとに別の年を使う（3100年より前と5000年より後はほかのテストが使っている）。どの基準も4月〜6月の中で動く */
const monthOf = (w: string, group: number) => `${3100 + group * 2 + (w === 'sp' ? 0 : 1)}-05`;
const prevOf = (month: string) => month.replace(/-05$/, '-04');
const nextOf = (month: string) => month.replace(/-05$/, '-06');
const at = (month: string, day: number) => `${month}-${String(day).padStart(2, '0')}T09:00:00+09:00`;
/** "3104-06" → "3104年6月の会期" */
const sessionName = (month: string) => `${Number(month.slice(0, 4))}年${Number(month.slice(5))}月の会期`;

type User = { page: Page; name: string; setNow: (now: string) => Promise<void> };
type Opts = { role?: 'moderator' | 'operator' };

async function user(browser: Browser, address: string, now: string, name: string, opts: Opts = {}): Promise<User> {
	const u = await newUser(browser, { name, ip: address, days: 40, ...(opts.role ? { role: opts.role } : {}) });
	contexts.push(u.context);
	const setNow = (t: string) => u.context.setExtraHTTPHeaders({ 'x-test-ip': address, 'x-test-now': t });
	await setNow(now);
	return { page: u.page, name, setNow };
}

function setup(browser: Browser, w: string, group: number) {
	const month = monthOf(w, group);
	const label = `y${group}${w}${stamp()}`;
	let seq = 0;
	const person = (now: string, opts: Opts = {}) => {
		seq += 1;
		return user(browser, ip(w, group, seq), now, `u${seq}-${label}`, opts);
	};
	/** 発議した法案。now に発議する。supporter を渡すと、その人も賛同する。cosponsor を渡すと、その人が共同提出者になる */
	async function bill(now: string, { supporter, cosponsor }: { supporter?: User; cosponsor?: User } = {}) {
		const a = await person(now);
		const title = `役の法案 ${label} ${seq}`;
		const { ids } = await issueWithSolutions(a.page, title, [`解決策 ${title}`]);
		const path = await createAmendBill(a.page, title, ids[0]);
		if (cosponsor) {
			await cosponsor.setNow(now);
			const asked = await billRequest(cosponsor.page, `${path}?/cosponsor`, { op: 'request' });
			expect(asked.status(), await asked.text()).toBeLessThan(400);
			const html = await (await a.page.request.get(path)).text();
			const id = /action="\?\/cosponsor"[\s\S]*?name="id" value="(\d+)"/.exec(html)?.[1];
			expect(id, '共同提出者の申し出').toBeTruthy();
			const accepted = await billRequest(a.page, `${path}?/cosponsor`, { op: 'accept', id: id as string });
			expect(accepted.status(), await accepted.text()).toBeLessThan(400);
		}
		const supporters = supporter ? [supporter] : [];
		while (supporters.length < 3) supporters.push(await person(now));
		for (const b of supporters) {
			await b.setNow(now);
			const res = await billSupportRequest(b.page, path, { op: 'add', rev: '1' });
			expect(res.status(), await res.text()).toBe(200);
		}
		const res = await proposeRequest(a.page, path);
		expect(res.status(), await res.text()).toBe(200);
		return { path, author: a, supporters };
	}
	/** ログインしていない人 */
	async function viewer(now: string) {
		const context = await browser.newContext({ baseURL: ORIGIN, extraHTTPHeaders: { 'x-test-now': now, 'x-test-ip': ip(w, group, 200) } });
		contexts.push(context);
		return context.newPage();
	}
	return { month, label, person, bill, viewer };
}

const qa = (bill: string) => `${bill}/shitsugi`;
const card = (page: Page, text: string) => page.locator('article').filter({ hasText: text });
/** 答弁・補足の区画（本文で選ぶ） */
const reply = (page: Page, text: string) => page.locator('article section').filter({ hasText: text });
const ok = async (res: Awaited<ReturnType<typeof billRequest>>) => {
	expect(res.status(), await res.text()).toBeLessThan(400);
	if (res.status() < 300) expect(await res.text()).not.toContain('"type":"failure"');
};
const question = (u: Page, bill: string, body: string) => billRequest(u, `${qa(bill)}/kaku`, { body, 'cf-turnstile-response': 'test-pass' });
const answer = (u: Page, bill: string, q: string, body: string) => billRequest(u, `${qa(bill)}?/answer`, { question: q, body, 'cf-turnstile-response': 'test-pass' });
const supplement = (u: Page, bill: string, q: string, body: string) => billRequest(u, `${qa(bill)}?/supplement`, { question: q, body, 'cf-turnstile-response': 'test-pass' });
const questionId = async (u: Page, bill: string, text: string) => {
	await u.goto(qa(bill));
	const id = await card(u, text).getAttribute('id');
	expect(id).toMatch(/^shitsugi-\d+$/);
	return (id as string).replace('shitsugi-', '');
};
/** スマホでは答弁が閉じているので開く */
async function openAnswers(page: Page, w: string, c: Locator) {
	if (w !== 'sp') return;
	await hydrated(page);
	await c.getByRole('button', { name: /答弁を読む/ }).click();
}
/** 見出しが本文の前に読まれる（区画の文字の並びが「見出し → 本文」） */
async function readsAs(section: Locator, heading: string, body: string) {
	await expect(section.getByRole('heading', { name: heading, exact: true })).toBeVisible();
	const text = (await section.innerText()).replace(/\s+/g, '');
	expect(text.indexOf(heading.replace(/\s+/g, '')), text).toBe(0);
	expect(text.indexOf(body.replace(/\s+/g, '')), text).toBeGreaterThan(0);
}
const borderWidth = (l: Locator) => l.evaluate((el) => parseFloat(getComputedStyle(el).borderTopWidth) || 0);
const fontWeight = (l: Locator) => l.evaluate((el) => Number(getComputedStyle(el).fontWeight));

test('基準1：答弁に、その法案での役（提出者・共同提出者・賛同者）のタグが出る。見出しと二重に出さない', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 1);
	const co = await s.person(at(s.month, 5));
	const { path: bill, author, supporters } = await s.bill(at(s.month, 5), { cosponsor: co });
	const asker = await s.person(at(s.month, 16));

	const roles = [
		{ who: author, tag: '提出者' },
		{ who: co, tag: '共同提出者' },
		{ who: supporters[0], tag: '賛同者' }
	];
	for (const [i, r] of roles.entries()) {
		const q = `役のタグの質疑${i} ${s.label}`;
		await ok(await question(asker.page, bill, q));
		const id = await questionId(asker.page, bill, q);
		await r.who.setNow(at(s.month, 17));
		await ok(await answer(r.who.page, bill, id, `役のタグの答弁${i} ${s.label}`));
	}

	const v = await s.viewer(at(s.month, 17));
	await v.goto(qa(bill));
	for (const [i, r] of roles.entries()) {
		const c = card(v, `役のタグの質疑${i} ${s.label}`);
		await openAnswers(v, w, c);
		await readsAs(reply(v, `役のタグの答弁${i} ${s.label}`), `${r.tag}の答弁`, `役のタグの答弁${i} ${s.label}`);
		// いままでの「答弁（提出者）」の見出しは出さない（同じことを2回読ませない）
		await expect(c).not.toContainText('答弁（');
	}
});

test('基準2：委員長と理事が書いた質疑・答弁・補足に、委員会の名前と会期つきの「委員長」「理事」のタグが出る', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 2);
	const next = nextOf(s.month);

	// 5月：選挙。委員長と理事の2人は3週目に質疑を書いて立候補する（このときはまだ委員長でも理事でもない）
	const { path: first } = await s.bill(at(s.month, 5));
	const chair = await s.person(at(s.month, 16));
	const director = await s.person(at(s.month, 16));
	const before = `委員長になる前の質疑 ${s.label}`;
	for (const u of [chair, director]) await ok(await question(u.page, first, u === chair ? before : `理事になる前の質疑 ${s.label}`));
	// 6月に審議する法案（5月の締切のあとの発議）。委員長が賛同している
	const { path: bill } = await s.bill(at(s.month, 16), { supporter: chair });
	for (const u of [chair, director]) {
		await u.setNow(at(s.month, 22));
		const res = await billRequest(u.page, '/iinkai?/stand', { 'cf-turnstile-response': 'test-pass' });
		expect(res.status(), await res.text()).toBe(200);
	}
	// 投票資格のある人（4月に課題を書いた人）が2票と1票を入れる
	for (const whom of [chair, chair, director]) {
		const v = await s.person(at(prevOf(s.month), 10));
		await postIssue(v.page, { title: `前の月の課題 ${s.label} ${v.name}` });
		await v.setNow(at(s.month, 23));
		await v.page.goto('/iinkai');
		await hydrated(v.page);
		await v.page.getByRole('radio', { name: whom.name }).check();
		const [res] = await Promise.all([v.page.waitForResponse((r) => r.request().method() === 'POST'), v.page.getByRole('button', { name: '投票する', exact: true }).click()]);
		expect(await res.text()).not.toContain('"type":"failure"');
	}
	// 6月：確定させる
	await chair.setNow(at(next, 2));
	await chair.page.goto('/iinkai');
	await expect(chair.page.getByRole('region', { name: '委員長と理事' }).getByText(chair.name)).toBeVisible();

	// 6月の3週目：理事が質疑を書き、委員長（賛同者）が答弁し、理事が補足する
	const asker = await s.person(at(next, 16));
	for (const u of [chair, director]) await u.setNow(at(next, 16));
	const asked = `ふつうの人の質疑 ${s.label}`;
	const byDirector = `理事の質疑 ${s.label}`;
	const chairAnswer = `委員長の答弁 ${s.label}`;
	const directorSupplement = `理事の補足 ${s.label}`;
	await ok(await question(asker.page, bill, asked));
	await ok(await question(director.page, bill, byDirector));
	const id = await questionId(asker.page, bill, asked);
	await ok(await answer(chair.page, bill, id, chairAnswer));
	await ok(await supplement(director.page, bill, id, directorSupplement));

	const term = sessionName(next);
	const v = await s.viewer(at(next, 17));
	await v.goto(qa(bill));
	// 質疑：書いた人のタグが本文の前に読まれる
	const directorCard = card(v, byDirector);
	await expect(directorCard.getByText(`消費者保護委員会 理事（${term}）の質疑`)).toBeVisible();
	const directorText = (await directorCard.innerText()).replace(/\s+/g, '');
	expect(directorText.indexOf('理事')).toBeLessThan(directorText.indexOf(byDirector.replace(/\s+/g, '')));
	// 答弁：その法案での役と、委員長のタグ
	const c = card(v, asked);
	await openAnswers(v, w, c);
	await readsAs(reply(v, chairAnswer), `賛同者・消費者保護委員会 委員長（${term}）の答弁`, chairAnswer);
	// 補足：理事のタグ
	await readsAs(reply(v, directorSupplement), `消費者保護委員会 理事（${term}）の補足`, directorSupplement);
	// ふつうの人の質疑にはタグがない
	await expect(c.getByText(asked)).toBeVisible();
	const askedText = (await c.innerText()).replace(/\s+/g, '');
	expect(askedText.indexOf(asked.replace(/\s+/g, ''))).toBe(0);

	// 委員長になる前（5月の会期）に書いた質疑にはタグを付けない
	await v.goto(qa(first));
	await expect(card(v, before)).toBeVisible();
	await expect(card(v, before)).not.toContainText('委員長');
	await expect(card(v, `理事になる前の質疑 ${s.label}`)).not.toContainText('理事（');
});

test('基準3：質疑を書いた人が同じ質疑に補足を書くと、その補足に「質問者」のタグが出る', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 3);
	const { path: bill } = await s.bill(at(s.month, 5));
	const asker = await s.person(at(s.month, 16));
	const other = await s.person(at(s.month, 16));

	const mine = `質問者の質疑 ${s.label}`;
	const theirs = `ほかの人の質疑 ${s.label}`;
	await ok(await question(asker.page, bill, mine));
	await ok(await question(other.page, bill, theirs));
	const mineId = await questionId(asker.page, bill, mine);
	const theirsId = await questionId(asker.page, bill, theirs);
	const own = `自分の質疑への補足 ${s.label}`;
	const others = `ほかの人の補足 ${s.label}`;
	const elsewhere = `ほかの質疑への補足 ${s.label}`;
	await ok(await supplement(asker.page, bill, mineId, own));
	await ok(await supplement(other.page, bill, mineId, others));
	// 質疑を書いた人でも、ほかの人の質疑への補足は質問者ではない
	await ok(await supplement(asker.page, bill, theirsId, elsewhere));

	const v = await s.viewer(at(s.month, 17));
	await v.goto(qa(bill));
	await readsAs(reply(v, own), '質問者の補足', own);
	await expect(reply(v, others).getByRole('heading', { name: '補足', exact: true })).toBeVisible();
	await expect(reply(v, others)).not.toContainText('質問者');
	await expect(reply(v, elsewhere).getByRole('heading', { name: '補足', exact: true })).toBeVisible();
	await expect(reply(v, elsewhere)).not.toContainText('質問者');
});

test('基準4：有識者は認証バッジ（枠付きの札）だけで、タグは足さない。タグは枠のない太字の文字で、形と文言で見分けられる', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 4);
	const { path: bill } = await s.bill(at(s.month, 5));
	const op = await s.person(at(s.month, 3), { role: 'operator' });
	const expert = await s.person(at(s.month, 3));
	const expertName = `試験 花子 ${s.label}`;
	await ok(await billRequest(op.page, '/kanri?/verifyGrant', { target: expert.name, kind: 'expert', name: expertName, field: '消費者法' }));

	const asker = await s.person(at(s.month, 16));
	await expert.setNow(at(s.month, 16));
	const q = `有識者に聞く質疑 ${s.label}`;
	await ok(await question(asker.page, bill, q));
	const id = await questionId(asker.page, bill, q);
	const fromExpert = `有識者の補足 ${s.label}`;
	const fromAsker = `質問者の補足 ${s.label}`;
	await ok(await supplement(expert.page, bill, id, fromExpert));
	await ok(await supplement(asker.page, bill, id, fromAsker));

	const v = await s.viewer(at(s.month, 17));
	await v.goto(qa(bill));
	// 有識者：名前と認証バッジが本文の前に読まれ、役のタグは足さない（「有識者」は札の中の1回だけ）
	const e = reply(v, fromExpert);
	const heading = e.getByRole('heading', { level: 3 });
	await expect(heading).toContainText(expertName);
	await expect(heading).toContainText('有識者（消費者法）');
	expect(((await heading.innerText()).match(/有識者/g) ?? []).length).toBe(1);
	await expect(heading).not.toContainText('質問者');
	const badge = heading.getByText('有識者（消費者法）', { exact: true });
	// 質問者のタグ
	const a = reply(v, fromAsker);
	await readsAs(a, '質問者の補足', fromAsker);
	const tag = a.getByText('質問者', { exact: true });
	// 形：バッジは枠付きの札、タグは枠のない太字の文字
	expect(await borderWidth(badge)).toBeGreaterThan(0);
	expect(await borderWidth(tag)).toBe(0);
	expect(await fontWeight(tag)).toBeGreaterThanOrEqual(700);
});
