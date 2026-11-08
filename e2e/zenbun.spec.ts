// Issue #54 条文全体のなかで変更点を見る（/houan/<番号>/zenbun）
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { billPath, billRequest, issueWithSolutions, newUser, type BillForm } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});
test.use({ actionTimeout: 15_000 });
test.beforeEach(() => test.setTimeout(120_000));

const stamp = () => Date.now() % 1e8;
const LAW = '412AC0000000061';
const LAW_TITLE = '消費者契約法';
const TOKUSHO = '351AC0000000057';
const TOKUSHO_TITLE = '特定商取引に関する法律';

/** 書く人。IP はテストと幅ごとに分ける（10.115〜10.117 はほかのテストと撮影が使った） */
async function writer(browser: Browser, w: string, group: number) {
	const u = await newUser(browser, { name: `z${group}${w}${stamp()}`, ip: `10.${w === 'sp' ? 118 : 119}.${group}.1`, days: 8 });
	contexts.push(u.context);
	return u.page;
}

async function baseOf(page: Page, law: string) {
	return ((await (await page.request.get(`/houan/kaku/joubun?law=${law}`)).json()) as { revisionId: string }).revisionId;
}

async function save(page: Page, label: string, form: BillForm) {
	const { ids } = await issueWithSolutions(page, `全文 ${label}`, [`全文の解決策 ${label}`]);
	return billPath(
		await billRequest(page, '/houan/kaku', {
			title: `全文の法案 ${label}`,
			affected: '困っている人',
			sideEffects: '副作用',
			solution: ids[0],
			'cf-turnstile-response': 'test-pass',
			...form
		})
	);
}

/** 消費者契約法の第1条を書きかえ、第3条の2を足し、第4条を削除し、附則を書く */
async function amendBill(page: Page, label: string) {
	return save(page, label, {
		kind: 'amend',
		law: LAW,
		base: await baseOf(page, LAW),
		'op.0': 'amend',
		'target.0': '1',
		'caption.0': '（目的）',
		'body.0': `この法律は、消費者がいつでも契約をやめられるようにすることを目的とする。${label}`,
		'op.1': 'add',
		'num.1': '第3条の2',
		'caption.1': '（解約の窓口）',
		'body.1': `事業者は、解約の窓口をネットに置かなければならない。${label}`,
		'op.2': 'delete',
		'target.2': '4',
		supplementary: `この法律は、公布の日から施行する。${label}`
	});
}

const article = (page: Page, label: string) => page.getByRole('article', { name: label, exact: true });

test('基準1：変更点のタブに「条文全体のなかで見る」が出て全文のページが開く。まるごと廃止するだけの法案には出ない', async ({ browser }, info) => {
	const w = info.project.name;
	const a = await writer(browser, w, 1);
	const path = await amendBill(a, `入口${w}`);
	await a.goto(`${path}/henkou`);
	await a.getByRole('link', { name: '条文全体のなかで見る' }).click();
	await expect(a).toHaveURL(new RegExp(`${path}/zenbun$`));
	await expect(a.getByRole('heading', { level: 1, name: LAW_TITLE })).toBeVisible();

	const repeal = await save(a, `廃止${w}`, { kind: 'repeal', law: LAW, base: await baseOf(a, LAW) });
	await a.goto(`${repeal}/henkou`);
	await expect(a.getByText(`${LAW_TITLE}をまるごと廃止します。`)).toBeVisible();
	await expect(a.getByRole('link', { name: '条文全体のなかで見る' })).toHaveCount(0);
});

test('基準2：基にした条文を章の帯と条ごとに全部出し、書きかえ・新しく追加・削除を「−」「＋」と札で重ねる。附則は最後', async ({ browser }, info) => {
	const w = info.project.name;
	const a = await writer(browser, w, 2);
	const label = `重ねる${w}${stamp()}`;
	const path = await amendBill(a, label);
	await a.goto(`${path}/zenbun`);

	await expect(a.getByRole('heading', { name: /第一章　総則/ })).toBeVisible();
	// 変わらない条はそのまま、札なし
	const second = article(a, '第2条');
	await expect(second).toBeVisible();
	await expect(second.locator('del, ins')).toHaveCount(0);
	await expect(second.getByText(/書きかえ|新しく追加|削除/)).toHaveCount(0);
	// 書きかえ
	const first = article(a, '第1条');
	await expect(first.getByText('書きかえ', { exact: true })).toBeVisible();
	await expect(first.locator('del').first()).toContainText('−');
	await expect(first.locator('ins').first()).toContainText('＋');
	await expect(first).toContainText(label);
	// 新しく追加：第3条のあと、第4条の前
	const added = article(a, '第3条の2');
	await expect(added.getByText('新しく追加', { exact: true })).toBeVisible();
	await expect(added.locator('ins')).toContainText(`＋事業者は、解約の窓口をネットに置かなければならない。${label}`);
	const order = await a.getByRole('article').evaluateAll((els) => els.map((e) => e.id));
	expect(order.indexOf('jo-3_2')).toBe(order.indexOf('jo-3') + 1);
	// 削除
	const deleted = article(a, '第4条');
	await expect(deleted.getByText('削除', { exact: true })).toBeVisible();
	await expect(deleted.locator('del').first()).toContainText('−');
	// 附則は最後
	const supplementary = article(a, '附則');
	await expect(supplementary.getByText('新しく追加', { exact: true })).toBeVisible();
	await expect(supplementary).toContainText(`この法律は、公布の日から施行する。${label}`);
	expect(order[order.length - 1]).toBe('fusoku');
});

test('基準3：ページの上の変わる条の一覧から、その条へ移る', async ({ browser }, info) => {
	const w = info.project.name;
	const a = await writer(browser, w, 3);
	const path = await amendBill(a, `一覧${w}`);
	await a.goto(`${path}/zenbun`);
	const list = a.getByRole('navigation', { name: '変わる条' });
	await expect(list.getByRole('link')).toHaveText(['第1条 ・ 書きかえ', '第3条の2 ・ 新しく追加', '第4条 ・ 削除', '附則 ・ 新しく追加']);
	await list.getByRole('link', { name: '第4条 ・ 削除' }).click();
	await expect(a).toHaveURL(/#jo-4$/);
	await expect(article(a, '第4条')).toBeInViewport();
});

test('基準4：2本以上の法令の法案は、上の法令名で切り替えて1本ずつ出す', async ({ browser }, info) => {
	const w = info.project.name;
	const a = await writer(browser, w, 4);
	const label = `切り替え${w}${stamp()}`;
	const path = await save(a, label, {
		kind: 'amend',
		law: LAW,
		base: await baseOf(a, LAW),
		'law.1': TOKUSHO,
		'base.1': await baseOf(a, TOKUSHO),
		'op.0': 'amend',
		'target.0': '1',
		'caption.0': '（目的）',
		'body.0': `消費者契約法の書きかえ ${label}`,
		'op.1': 'amend',
		'seq.1': '1',
		'target.1': '1',
		'caption.1': '（目的）',
		'body.1': `特定商取引法の書きかえ ${label}`
	});
	await a.goto(`${path}/zenbun`);
	const laws = a.getByRole('navigation', { name: '法令' });
	await expect(laws.getByRole('link', { name: LAW_TITLE })).toHaveAttribute('aria-current', 'page');
	await expect(a.getByRole('heading', { level: 1, name: LAW_TITLE })).toBeVisible();
	await expect(article(a, '第1条')).toContainText(`消費者契約法の書きかえ ${label}`);
	await laws.getByRole('link', { name: TOKUSHO_TITLE }).click();
	await expect(a).toHaveURL(new RegExp(`${path}/zenbun\\?hourei=1$`));
	await expect(a.getByRole('heading', { level: 1, name: TOKUSHO_TITLE })).toBeVisible();
	await expect(article(a, '第1条')).toContainText(`特定商取引法の書きかえ ${label}`);
	await expect(a.getByText(`消費者契約法の書きかえ ${label}`)).toHaveCount(0);
});

test('基準5：制定の新法はすべての条が新しく追加。廃止の法令は全文を出さず、まるごと廃止することと IF世界のページへのリンクを出す', async ({ browser }, info) => {
	const w = info.project.name;
	const a = await writer(browser, w, 5);
	const label = `制定${w}${stamp()}`;
	const newTitle = `全文の新法 ${label} 法`;
	const enact = await save(a, label, {
		kind: 'enact',
		newTitle,
		'op.0': 'add',
		'num.0': '1',
		'caption.0': '（目的）',
		'body.0': `この法律は、${label}を守ることを目的とする。`,
		'op.1': 'add',
		'num.1': '2',
		'body.1': `新法の第2条 ${label}`
	});
	await a.goto(`${enact}/zenbun`);
	await expect(a.getByRole('heading', { level: 1, name: newTitle })).toBeVisible();
	for (const name of ['第1条', '第2条']) await expect(article(a, name).getByText('新しく追加', { exact: true })).toBeVisible();

	const repeal = await save(a, `廃止と改正${label}`, {
		kind: 'repeal',
		law: LAW,
		base: await baseOf(a, LAW),
		'law.1': TOKUSHO,
		'base.1': await baseOf(a, TOKUSHO),
		'action.1': 'amend',
		'op.0': 'amend',
		'seq.0': '1',
		'target.0': '1',
		'caption.0': '（目的）',
		'body.0': `廃止に合わせた書きかえ ${label}`
	});
	await a.goto(`${repeal}/zenbun`);
	await expect(a.getByText(`${LAW_TITLE}をまるごと廃止します。`)).toBeVisible();
	await expect(a.getByRole('link', { name: 'IF世界の条文を見る' })).toHaveAttribute('href', `/if/hourei/${LAW}`);
	await expect(a.getByRole('article')).toHaveCount(0);
	await a.goto(`${repeal}/zenbun?hourei=1`);
	await expect(article(a, '第1条')).toContainText(`廃止に合わせた書きかえ ${label}`);
});

test('基準6：ログインしていなくても下書きの全文を見られ、noindex', async ({ browser, page }, info) => {
	const w = info.project.name;
	const a = await writer(browser, w, 6);
	const path = await amendBill(a, `だれでも${w}`);
	await page.goto(`${path}/zenbun`);
	await expect(page.getByRole('heading', { level: 1, name: LAW_TITLE })).toBeVisible();
	await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
});

test('信頼の境界：パスの番号が数字でない・ない番号なら 404', async ({ request }) => {
	for (const id of ['abc', '0', '-1', '99999999', '1.5']) expect((await request.get(`/houan/${id}/zenbun`)).status(), id).toBe(404);
});

test('信頼の境界：?hourei= が数字でない・法令の数より大きいなら 404', async ({ browser }, info) => {
	const w = info.project.name;
	const a = await writer(browser, w, 7);
	const path = await amendBill(a, `境界${w}`);
	for (const v of ['abc', '1', '5', '-1', '0.5', '01']) expect((await a.request.get(`${path}/zenbun?hourei=${v}`)).status(), v).toBe(404);
	expect((await a.request.get(`${path}/zenbun?hourei=0`)).status()).toBe(200);
});
