// フェーズ5 議員ビューの締めのテスト（Issue #147）。
// 通ったらフェーズ5完了として v0.5 を出す。それまでは test:phase でだけ回す。
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { ORIGIN, issueWithSolutions, loginAs, postIssue, stubTurnstile, supportRequest } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});

type Width = 'sp' | 'pc';

test.use({ actionTimeout: 15_000 });

/** 幅ごとに別の月を使う（Issue #147 テストの作り方）。選挙の期間は、その月の10日から20日 */
const MONTH = { sp: '2036-04', pc: '2036-08' } as const;
const at = (month: string, day: number) => `${month}-${String(day).padStart(2, '0')}T09:00:00+09:00`;

type User = { page: Page; setNow: (now: string) => Promise<void> };

/** サーバーの「いま」を x-test-now で決めた利用者。name がなければログインしない */
async function user(browser: Browser, ip: string, now: string, name?: string, role?: 'operator'): Promise<User> {
	const headers = { 'x-test-ip': ip };
	const context = await browser.newContext({ baseURL: ORIGIN, extraHTTPHeaders: { ...headers, 'x-test-now': now } });
	contexts.push(context);
	const page = await context.newPage();
	await stubTurnstile(page);
	if (name) await loginAs(page, name, 8, role);
	return { page, setNow: (t) => context.setExtraHTTPHeaders({ ...headers, 'x-test-now': t }) };
}

const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });

/**
 * 操作をして、書き込みの応答が返るまで待つ（次の移動で送信が中断されないように）。
 * use:enhance の送信は fail() でも HTTP 200 で返るので、本文の type も確かめる
 */
async function posted(u: Page, act: () => Promise<void>) {
	const [res] = await Promise.all([u.waitForResponse((r) => r.request().method() === 'POST'), act()]);
	expect(res.status()).toBeLessThan(400);
	if (res.status() < 300) expect(await res.text()).not.toContain('"type":"failure"');
}

/** ダッシュボードの課題の行（スマホはカード、PC は表の行）。目印は data-giin-row（Issue #147 テストの作り方） */
const row = (page: Page, title: string) => page.locator('[data-giin-row]').filter({ has: page.getByRole('link', { name: title, exact: true }) });

/** 課題のページの「議員の反応」の欄 */
const reactions = (page: Page) => page.getByRole('region', { name: '議員の反応' });

/** 正規表現に入れる文字を、そのままの文字として扱う */
const literal = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const STOPPED = '選挙期間中は、議員の機能が止まっています';
const HIDDEN = '議員（選挙期間中のため名前を出していません）';

test('議員アカウントで課題に「検討中」を付け、選挙期間中は議員の機能が止まる', async ({ browser }, info) => {
	test.setTimeout(240_000);
	const w = info.project.name as Width;
	const month = MONTH[w];
	const suffix = `${w}-${Date.now() % 1e8}`;
	const ip = (n: number) => `10.${w === 'sp' ? 70 : 71}.0.${n}`;
	const name = (who: string) => `${who}5-${suffix}`;
	const legislator = `試験 太郎${suffix}`;

	// 1. 議員にする：運営が運営の画面で P を議員にし、運営の記録に出る
	const op = await user(browser, ip(1), at(month, 3), name('OP'), 'operator');
	// P のアカウントを作ってからログアウトし、認証のあとでログインし直す（筋書き1→3の順）
	const p = await user(browser, ip(2), at(month, 3), name('P'));
	await p.page.context().clearCookies();
	const kanri = await op.page.goto('/kanri');
	expect(kanri?.status()).toBe(200);
	await hydrated(op.page);
	const grant = op.page.getByRole('region', { name: '議員・有識者の認証' });
	await grant.getByLabel('表示名').fill(name('P'));
	await grant.getByRole('group', { name: '種類' }).getByRole('radio', { name: '議員', exact: true }).check();
	await grant.getByLabel('氏名').fill(legislator);
	await posted(op.page, () => grant.getByRole('button', { name: '認証を付ける' }).click());
	await op.page.goto('/unei');
	const log = op.page.getByRole('main').locator('li, tr').filter({ hasText: legislator });
	await expect(log.first()).toContainText('議員の認証を付けた');
	await expect(log.first()).toContainText(`${Number(month.slice(5))}月3日`);

	// 2. 準備：A が課題を2つ書き、A と B〜K（11人）が1つめに「わかる」を付ける。2つめは反応を付けずに残す
	const a = await user(browser, ip(3), at(month, 3), name('A'));
	const solution = `窓口をひとつにまとめる ${suffix}`;
	const { issueId } = await issueWithSolutions(a.page, `5-${suffix}`, [solution]);
	const otherTitle = `議員の反応のない課題 ${suffix}`;
	await postIssue(a.page, { title: otherTitle });
	expect((await supportRequest(a.page, issueId, 'add')).status()).toBeLessThan(400);
	const members = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];
	const people: Record<string, User> = {};
	for (const [i, who] of members.entries()) {
		people[who] = await user(browser, ip(i + 10), at(month, 3), name(who));
		expect((await supportRequest(people[who].page, issueId, 'add')).status(), who).toBeLessThan(400);
	}
	const viewer = await user(browser, ip(40), at(month, 5));
	const v = viewer.page;
	const issuePath = `/kadai/${issueId}`;
	await v.goto(issuePath);
	const title = (await v.getByRole('heading', { level: 1 }).innerText()).trim();

	// 3. 議員の画面：ヘッダーに「議員用」と「認証済み・氏名」、ダッシュボードの「課題」のタブに A の課題
	await p.setNow(at(month, 5));
	await loginAs(p.page, name('P'), 8);
	await p.page.goto('/');
	await hydrated(p.page);
	const header = p.page.getByRole('banner');
	await expect(header.getByRole('link', { name: /議員用/ })).toHaveAttribute('href', '/giin');
	if (w === 'pc') await expect(header.getByRole('link', { name: /議員用/ })).toBeVisible();
	await p.page.goto('/giin');
	await hydrated(p.page);
	// 認証の表示：PC はヘッダーの右（PcMember）、スマホはヘッダーの下の帯（SpMember）
	const verified = new RegExp(`認証済み(議員)?\\s*・\\s*${literal(legislator)}`);
	// PC のヘッダーとスマホの帯の両方にあり、幅に合わないほうは隠れているので、見えているものを選ぶ
	await expect((w === 'pc' ? header : p.page).getByText(verified).filter({ visible: true }).first()).toBeVisible();
	await expect(p.page.getByRole('main').getByRole('link', { name: /^課題\s*\d+$/ })).toHaveAttribute('aria-current', 'page');
	const issueRow = row(p.page, title);
	await expect(issueRow).toBeVisible();
	if (w === 'sp') {
		// SpMember：カードに「わかる N ・ 立場を超えた支持 …」と「いちばんの解決策：…」
		await expect(issueRow).toContainText(/わかる 11(?!\d)/);
		await expect(issueRow).toContainText('立場を超えた支持');
		await expect(issueRow).toContainText(`いちばんの解決策：${solution}`);
	} else {
		// PcMember：表の見出しの列に値を出す
		for (const h of ['わかる', '立場を超えた支持', 'いちばんの解決策']) await expect(p.page.getByRole('columnheader', { name: h, exact: true })).toBeVisible();
		await expect(issueRow.getByRole('cell', { name: '11', exact: true })).toBeVisible();
		await expect(issueRow.getByRole('cell', { name: solution, exact: true })).toBeVisible();
	}

	// 4. 検討中にする：行が「検討中」になり、課題のページに出て、A に通知が届く
	await posted(p.page, () => issueRow.getByRole('button', { name: '検討中にする' }).click());
	await p.page.goto('/giin');
	await expect(row(p.page, title).getByText('検討中', { exact: true })).toBeVisible();
	await expect(row(p.page, title).getByRole('button', { name: '検討中にする' })).toHaveCount(0);

	await v.goto(issuePath);
	await expect(reactions(v)).toContainText(new RegExp(`検討中[：:]\\s*${literal(legislator)}（認証済み議員）`));

	await a.setNow(at(month, 5));
	await a.page.goto('/tsuchi');
	await expect(a.page.getByRole('main').getByText(new RegExp(`${literal(title)}.*議員が「検討中」を付けました`))).toBeVisible();

	// 5. 議員にできないこと：課題のページに「わかる」のボタンがない（一般の利用者にはある）
	const support = (u: Page) => u.getByRole('main').getByRole('button', { name: /^わかる/ });
	await people.B.setNow(at(month, 5));
	await people.B.page.goto(issuePath);
	await expect(support(people.B.page).first()).toBeVisible();
	await p.page.goto(issuePath);
	await expect(p.page.getByRole('heading', { level: 1 })).toHaveText(title);
	await expect(support(p.page)).toHaveCount(0);

	// 6. 選挙期間：運営が国政選挙を登録する（10日〜20日）
	await op.setNow(at(month, 5));
	await op.page.goto('/kanri');
	await hydrated(op.page);
	await op.page.getByLabel('選挙の名前').fill(`試験の国政選挙 ${suffix}`);
	await op.page.getByLabel('公示日').fill(`${month}-10`);
	await op.page.getByLabel('投票日').fill(`${month}-20`);
	await posted(op.page, () => op.page.getByRole('button', { name: '選挙を登録する' }).click());

	// 期間の中：「検討中にする」が出ず、議員名を出さない。「検討中」は残る
	await p.setNow(at(month, 12));
	await p.page.goto('/giin');
	await expect(p.page.getByText(STOPPED)).toBeVisible();
	await expect(row(p.page, otherTitle)).toBeVisible();
	await expect(p.page.getByRole('button', { name: '検討中にする' })).toHaveCount(0);
	await viewer.setNow(at(month, 12));
	await v.goto(issuePath);
	await expect(reactions(v)).toContainText('検討中');
	await expect(reactions(v)).toContainText(HIDDEN);
	await expect(v.getByRole('main')).not.toContainText(legislator);

	// 投票日の翌日：元に戻る
	await p.setNow(at(month, 21));
	await p.page.goto('/giin');
	await expect(p.page.getByText(STOPPED)).toHaveCount(0);
	await expect(row(p.page, otherTitle).getByRole('button', { name: '検討中にする' })).toBeVisible();
	await viewer.setNow(at(month, 21));
	await v.goto(issuePath);
	await expect(reactions(v)).toContainText(new RegExp(`検討中[：:]\\s*${literal(legislator)}（認証済み議員）`));
	await expect(reactions(v)).not.toContainText(HIDDEN);

	// 5（続き）. 採決の期間：議員には割り当てがない
	await p.setNow(at(month, 22));
	await p.page.goto('/saiketsu');
	await expect(p.page.getByText(/割り当て法案\s*0\s*\/\s*0/)).toBeVisible();
});
