// Issue #181：答弁イベントの質問と答弁。告知と一覧は e2e/toben.spec.ts（#153）
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { ORIGIN, issueWithSolutions, loginAs, stubTurnstile } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});

test.use({ actionTimeout: 15_000 });

type Width = 'sp' | 'pc';
/** 基準ごと・幅ごとの月（選挙の期間がほかの基準とぶつからないように）。基準1は登録から7日を確かめるため、いまの日付の近くを使う */
const MONTHS: Record<string, Record<Width, string>> = {
	c2: { sp: '2050-03', pc: '2050-04' },
	c3: { sp: '2050-05', pc: '2050-06' },
	c4: { sp: '2050-07', pc: '2050-08' },
	c5: { sp: '2050-09', pc: '2050-10' },
	c6: { sp: '2050-11', pc: '2050-12' },
	c7: { sp: '2051-01', pc: '2051-02' }
};
const pad = (n: number) => String(n).padStart(2, '0');
const at = (month: string, day: number, time = '09:00') => `${month}-${pad(day)}T${time}:00+09:00`;
const local = (month: string, day: number, time: string) => `${month}-${pad(day)}T${time}`;

type User = { page: Page; name: string; setNow: (now: string) => Promise<void> };

let serial = 0;
async function user(browser: Browser, w: Width, who: string, now: string, opts: { role?: 'operator'; days?: number } = {}): Promise<User> {
	const n = ++serial;
	const headers = { 'x-test-ip': `10.181.${w === 'sp' ? 1 : 2}.${n % 250}` };
	const context = await browser.newContext({ baseURL: ORIGIN, extraHTTPHeaders: { ...headers, 'x-test-now': now } });
	contexts.push(context);
	const page = await context.newPage();
	await stubTurnstile(page);
	const name = `${who}${w}${Date.now() % 1e7}${n}`;
	if (who !== 'anon') await loginAs(page, name, opts.days ?? 8, opts.role);
	return { page, name, setNow: (t) => context.setExtraHTTPHeaders({ ...headers, 'x-test-now': t }) };
}

const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });

async function posted(u: Page, act: () => Promise<void>) {
	await Promise.all([u.waitForResponse((r) => r.request().method() === 'POST'), act()]);
	await u.waitForLoadState('networkidle');
}

/** 運営の画面で議員の認証を付ける。表示する名前を返す */
async function grant(op: Page, target: string) {
	const name = `答弁 議員${target.slice(-6)}`;
	await op.goto('/kanri');
	await hydrated(op);
	const s = op.getByRole('region', { name: '議員・有識者の認証' });
	await s.getByLabel('表示名').fill(target);
	await s.getByRole('group', { name: '種類' }).getByRole('radio', { name: '議員', exact: true }).check();
	await s.getByLabel('表示する名前').fill(name);
	await posted(op, () => s.getByRole('button', { name: '認証を付ける' }).click());
	await op.goto('/kanri');
	await expect(s.getByRole('listitem').filter({ hasText: target })).toHaveCount(1);
	return name;
}

/** 告知する（ダッシュボードから入る）。イベントのパスを返す */
async function announce(p: Page, f: { id: number; title: string; starts: string; ends: string }) {
	await p.goto('/giin');
	await p.getByRole('link', { name: '答弁イベントを告知する' }).click();
	await expect(p).toHaveURL(/\/toben\/kaku$/);
	await hydrated(p);
	await p.getByRole('group', { name: '対象' }).getByRole('radio', { name: '課題', exact: true }).check();
	await p.getByLabel('対象の番号').fill(String(f.id));
	await p.getByLabel('題', { exact: true }).fill(f.title);
	await p.getByLabel('開始').fill(f.starts);
	await p.getByLabel('終了').fill(f.ends);
	await posted(p, () => p.getByRole('button', { name: '告知する' }).click());
	await expect(p).toHaveURL(/\/toben\/\d+$/);
	return new URL(p.url()).pathname;
}

/**
 * 3日に A が課題を書き、P を議員にして、10日 14:00〜16:00 の回を告知する。
 * month は 'YYYY-MM'
 */
async function setup(browser: Browser, w: Width, month: string) {
	const now = at(month, 3);
	const a = await user(browser, w, 'a', now);
	const tag = `${w}${Date.now() % 1e7}`;
	const { issueId } = await issueWithSolutions(a.page, `181-${tag}`, [`解決策 ${tag}`]);
	const op = await user(browser, w, 'op', now, { role: 'operator' });
	const p = await user(browser, w, 'p', now);
	const name = await grant(op.page, p.name);
	const title = `議員と話す回 ${tag}`;
	const path = await announce(p.page, { id: issueId, title, starts: local(month, 10, '14:00'), ends: local(month, 10, '16:00') });
	return { a, op, p, name, issueId, tag, title, path };
}

const questions = (page: Page) => page.getByRole('region', { name: '質問' });
const card = (page: Page, text: string) => questions(page).getByRole('article').filter({ hasText: text });
const post = (page: Page, path: string, form: Record<string, string>) =>
	page.request.post(path, { form, headers: { origin: ORIGIN, accept: 'text/html' }, maxRedirects: 0 });

/** 質問を書く（画面から） */
async function ask(u: Page, path: string, body: string) {
	await u.goto(path);
	await hydrated(u);
	await questions(u).getByLabel('質問の内容').fill(body);
	await posted(u, () => questions(u).getByRole('button', { name: '質問を送る' }).click());
}

/** 答弁を書く（画面から） */
async function answer(p: Page, path: string, question: string, body: string) {
	await p.goto(path);
	await hydrated(p);
	const c = card(p, question);
	await c.getByLabel('答弁の内容').fill(body);
	await posted(p, () => c.getByRole('button', { name: '答弁を送る' }).click());
}

/** 質問の番号（画面のフォームの値から） */
const questionId = async (page: Page, path: string, text: string) => {
	await page.goto(path);
	return (await card(page, text).getAttribute('data-question')) ?? '';
};

test('基準1：告知から開始までは参加者が質問を書ける。1人1件・400字まで・登録から7日と Turnstile。直せず消せない。議員は書けない', async ({ browser }, info) => {
	test.setTimeout(180_000);
	const w = info.project.name as Width;
	// 登録から7日を確かめるため、いまの日付を基準にする（テスト用のログインの登録日は、いまから数える）
	const jst = new Date(Date.now() + 9 * 3600_000);
	const base = jst.getUTCDate();
	const day = (n: number, time = '09:00') => {
		const d = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), base + n));
		return { at: `${d.toISOString().slice(0, 10)}T${time}:00+09:00`, local: `${d.toISOString().slice(0, 10)}T${time}` };
	};
	const a = await user(browser, w, 'a', day(0).at, { days: 30 });
	const tag = `${w}${Date.now() % 1e7}`;
	const { issueId } = await issueWithSolutions(a.page, `181-1-${tag}`, [`解決策 ${tag}`]);
	const op = await user(browser, w, 'op', day(0).at, { role: 'operator' });
	const p = await user(browser, w, 'p', day(0).at, { days: 30 });
	await grant(op.page, p.name);
	const path = await announce(p.page, { id: issueId, title: `質問を受ける回 ${tag}`, starts: day(5, '14:00').local, ends: day(5, '15:00').local });

	// 登録から7日たっていない人は書けない（いつから書けるかを出す）
	const fresh = await user(browser, w, 'f', day(1).at, { days: 0 });
	await fresh.page.goto(path);
	await expect(questions(fresh.page)).toContainText(/登録から7日たつと、答弁イベントに質問を書けます。\d+月\d+日 \d+時\d{2}分から書けます。/);
	await expect(questions(fresh.page).getByRole('button', { name: '質問を送る' })).toHaveCount(0);
	expect((await post(fresh.page, `${path}?/ask`, { body: `新しい人の質問 ${tag}`, 'cf-turnstile-response': 'test-pass' })).status()).toBe(403);

	// 400字を超えると断る。Turnstile がなければ断る
	await a.setNow(day(1).at);
	expect((await post(a.page, `${path}?/ask`, { body: 'あ'.repeat(401), 'cf-turnstile-response': 'test-pass' })).status()).toBe(400);
	expect((await post(a.page, `${path}?/ask`, { body: `Turnstile なし ${tag}`, 'cf-turnstile-response': '' })).status()).toBe(400);

	// 書ける。名前と一緒に出る。直す・消すのボタンはない
	const body = `自転車の通行区分はどう変わりますか ${tag}`;
	await ask(a.page, path, body);
	await expect(card(a.page, body)).toContainText(a.name);
	await expect(card(a.page, body).getByRole('button', { name: /直す|消す|取り下げ/ })).toHaveCount(0);
	// 1人1件
	await expect(questions(a.page).getByRole('button', { name: '質問を送る' })).toHaveCount(0);
	await expect(questions(a.page)).toContainText('質問は1人1件です');
	expect((await post(a.page, `${path}?/ask`, { body: `2件目 ${tag}`, 'cf-turnstile-response': 'test-pass' })).status()).toBe(409);
	await a.page.goto(path);
	await expect(questions(a.page)).not.toContainText(`2件目 ${tag}`);

	// 議員は書けない（書く欄を出さず、送っても断る）
	await p.setNow(day(1).at);
	await p.page.goto(path);
	await expect(questions(p.page).getByRole('button', { name: '質問を送る' })).toHaveCount(0);
	expect((await post(p.page, `${path}?/ask`, { body: `議員の質問 ${tag}`, 'cf-turnstile-response': 'test-pass' })).status()).toBe(403);

	// ログインしていない人には、ログインへの案内を出す
	const anon = await user(browser, w, 'anon', day(1).at);
	await anon.page.goto(path);
	await expect(questions(anon.page).getByRole('link', { name: 'ログイン' })).toBeVisible();
});

test('基準2：開始までは「わたしも聞きたい」を付け外しでき、数の多い順（同じなら古い順）に並ぶ。自分の質問と議員は付けられない', async ({ browser }, info) => {
	test.setTimeout(180_000);
	const w = info.project.name as Width;
	const month = MONTHS.c2[w];
	const { a, p, path, tag } = await setup(browser, w, month);
	const b = await user(browser, w, 'b', at(month, 4));
	const c = await user(browser, w, 'c', at(month, 4));
	const d = await user(browser, w, 'd', at(month, 4));
	await a.setNow(at(month, 4));
	const q1 = `先に書いた質問 ${tag}`;
	const q2 = `あとに書いた質問 ${tag}`;
	await ask(a.page, path, q1);
	await ask(b.page, path, q2);
	const order = async (page: Page) => (await questions(page).getByRole('article').allInnerTexts()).map((t) => (t.includes(q1) ? 'q1' : t.includes(q2) ? 'q2' : '?'));
	const press = async (u: Page, text: string) => {
		await u.goto(path);
		await hydrated(u);
		await posted(u, () => card(u, text).getByRole('button', { name: 'わたしも聞きたい' }).click());
	};
	// 何も付いていなければ古い順
	await c.page.goto(path);
	expect(await order(c.page)).toEqual(['q1', 'q2']);
	// q2 に2人が付けると、q2 が先になり、数を出す
	await press(c.page, q2);
	await press(d.page, q2);
	await expect(card(d.page, q2)).toContainText('わたしも聞きたい 2');
	expect(await order(d.page)).toEqual(['q2', 'q1']);
	await expect(card(d.page, q2).getByRole('button', { name: 'わたしも聞きたい' })).toHaveAttribute('aria-pressed', 'true');
	// 外せる。同じ数なら古い順
	await press(d.page, q2);
	await press(c.page, q1);
	await expect(card(c.page, q1)).toContainText('わたしも聞きたい 1');
	await expect(card(c.page, q2)).toContainText('わたしも聞きたい 1');
	expect(await order(c.page)).toEqual(['q1', 'q2']);
	// 自分の質問には付けられない
	await b.page.goto(path);
	await expect(card(b.page, q2).getByRole('button', { name: 'わたしも聞きたい' })).toHaveCount(0);
	const id2 = await questionId(b.page, path, q2);
	expect((await post(b.page, `${path}?/want`, { question: id2, op: 'add' })).status()).toBe(403);
	// 議員は付けられない
	await p.setNow(at(month, 4));
	await p.page.goto(path);
	await expect(questions(p.page).getByRole('button', { name: 'わたしも聞きたい' })).toHaveCount(0);
	expect((await post(p.page, `${path}?/want`, { question: id2, op: 'add' })).status()).toBe(403);
	// 開始のあとは付け外しできない
	await d.setNow(at(month, 10, '14:00'));
	await d.page.goto(path);
	await expect(questions(d.page).getByRole('button', { name: 'わたしも聞きたい' })).toHaveCount(0);
	await expect(card(d.page, q2)).toContainText('わたしも聞きたい 1');
	expect((await post(d.page, `${path}?/want`, { question: id2, op: 'add' })).status()).toBe(409);
});

test('基準3：開始から終了までは、告知した議員が質問ごとに答弁を1件書け、終了まで直せる。名前と印を付けて出す。ほかの人は書けない', async ({ browser }, info) => {
	test.setTimeout(180_000);
	const w = info.project.name as Width;
	const month = MONTHS.c3[w];
	const { a, op, p, name, path, tag } = await setup(browser, w, month);
	await a.setNow(at(month, 4));
	const q = `答弁してほしい質問 ${tag}`;
	await ask(a.page, path, q);
	const id = await questionId(a.page, path, q);
	// 開始の前は答弁できない
	await p.setNow(at(month, 9));
	await p.page.goto(path);
	await expect(card(p.page, q).getByLabel('答弁の内容')).toHaveCount(0);
	expect((await post(p.page, `${path}?/answer`, { question: id, body: `早すぎる答弁 ${tag}` })).status()).toBe(409);
	// 開催中は書ける。800字を超えると断る
	await p.setNow(at(month, 10, '14:30'));
	expect((await post(p.page, `${path}?/answer`, { question: id, body: 'あ'.repeat(801) })).status()).toBe(400);
	const first = `検討しています ${tag}`;
	await answer(p.page, path, q, first);
	const viewer = await user(browser, w, 'anon', at(month, 10, '14:40'));
	await viewer.page.goto(path);
	const answered = card(viewer.page, q).getByRole('region', { name: '答弁' });
	await expect(answered).toContainText(first);
	await expect(answered).toContainText(name);
	await expect(answered).toContainText('認証済み議員');
	// 直せる。直したら「直しました」
	await p.page.goto(path);
	await hydrated(p.page);
	await card(p.page, q).getByRole('button', { name: '答弁を直す' }).click();
	const fixed = `来月の委員会で取り上げます ${tag}`;
	await card(p.page, q).getByLabel('答弁の内容').fill(fixed);
	await posted(p.page, () => card(p.page, q).getByRole('button', { name: '答弁を送る' }).click());
	await viewer.page.goto(path);
	await expect(answered).toContainText(fixed);
	await expect(answered).not.toContainText(first);
	await expect(answered).toContainText('直しました');
	// ほかの議員と参加者は書けない
	const q2 = await user(browser, w, 'q', at(month, 10, '14:30'));
	await grant(op.page, q2.name);
	for (const u of [q2, a]) {
		await u.setNow(at(month, 10, '14:30'));
		await u.page.goto(path);
		await expect(card(u.page, q).getByLabel('答弁の内容')).toHaveCount(0);
		expect((await post(u.page, `${path}?/answer`, { question: id, body: `ほかの人の答弁 ${tag}` })).status()).toBe(403);
	}
});

test('基準4：答弁が付くと、質問を書いた人に通知が届く。直したときは送らない', async ({ browser }, info) => {
	test.setTimeout(150_000);
	const w = info.project.name as Width;
	const month = MONTHS.c4[w];
	const { a, p, path, tag, title } = await setup(browser, w, month);
	await a.setNow(at(month, 4));
	const q = `通知の質問 ${tag}`;
	await ask(a.page, path, q);
	await p.setNow(at(month, 10, '14:30'));
	await answer(p.page, path, q, `通知の答弁 ${tag}`);
	await p.page.goto(path);
	await hydrated(p.page);
	await card(p.page, q).getByRole('button', { name: '答弁を直す' }).click();
	await card(p.page, q).getByLabel('答弁の内容').fill(`直した答弁 ${tag}`);
	await posted(p.page, () => card(p.page, q).getByRole('button', { name: '答弁を送る' }).click());
	await a.setNow(at(month, 10, '15:00'));
	await a.page.goto('/tsuchi');
	const item = a.page.getByRole('main').getByRole('listitem').filter({ hasText: 'あなたの質問に議員が答弁しました' });
	await expect(item).toHaveCount(1);
	await expect(item).toContainText(title);
	await expect(item.getByRole('link')).toHaveAttribute('href', path);
});

test('基準5：開始で質問と「わたしも聞きたい」、終了で答弁を締め切る。終わったあとも記録として出し、評価のボタンは出さない。取り消した回には書けない', async ({ browser }, info) => {
	test.setTimeout(180_000);
	const w = info.project.name as Width;
	const month = MONTHS.c5[w];
	const { a, p, issueId, path, tag } = await setup(browser, w, month);
	const b = await user(browser, w, 'b', at(month, 4));
	const c = await user(browser, w, 'c', at(month, 4));
	await a.setNow(at(month, 4));
	const q = `記録に残る質問 ${tag}`;
	await ask(a.page, path, q);
	await c.page.goto(path);
	await hydrated(c.page);
	await posted(c.page, () => card(c.page, q).getByRole('button', { name: 'わたしも聞きたい' }).click());
	// 開始のあとは質問を書けない
	await b.setNow(at(month, 10, '14:00'));
	await b.page.goto(path);
	await expect(questions(b.page).getByRole('button', { name: '質問を送る' })).toHaveCount(0);
	await expect(questions(b.page)).toContainText('質問の受け付けは終わりました');
	expect((await post(b.page, `${path}?/ask`, { body: `遅れた質問 ${tag}`, 'cf-turnstile-response': 'test-pass' })).status()).toBe(409);
	await p.setNow(at(month, 10, '15:00'));
	const ans = `記録に残る答弁 ${tag}`;
	await answer(p.page, path, q, ans);
	// 終了のあとは答弁を書けない
	const id = await questionId(p.page, path, q);
	await p.setNow(at(month, 10, '16:00'));
	await p.page.goto(path);
	await expect(card(p.page, q).getByRole('button', { name: '答弁を直す' })).toHaveCount(0);
	expect((await post(p.page, `${path}?/answer`, { question: id, body: `遅れた答弁 ${tag}` })).status()).toBe(409);
	// 記録として出す（ログインしていない人にも）。評価のボタンはない
	const viewer = await user(browser, w, 'anon', at(month, 20));
	await viewer.page.goto(path);
	await expect(card(viewer.page, q)).toContainText('わたしも聞きたい 1');
	await expect(card(viewer.page, q)).toContainText(ans);
	await expect(viewer.page.getByRole('main').getByRole('button', { name: /筋が通っている|わたしも聞きたい|質問を送る|答弁を送る/ })).toHaveCount(0);

	// 取り消した回には書けない。すでにある質問は出したまま
	await p.setNow(at(month, 4));
	const other = await announce(p.page, { id: issueId, title: `取り消す回 ${tag}`, starts: local(month, 12, '14:00'), ends: local(month, 12, '15:00') });
	const kept = `取り消す回への質問 ${tag}`;
	await ask(a.page, other, kept);
	await p.page.goto(other);
	await hydrated(p.page);
	await posted(p.page, () => p.page.getByRole('button', { name: '取り消す' }).click());
	await b.setNow(at(month, 5));
	await b.page.goto(other);
	await expect(card(b.page, kept)).toHaveCount(1);
	await expect(questions(b.page).getByRole('button', { name: '質問を送る' })).toHaveCount(0);
	expect((await post(b.page, `${other}?/ask`, { body: `取り消した回への質問 ${tag}`, 'cf-turnstile-response': 'test-pass' })).status()).toBe(409);
});

test('基準6：選挙期間中は、過去の答弁の議員名も出さない。選挙で中止になった回には書けない', async ({ browser }, info) => {
	test.setTimeout(180_000);
	const w = info.project.name as Width;
	const month = MONTHS.c6[w];
	const { a, op, p, name, issueId, path, tag } = await setup(browser, w, month);
	await a.setNow(at(month, 4));
	const q = `選挙の前の質問 ${tag}`;
	await ask(a.page, path, q);
	// 20日の回を先に告知しておく
	await p.setNow(at(month, 4));
	const later = await announce(p.page, { id: issueId, title: `選挙で中止になる回 ${tag}`, starts: local(month, 20, '14:00'), ends: local(month, 20, '15:00') });
	await p.setNow(at(month, 10, '14:30'));
	const ans = `選挙の前の答弁 ${tag}`;
	await answer(p.page, path, q, ans);
	// 選挙を登録する（15日〜25日）
	await op.setNow(at(month, 11));
	await op.page.goto('/kanri');
	await hydrated(op.page);
	const elections = op.page.getByRole('region', { name: '選挙期間' });
	await elections.getByLabel('選挙の名前').fill(`答弁の選挙 ${tag}`);
	await elections.getByLabel('公示日').fill(`${month}-15`);
	await elections.getByLabel('投票日').fill(`${month}-25`);
	await posted(op.page, () => elections.getByRole('button', { name: '選挙を登録する' }).click());
	// 期間中は、過去の答弁の議員名を出さない
	const viewer = await user(browser, w, 'anon', at(month, 16));
	await viewer.page.goto(path);
	const answered = card(viewer.page, q).getByRole('region', { name: '答弁' });
	await expect(answered).toContainText(ans);
	await expect(answered).toContainText('議員（選挙期間中のため名前を出していません）');
	await expect(viewer.page.getByRole('main')).not.toContainText(name);
	// 中止になった回には書けない
	await a.setNow(at(month, 16));
	await a.page.goto(later);
	await expect(questions(a.page).getByRole('button', { name: '質問を送る' })).toHaveCount(0);
	expect((await post(a.page, `${later}?/ask`, { body: `中止の回への質問 ${tag}`, 'cf-turnstile-response': 'test-pass' })).status()).toBe(409);
});

test('基準7：質問と答弁は3人の通報で一時的に見えなくなり、運営が表示に戻せる。自分のものは通報できない。運営の記録に残る', async ({ browser }, info) => {
	test.setTimeout(240_000);
	const w = info.project.name as Width;
	const month = MONTHS.c7[w];
	const { a, op, p, path, tag } = await setup(browser, w, month);
	await a.setNow(at(month, 4));
	const q = `通報される質問 ${tag}`;
	await ask(a.page, path, q);
	await p.setNow(at(month, 10, '14:30'));
	const ans = `通報される答弁 ${tag}`;
	await answer(p.page, path, q, ans);
	// 自分の質問は通報できない
	const id = await questionId(a.page, path, q);
	await a.setNow(at(month, 10, '14:40'));
	await a.page.goto(path);
	await expect(card(a.page, q).getByRole('button', { name: '質問を通報する' })).toHaveCount(0);
	expect((await post(a.page, `${path}?/report`, { kind: 'question', target: id, reason: 'spam' })).status()).toBe(403);

	const reporters = await Promise.all(['r1', 'r2', 'r3'].map((who) => user(browser, w, who, at(month, 10, '14:40'))));
	// 答弁を3人が通報すると、答弁が見えなくなる（質問は出たまま）
	for (const r of reporters) {
		await r.page.goto(path);
		await hydrated(r.page);
		const c = card(r.page, q);
		await c.getByRole('button', { name: '答弁を通報する' }).click();
		await c.getByRole('radio', { name: '宣伝・荒らし' }).check();
		await posted(r.page, () => c.getByRole('button', { name: '通報を送る' }).click());
	}
	const viewer = await user(browser, w, 'anon', at(month, 10, '14:50'));
	await viewer.page.goto(path);
	await expect(card(viewer.page, q)).toHaveCount(1);
	await expect(card(viewer.page, q)).not.toContainText(ans);
	// 質問を3人が通報すると、質問が見えなくなる。書いた人には、見えなくなっていることを出す
	for (const r of reporters) {
		await r.page.goto(path);
		await hydrated(r.page);
		const c = card(r.page, q);
		await c.getByRole('button', { name: '質問を通報する' }).click();
		await c.getByRole('radio', { name: '宣伝・荒らし' }).check();
		await posted(r.page, () => c.getByRole('button', { name: '通報を送る' }).click());
	}
	await viewer.page.goto(path);
	await expect(questions(viewer.page)).not.toContainText(q);
	await a.page.goto(path);
	await expect(card(a.page, q)).toContainText('この質問は、いま見えなくなっています');

	// 運営が表示に戻す
	await op.setNow(at(month, 10, '15:00'));
	await op.page.goto('/kanri');
	await hydrated(op.page);
	const reported = op.page.getByRole('region', { name: '通報を受けた答弁イベントの質問と答弁' }).getByRole('article');
	for (const text of [q, ans]) {
		const row = reported.filter({ hasText: text });
		await row.getByLabel('表示に戻すメモ').fill('問題のない投稿');
		await posted(op.page, () => row.getByRole('button', { name: '表示に戻す' }).click());
		await op.page.goto('/kanri');
		await hydrated(op.page);
	}
	await viewer.page.goto(path);
	await expect(card(viewer.page, q)).toContainText(ans);
	// 運営の記録に残る
	await viewer.page.goto('/unei');
	const rows = viewer.page.getByRole('region', { name: '答弁イベントへの対応' }).getByRole('row').filter({ hasText: tag });
	await expect(rows.filter({ hasText: '自動で非表示' })).toHaveCount(2);
	await expect(rows.filter({ hasText: '表示に戻した' }).filter({ hasText: '質問' })).toHaveCount(1);
	await expect(rows.filter({ hasText: '表示に戻した' }).filter({ hasText: '答弁' })).toHaveCount(1);
});
