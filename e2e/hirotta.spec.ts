// Issue #150：「拾った」ステータス（検討中・質問で取り上げた）と、課題のページの「議員の反応」。
// テストのサーバーは会議録のサイトに問い合わせず、https://kokkai.ndl.go.jp/txt/test- で始まる URL だけを「ある」とする
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { ORIGIN, issueWithSolutions, loginAs, stubTurnstile } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});

type Width = 'sp' | 'pc';
const MONTH = { sp: '2043-05', pc: '2043-08' } as const;
const at = (month: string, day: number) => `${month}-${String(day).padStart(2, '0')}T09:00:00+09:00`;
const jaDay = (month: string, day: number) => `${Number(month.slice(0, 4))}年${Number(month.slice(5))}月${day}日`;

type User = { page: Page; name: string };

let serial = 0;
async function user(browser: Browser, w: Width, who: string, now: string | null, role?: 'operator'): Promise<User> {
	const n = ++serial;
	const headers: Record<string, string> = { 'x-test-ip': `10.150.${w === 'sp' ? 1 : 2}.${n % 250}` };
	if (now) headers['x-test-now'] = now;
	const context = await browser.newContext({ baseURL: ORIGIN, extraHTTPHeaders: headers });
	contexts.push(context);
	const page = await context.newPage();
	await stubTurnstile(page);
	const name = `${who}${w}${Date.now() % 1e7}${n}`;
	if (who !== 'anon') await loginAs(page, name, 8, role);
	return { page, name };
}

const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });

/** 運営の画面で認証を付ける。表示する名前を返す */
async function grant(op: Page, target: string, kind: '議員' | '有識者', field = '') {
	const name = `${kind === '議員' ? '拾う 議員' : '拾う 教授'}${target.slice(-6)}`;
	await op.goto('/kanri');
	await hydrated(op);
	const s = op.getByRole('region', { name: '議員・有識者の認証' });
	await s.getByLabel('表示名').fill(target);
	await s.getByRole('group', { name: '種類' }).getByRole('radio', { name: kind, exact: true }).check();
	await s.getByLabel('表示する名前').fill(name);
	if (field) await s.getByLabel('専門分野').fill(field);
	await Promise.all([op.waitForResponse((r) => r.request().method() === 'POST'), s.getByRole('button', { name: '認証を付ける' }).click()]);
	await op.goto('/kanri');
	await expect(s.getByRole('listitem').filter({ hasText: target })).toHaveCount(1);
	return name;
}

/** A が課題を書き、P を議員にする */
async function setup(browser: Browser, w: Width, day = 3) {
	const now = at(MONTH[w], day);
	const a = await user(browser, w, 'a', now);
	const tag = `${w}${Date.now() % 1e7}`;
	const { issueId, title } = await issueWithSolutions(a.page, `150-${tag}`, [`解決策 ${tag}`]);
	const op = await user(browser, w, 'op', now, 'operator');
	const p = await user(browser, w, 'p', now);
	const name = await grant(op.page, p.name, '議員');
	return { now, a, op, p, name, issueId, title, tag };
}

const reactions = (page: Page) => page.getByRole('region', { name: '議員の反応' });

/** 書き込みの応答が返るまで待つ */
async function posted(u: Page, act: () => Promise<void>) {
	await Promise.all([u.waitForResponse((r) => r.request().method() === 'POST'), act()]);
}

test('基準1：議員はダッシュボードと課題のページで「検討中にする」を押せ、「検討中を外す」で外せる', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const { p, issueId, title } = await setup(browser, w);
	// ダッシュボード
	await p.page.goto('/giin?sort=new');
	const row = p.page.locator('[data-giin-row]').filter({ has: p.page.getByRole('link', { name: title, exact: true }) });
	await posted(p.page, () => row.getByRole('button', { name: '検討中にする' }).click());
	await p.page.goto('/giin?sort=new');
	await expect(row.getByText('検討中', { exact: true })).toBeVisible();
	await posted(p.page, () => row.getByRole('button', { name: '検討中を外す' }).click());
	await p.page.goto('/giin?sort=new');
	await expect(row.getByRole('button', { name: '検討中にする' })).toBeVisible();
	// 課題のページ
	await p.page.goto(`/kadai/${issueId}`);
	await posted(p.page, () => reactions(p.page).getByRole('button', { name: '検討中にする' }).click());
	await p.page.goto(`/kadai/${issueId}`);
	await expect(reactions(p.page).getByRole('button', { name: '検討中を外す' })).toBeVisible();
});

test('基準2：会議録の URL を添えて「質問で取り上げた」を付ける。ページがない URL とほかのサイトは断る。外せる', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const { p, issueId, name, tag } = await setup(browser, w);
	await p.page.goto(`/kadai/${issueId}`);
	await hydrated(p.page);
	const r = reactions(p.page);
	const add = async (url: string) => {
		await r.getByLabel('会議録の URL').fill(url);
		await posted(p.page, () => r.getByRole('button', { name: '質問で取り上げた' }).click());
	};
	await add('https://example.com/txt/1');
	await expect(r.getByRole('alert')).toHaveText('国会会議録検索システムの会議録の URL を入れてください');
	await add(`https://kokkai.ndl.go.jp/txt/none-${tag}`);
	await expect(r.getByRole('alert')).toHaveText('会議録のページが見つかりませんでした');
	const url = `https://kokkai.ndl.go.jp/txt/test-${tag}/1`;
	await add(url);
	await p.page.goto(`/kadai/${issueId}`);
	await expect(r).toContainText(`質問で取り上げた：${name}（認証済み議員）`);
	await expect(r.getByRole('link', { name: '会議録' })).toHaveAttribute('href', url);
	await posted(p.page, () => r.getByRole('button', { name: '質問で取り上げたを外す' }).click());
	await p.page.goto(`/kadai/${issueId}`);
	await expect(r).not.toContainText('質問で取り上げた：');
});

test('基準3：だれでも見られる「議員の反応」に、いま付いている反応と付けた日。外したものと、反応のない課題は出さない', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const { p, issueId, name } = await setup(browser, w);
	const viewer = await user(browser, w, 'anon', null);
	await viewer.page.goto(`/kadai/${issueId}`);
	await expect(reactions(viewer.page)).toHaveCount(0);
	await p.page.goto(`/kadai/${issueId}`);
	await posted(p.page, () => reactions(p.page).getByRole('button', { name: '検討中にする' }).click());
	await viewer.page.goto(`/kadai/${issueId}`);
	await expect(reactions(viewer.page)).toContainText(`検討中：${name}（認証済み議員）`);
	await expect(reactions(viewer.page)).toContainText(jaDay(MONTH[w], 3));
	// 一般の人にはボタンを出さない
	await expect(reactions(viewer.page).getByRole('button')).toHaveCount(0);
	await p.page.goto(`/kadai/${issueId}`);
	await posted(p.page, () => reactions(p.page).getByRole('button', { name: '検討中を外す' }).click());
	await viewer.page.goto(`/kadai/${issueId}`);
	await expect(reactions(viewer.page)).toHaveCount(0);
});

test('基準4：付けると課題を書いた人に通知が届く', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const { a, p, issueId, title } = await setup(browser, w);
	await p.page.goto(`/kadai/${issueId}`);
	await posted(p.page, () => reactions(p.page).getByRole('button', { name: '検討中にする' }).click());
	await a.page.goto('/tsuchi');
	await expect(a.page.getByRole('main').getByRole('link', { name: `課題「${title}」に議員が「検討中」を付けました。` })).toHaveAttribute('href', `/kadai/${issueId}`);
});

test('基準5：付けた・外したを運営の記録に出す', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const { p, issueId, title, name } = await setup(browser, w);
	await p.page.goto(`/kadai/${issueId}`);
	await posted(p.page, () => reactions(p.page).getByRole('button', { name: '検討中にする' }).click());
	await p.page.goto(`/kadai/${issueId}`);
	await posted(p.page, () => reactions(p.page).getByRole('button', { name: '検討中を外す' }).click());
	const viewer = await user(browser, w, 'anon', null);
	await viewer.page.goto('/unei');
	const log = viewer.page.getByRole('region', { name: '議員の反応の記録' }).getByRole('listitem').filter({ hasText: name });
	await expect(log).toHaveText([`検討中を外した・${name}・${title}・${jaDay(MONTH[w], 3)}`, `検討中を付けた・${name}・${title}・${jaDay(MONTH[w], 3)}`]);
});

test('基準6：議員でない人にはボタンが出ず、送っても断る', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const { op, issueId } = await setup(browser, w);
	const g = await user(browser, w, 'g', at(MONTH[w], 3));
	const e = await user(browser, w, 'e', at(MONTH[w], 3));
	await grant(op.page, e.name, '有識者', '民法');
	for (const u of [g, e]) {
		await u.page.goto(`/kadai/${issueId}`);
		await expect(u.page.getByRole('button', { name: '検討中にする' })).toHaveCount(0);
		const res = await u.page.request.post(`/kadai/${issueId}?/hirotta`, {
			form: { kind: 'considering', op: 'add' },
			headers: { origin: ORIGIN, accept: 'text/html' },
			maxRedirects: 0
		});
		expect(res.status()).toBe(403);
	}
});
