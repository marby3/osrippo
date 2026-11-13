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
	const w = info.project.name as Width;
	const v = await user(browser, w, 'anon', at(MONTH[w], 2));
	const pages = ['/', '/kadai', '/houan', '/hourei', `/hourei/${LAW}`, `/if/hourei/${LAW}`, '/toukei', '/login'];
	for (const path of pages) {
		const res = await v.page.goto(path);
		expect(res?.status(), path).toBe(200);
		await expect(v.page.getByRole('contentinfo'), path).toContainText('国会・政府とは無関係の非公式サービスです');
	}
	// 見つからないときのページにも
	const missing = await v.page.goto('/kadai/999999999');
	expect(missing?.status()).toBe(404);
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

/** トークンが通らない送信（画面のフォームと同じ POST）。now を渡すと、その時刻に送る */
const send = (page: Page, path: string, form: Record<string, string>, now?: string) =>
	page.request.post(path, {
		form: { ...form, 'cf-turnstile-response': 'test-fail' },
		headers: { origin: ORIGIN, accept: 'text/html', ...(now ? { 'x-test-now': now } : {}) },
		maxRedirects: 0
	});

test('基準2：登録・投稿・投票の送信先は、Turnstile が通らない送信を断る', async ({ browser }, info) => {
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
	const guest = await user(browser, w, 'anon', at(month, 5));
	const { revisionId } = (await (await v.page.request.get(`/houan/kaku/joubun?law=${LAW}`)).json()) as { revisionId: string };

	// 投票の画面は採決の週の外だと法案のページへ送り返すので、投票は22日に送る（断った応答をそのまま見るため）
	const voteWeek = at(month, 22);
	const cases: [string, Page, string, Record<string, string>, string?][] = [
		// 登録（ログイン）
		['ログイン（Google）', guest.page, '/login?/google', { next: '/' }],
		['ログイン（LINE）', guest.page, '/login?/line', { next: '/' }],
		// 投稿
		['課題', v.page, '/kadai/kaku', { title: `課題 ${tag}`, affected: '困っている人', example: '具体例', topic: 'none' }],
		['解決策', v.page, `/kadai/${issueId}/kaiketsu/kaku`, { body: `解決策 ${tag}` }],
		[
			'法案の下書き',
			v.page,
			'/houan/kaku',
			{ kind: 'amend', title: `法案 ${tag}`, law: LAW, base: revisionId, 'op.0': 'amend', 'target.0': '1', 'caption.0': '（目的）', 'body.0': '本文', affected: '人', sideEffects: 'なし', solution: ids[0] }
		],
		['質疑', v.page, `${bill}/shitsugi/kaku`, { body: `質疑 ${tag}` }],
		['答弁', a.page, `${bill}/shitsugi?/answer`, { question: '1', body: `答弁 ${tag}` }],
		['補足', v.page, `${bill}/shitsugi?/supplement`, { question: '1', body: `補足 ${tag}` }],
		['修正案', v.page, `${bill}/shusei/kaku`, { article: '0:1', body: '本文', rev: '1' }],
		['専門家の解説', e.page, `${bill}?/commentary`, { body: `解説 ${tag}` }],
		['答弁イベントの質問', v.page, `${toben}?/ask`, { body: `質問 ${tag}` }],
		['委員長選挙の立候補', v.page, '/iinkai?/stand', {}],
		// 投票
		['本案の票', v.page, `/saiketsu/${billId}?/vote`, { choice: 'yes' }, voteWeek],
		['修正案の票', v.page, `${bill}/shusei?/vote`, { amendment: '1', choice: 'yes' }, voteWeek],
		['委員長選挙の票', v.page, '/iinkai?/vote', { candidate: '1' }, voteWeek]
	];
	for (const [what, page, path, form, now] of cases) {
		const res = await send(page, path, form, now);
		expect(res.status(), what).toBe(400);
		expect(await res.text(), what).toContain('確認できませんでした');
	}
});
