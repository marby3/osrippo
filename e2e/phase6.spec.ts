// フェーズ6 クローズドβの締めのテスト（Issue #190）。
// 通ったらフェーズ6完了として v0.6 を出す。それまでは test:phase でだけ回す。
// 負荷試験（受入基準4）は Playwright ではなく pnpm test:load で、実装の Issue で作る。
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { ORIGIN } from './helpers';

const run = promisify(execFile);

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});

type Width = 'sp' | 'pc';

test.use({ actionTimeout: 15_000 });

/**
 * 幅ごとに別の月を使う（phase4 は 2035年、phase5 は 2036年）。シミュレーションは前の月から bot を動かし
 * （前の月に何かした人の票が数えた票になる）、この月の会期を1つ通す。結果は次の月の1日に確定する
 */
const MONTH = { sp: { now: '2037-04', next: '2037-05' }, pc: { now: '2037-08', next: '2037-09' } } as const;
const at = (month: string, day: number) => `${month}-${String(day).padStart(2, '0')}T09:00:00+09:00`;
const sessionName = (month: string) => `${Number(month.slice(0, 4))}年${Number(month.slice(5))}月の会期`;

/** pnpm simulate が最後の1行に書く結果（Issue #190 受入基準1・2） */
type Simulated = {
	/** 作った bot の参加者の数 */
	participants: number;
	/** 立場ごとの bot の数 */
	stances: Record<string, number>;
	/** シミュレーションのあいだに返ってきた 5xx の数 */
	http5xx: number;
	/** 可決させる法案A と、否決させる法案B */
	passed: { id: string; title: string };
	rejected: { id: string; title: string };
	/** 法案A が変える法令と条、変えたあとの本文にだけある言葉 */
	law: string;
	article: string;
	amended: string;
};

/** シミュレーションを流し、結果を受け取る。bot はテスト用ログインで本物の送信先を呼ぶ（決めたこと4） */
async function simulate(w: Width): Promise<Simulated> {
	const { stdout } = await run('pnpm', ['--silent', 'simulate', '--origin', ORIGIN, '--month', MONTH[w].now, '--label', `${w}-${Date.now() % 1e8}`, '--participants', '60'], {
		maxBuffer: 64 * 1024 * 1024,
		timeout: 25 * 60_000
	});
	const last = stdout.trim().split('\n').at(-1) ?? '';
	return JSON.parse(last) as Simulated;
}

/** ログインしていない人。サーバーの「いま」は x-test-now で決める */
async function viewer(browser: Browser, now: string): Promise<Page> {
	const context = await browser.newContext({ baseURL: ORIGIN, extraHTTPHeaders: { 'x-test-ip': '10.90.0.1', 'x-test-now': now } });
	contexts.push(context);
	return context.newPage();
}

const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
/** IF世界の帯（紫の斜線）。目印は data-if-band（Issue #63 テストの作り方） */
const band = (page: Page) => page.locator('[data-if-band]');
const robots = (page: Page) => page.locator('meta[name="robots"]');
const region = (page: Page, name: string | RegExp) => page.getByRole('region', { name });

test('bot の参加者60人で会期を1つ通すと、法案が可決・否決され、IF世界の条文と統計に出る', async ({ browser }, info) => {
	test.setTimeout(30 * 60_000);
	const w = info.project.name as Width;
	const { now, next } = MONTH[w];

	// 1・2. シミュレーション：60人で1会期を通し、そのあいだ 5xx が出ない
	const sim = await simulate(w);
	expect(sim.participants).toBe(60);
	// 立場は3つに分け、どの区分も10人以上（決めたこと5）
	expect(Object.keys(sim.stances)).toHaveLength(3);
	for (const [stance, n] of Object.entries(sim.stances)) expect(n, stance).toBeGreaterThanOrEqual(10);
	expect(sim.http5xx).toBe(0);

	// 3. 画面：次の月の2日に、ログインしていない人が結果を見る
	const v = await viewer(browser, at(next, 2));

	// 法案A は可決され、「IF世界の法律になりました」
	await v.goto(`/saiketsu/${sim.passed.id}/kekka`);
	await hydrated(v);
	await expect(v.getByRole('heading', { level: 1, name: sim.passed.title })).toBeVisible();
	await expect(v.getByText('可決', { exact: true })).toBeVisible();
	await expect(v.getByText('IF世界の法律になりました')).toBeVisible();
	// 立場別の分布が出る（どの区分も10人以上なので「人数が少ないため」にならない）
	const dist = region(v, '立場別の分布');
	await expect(dist).toBeVisible();
	await expect(dist).not.toContainText('人数が少ないため');
	for (const cell of await dist.getByRole('cell').allInnerTexts()) expect(cell.trim()).toMatch(/^\d+%$/);

	// 法案B は否決
	await v.goto(`/saiketsu/${sim.rejected.id}/kekka`);
	await expect(v.getByRole('heading', { level: 1, name: sim.rejected.title })).toBeVisible();
	await expect(v.getByText('否決', { exact: true })).toBeVisible();
	await expect(v.getByText('IF世界の法律にはなりません')).toBeVisible();

	// IF世界の法律の変わった条（帯と「架空の法令」、noindex）
	await v.goto(`/if/hourei/${sim.law}`);
	await hydrated(v);
	await expect(band(v)).toBeVisible();
	await expect(band(v)).toHaveCSS('background-image', /gradient/);
	await expect(v.getByText('架空の法令').first()).toBeVisible();
	await expect(robots(v)).toHaveAttribute('content', /noindex/);
	await expect(v.getByRole('article', { name: sim.article, exact: true })).toContainText(sim.amended);

	// 現実の法律は元のまま
	await v.goto(`/hourei/${sim.law}`);
	await expect(v.getByRole('article', { name: sim.article, exact: true })).not.toContainText(sim.amended);
	await expect(band(v)).toHaveCount(0);

	// 統計ページ：この会期の法案の結果に A（可決）と B（否決）が並び、結果のページへつながる
	const res = await v.goto(`/toukei?kaiki=${now}`);
	expect(res?.status()).toBe(200);
	const results = region(v, /法案の結果/);
	await expect(v.getByRole('heading', { level: 2, name: `${sessionName(now)}の法案の結果` })).toBeVisible();
	const rowA = results.getByRole('row').filter({ hasText: sim.passed.title });
	await expect(rowA).toContainText('可決');
	await expect(rowA.getByRole('link', { name: sim.passed.title })).toHaveAttribute('href', `/saiketsu/${sim.passed.id}/kekka`);
	await expect(results.getByRole('row').filter({ hasText: sim.rejected.title })).toContainText('否決');
});
