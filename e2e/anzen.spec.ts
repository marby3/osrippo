// Issue #196 公開前の安全策のうちコードでやるもの（#190 決めたこと8）：非公式の表示と、登録・投稿・投票の Turnstile。
// 送信先ごとの一覧とレート制限は docs/safety.md
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { ORIGIN, billSupportRequest, createAmendBill, issueWithSolutions, loginAs, proposeRequest, stubTurnstile } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});
test.use({ actionTimeout: 15_000 });

type Width = 'sp' | 'pc';
/** 幅ごとに別の月（ほかのテストが使わない年） */
const MONTH: Record<Width, string> = { sp: '2600-05', pc: '2600-09' };
const pad = (n: number) => String(n).padStart(2, '0');
const at = (month: string, day: number) => `${month}-${pad(day)}T09:00:00+09:00`;
const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });

type User = { page: Page; name: string };
let serial = 0;
async function user(browser: Browser, w: Width, who: string, now: string, role?: 'operator'): Promise<User> {
	const n = ++serial;
	const context = await browser.newContext({ baseURL: ORIGIN, extraHTTPHeaders: { 'x-test-ip': `10.196.${w === 'sp' ? 1 : 2}.${n}`, 'x-test-now': now } });
	contexts.push(context);
	const page = await context.newPage();
	await stubTurnstile(page);
	const name = `${who}${w}${Date.now() % 1e7}${n}`;
	if (who !== 'anon') await loginAs(page, name, 8, role);
	return { page, name };
}

const LAW = '412AC0000000061';

test('基準1：どの画面のフッターにも、非公式の表示が出る', async ({ browser }, info) => {
	test.setTimeout(90_000);
	const w = info.project.name as Width;
	const v = await user(browser, w, 'anon', at(MONTH[w], 2));
	const pages = ['/', '/kadai', '/houan', '/hourei', `/hourei/${LAW}`, `/if/hourei/${LAW}`, '/toukei', '/login'];
	for (const path of pages) {
		const res = await v.page.goto(path);
		expect(res?.status(), path).toBe(200);
		await expect(v.page.getByRole('contentinfo'), path).toBeVisible();
		await expect(v.page.getByRole('contentinfo'), path).toContainText('国会・政府とは無関係の非公式サービスです');
	}
	// 見つからないときのページにも
	const missing = await v.page.goto('/kadai/999999999');
	expect(missing?.status()).toBe(404);
	await expect(v.page.getByRole('contentinfo')).toBeVisible();
	await expect(v.page.getByRole('contentinfo')).toContainText('国会・政府とは無関係の非公式サービスです');
});

/** 運営の画面で認証を付ける */
async function grant(op: Page, target: string, kind: '議員' | '有識者') {
	await op.goto('/kanri');
	await hydrated(op);
	const s = op.getByRole('region', { name: '議員・有識者の認証' });
	await s.getByLabel('表示名').fill(target);
	await s.getByRole('group', { name: '種類' }).getByRole('radio', { name: kind, exact: true }).check();
	await s.getByLabel('表示する名前').fill(`安全 ${kind}${target.slice(-6)}`);
	if (kind === '有識者') await s.getByLabel('専門分野').fill('消費者法');
	await Promise.all([op.waitForResponse((r) => r.request().method() === 'POST'), s.getByRole('button', { name: '認証を付ける' }).click()]);
	await op.goto('/kanri');
	await expect(s.getByRole('listitem').filter({ hasText: target })).toHaveCount(1);
}

/** 議員が答弁イベントを告知する。イベントのパスを返す */
async function announce(p: Page, issueId: number, title: string, month: string) {
	await p.goto('/toben/kaku');
	await hydrated(p);
	await p.getByRole('group', { name: '対象' }).getByRole('radio', { name: '課題', exact: true }).check();
	await p.getByLabel('対象の番号').fill(String(issueId));
	await p.getByLabel('題', { exact: true }).fill(title);
	await p.getByLabel('開始').fill(`${month}-20T14:00`);
	await p.getByLabel('終了').fill(`${month}-20T16:00`);
	await Promise.all([p.waitForURL(/\/toben\/\d+$/), p.getByRole('button', { name: '告知する' }).click()]);
	return new URL(p.url()).pathname;
}

/**
 * 画面のフォームと同じ POST を、Turnstile のトークンなし（token を省く）か、通らないトークンで送る。now を渡すと、その時刻に送る。
 * フォームのトークンの受け渡しは、それぞれの画面のテストが確かめる。ここは送信先が断ることだけを、全部の送信先でまとめて確かめる
 */
const send = (page: Page, path: string, form: Record<string, string>, token: string | null, now?: string) =>
	page.request.post(path, {
		form: token === null ? form : { ...form, 'cf-turnstile-response': token },
		headers: { origin: ORIGIN, accept: 'text/html', ...(now ? { 'x-test-now': now } : {}) },
		maxRedirects: 0
	});

test('基準2：登録・投稿・投票の送信先は、Turnstile のトークンがない送信と通らない送信を断る', async ({ browser }, info) => {
	test.setTimeout(180_000);
	const w = info.project.name as Width;
	const month = MONTH[w];
	const tag = `${w}${Date.now() % 1e7}`;

	// 5日：A が法案を発議する（B・C・D が賛同）。運営が有識者 E と議員 P を認証し、P が答弁イベントを告知する
	const a = await user(browser, w, 'a', at(month, 5));
	const { issueId, ids } = await issueWithSolutions(a.page, `196-${tag}`, [`解決策 ${tag}`]);
	const bill = await createAmendBill(a.page, `安全策の法案 ${tag}`, ids[0]);
	const billId = bill.replace('/houan/', '');
	for (const who of ['b', 'c', 'd']) {
		const s = await user(browser, w, who, at(month, 5));
		expect((await billSupportRequest(s.page, bill, { op: 'add', rev: '1' })).status()).toBe(200);
	}
	expect((await proposeRequest(a.page, bill)).status()).toBe(200);
	const op = await user(browser, w, 'op', at(month, 5), 'operator');
	const e = await user(browser, w, 'e', at(month, 5));
	await grant(op.page, e.name, '有識者');
	const p = await user(browser, w, 'p', at(month, 5));
	await grant(op.page, p.name, '議員');
	const toben = await announce(p.page, issueId, `安全策の回 ${tag}`, month);

	const v = await user(browser, w, 'v', at(month, 5));
	// V の下書き（保存の送信先を確かめる）
	const draft = await createAmendBill(v.page, `安全策の下書き ${tag}`, ids[0]);
	const guest = await user(browser, w, 'anon', at(month, 5));
	const { revisionId } = (await (await v.page.request.get(`/houan/kaku/joubun?law=${LAW}`)).json()) as { revisionId: string };

	// 本案の投票の画面は採決の週の外だと法案のページへ送り返すので、本案の票は22日に送る（断った応答をそのまま見るため）。
	// 修正案と委員長選挙の票は時期より先に Turnstile を確かめるが、そろえて採決の週に送る
	const voteWeek = at(month, 22);
	type Case = { what: string; page: Page; path: string; form: Record<string, string>; now?: string };
	const billForm = { kind: 'amend', title: `法案 ${tag}`, law: LAW, base: revisionId, 'op.0': 'amend', 'target.0': '1', 'caption.0': '（目的）', 'body.0': '本文', affected: '人', sideEffects: 'なし', solution: ids[0] };
	const cases: Case[] = [
		// 登録（ログイン）
		{ what: 'ログイン（Google）', page: guest.page, path: '/login?/google', form: { next: '/' } },
		{ what: 'ログイン（LINE）', page: guest.page, path: '/login?/line', form: { next: '/' } },
		// 投稿
		{ what: '課題', page: v.page, path: '/kadai/kaku', form: { title: `課題 ${tag}`, affected: '困っている人', example: '具体例', topic: 'none' } },
		{ what: '解決策', page: v.page, path: `/kadai/${issueId}/kaiketsu/kaku`, form: { body: `解決策 ${tag}` } },
		{ what: '法案の下書きを作る', page: v.page, path: '/houan/kaku', form: billForm },
		{ what: '法案の下書きを保存する', page: v.page, path: `${draft}/kaku`, form: { ...billForm, rev: '1' } },
		{ what: '質疑', page: v.page, path: `${bill}/shitsugi/kaku`, form: { body: `質疑 ${tag}` } },
		{ what: '答弁', page: a.page, path: `${bill}/shitsugi?/answer`, form: { question: '1', body: `答弁 ${tag}` } },
		{ what: '補足', page: v.page, path: `${bill}/shitsugi?/supplement`, form: { question: '1', body: `補足 ${tag}` } },
		{ what: '修正案', page: v.page, path: `${bill}/shusei/kaku`, form: { article: '0:1', body: '本文', rev: '1' } },
		{ what: '専門家の解説', page: e.page, path: `${bill}?/commentary`, form: { body: `解説 ${tag}` } },
		{ what: '答弁イベントの質問', page: v.page, path: `${toben}?/ask`, form: { body: `質問 ${tag}` } },
		{ what: '委員長選挙の立候補', page: v.page, path: '/iinkai?/stand', form: {} },
		{ what: '解任動議の署名', page: v.page, path: '/iinkai?/recall', form: {} },
		// 投票
		{ what: '本案の票', page: v.page, path: `/saiketsu/${billId}?/vote`, form: { choice: 'yes' }, now: voteWeek },
		{ what: '修正案の票', page: v.page, path: `${bill}/shusei?/vote`, form: { amendment: '1', choice: 'yes' }, now: voteWeek },
		{ what: '委員長選挙の票', page: v.page, path: '/iinkai?/vote', form: { candidate: '1' }, now: voteWeek }
	];
	for (const c of cases) {
		for (const token of [null, 'test-fail']) {
			const label = `${c.what}（${token === null ? 'トークンなし' : '通らないトークン'}）`;
			const res = await send(c.page, c.path, c.form, token, c.now);
			expect(res.status(), label).toBe(400);
			expect(await res.text(), label).toContain('確認できませんでした');
		}
	}
});
