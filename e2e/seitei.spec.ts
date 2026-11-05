// Issue #47 新法の制定。書く画面と法案のページは #46（e2e/houan.spec.ts）
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { billPath, billRequest, issueWithSolutions, newUser, type BillForm } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});

const LAW = '412AC0000000061';
const TEMPLATE = 'この法律は、○○することを目的とする。';
const PURPOSE = 'この法律は、定期購入の解約をいつでもできるようにすることを目的とする。';
const ip = (project: string, group: number, n: number) => `10.${project === 'sp' ? 42 : 43}.${group}.${n}`;
const stamp = () => Date.now() % 1e8;
// 全部を並列で流すと、準備だけで30秒を超えることがある
test.beforeEach(() => test.setTimeout(120_000));
const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });

async function user(browser: Browser, name: string, ipAddress: string) {
	const u = await newUser(browser, { name, ip: ipAddress, days: 8 });
	contexts.push(u.context);
	return u.page;
}

/** 解決策から書く画面を開いて「制定」を選ぶ */
async function openEnact(a: Page, label: string) {
	const { ids } = await issueWithSolutions(a, label, [`新法の解決策 ${label}`]);
	await a.goto(`/houan/kaku?kaiketsu=${ids[0]}`);
	await hydrated(a);
	await a.getByRole('radio', { name: '制定' }).check();
	return ids[0];
}

const article = (a: Page, n: number) => a.getByRole('group', { name: `第${n}条`, exact: true });

/** 法令名・第1条・必須欄を書く */
async function fillEnact(a: Page, title: string, lawTitle: string) {
	await a.getByLabel('題名').fill(title);
	await a.getByLabel('法令名').fill(lawTitle);
	await article(a, 1).getByLabel('条文').fill(PURPOSE);
	await a.getByLabel('誰が困っているか').fill('定期購入の解約ができずに困っている人');
	await a.getByLabel('副作用').fill('事業者の解約窓口の負担が増える');
}

const save = (a: Page) => a.getByRole('button', { name: '下書きを保存する' }).click();

test('基準1：「制定」を選ぶと法令名の欄とひな形の第1条が出る。対象の法令などは出ず、第1条は外せない', async ({ browser }, info) => {
	const p = info.project.name;
	const s = stamp();
	const a = await user(browser, `e1-a-${p}-${s}`, ip(p, 1, 1));
	await openEnact(a, `e1-${p}-${s}`);

	await expect(a.getByLabel('法令名')).toBeVisible();
	await expect(article(a, 1).getByLabel('見出し')).toHaveValue('（目的）');
	await expect(article(a, 1).getByLabel('条文')).toHaveValue(TEMPLATE);
	for (const label of ['対象の法令', '変え方', '変える条']) await expect(a.getByLabel(label)).toHaveCount(0);
	await expect(article(a, 1).getByRole('button', { name: 'この条を外す' })).toHaveCount(0);
});

test('基準2：制定の下書きを保存すると、法案のページに札・正式名・状態・概要が出る', async ({ browser }, info) => {
	const w = info.project.name;
	const s = stamp();
	const name = `e2-a-${w}-${s}`;
	const a = await user(browser, name, ip(w, 2, 1));
	await openEnact(a, `e2-${w}-${s}`);
	const title = `解約を守る新しい法律 ${w}-${s}`;
	await fillEnact(a, title, 'サブスク解約法');
	await a.getByRole('button', { name: '条を足す' }).click();
	await article(a, 2).getByLabel('見出し').fill('（解約の申出）');
	await article(a, 2).getByLabel('条文').fill('消費者は、いつでも解約を申し出ることができる。');
	await save(a);

	await expect(a.getByRole('heading', { level: 1, name: title })).toBeVisible();
	await expect(a.getByText('制定', { exact: true })).toBeVisible();
	await expect(a.getByText('サブスク解約法案', { exact: true })).toBeVisible();
	await expect(w === 'sp' ? a.getByText(/^いま：\s*下書き$/) : a.getByText(/^下書き\s*（いまここ）$/)).toBeVisible();
	await expect(a.getByText('定期購入の解約ができずに困っている人')).toBeVisible();
	await expect(a.getByText('事業者の解約窓口の負担が増える')).toBeVisible();
	await expect(a.getByText(`新法の解決策 e2-${w}-${s}`)).toBeVisible();
	await expect(a.getByText(`提出者 ${name}`)).toBeVisible();
});

test('基準3：変更点のタブに条ごとに「新しく追加」で出す。スマホは変更後だけ、PC は「いま」の欄に（なし）。附則も出す', async ({ browser }, info) => {
	const w = info.project.name;
	const s = stamp();
	const a = await user(browser, `e3-a-${w}-${s}`, ip(w, 3, 1));
	await openEnact(a, `e3-${w}-${s}`);
	await fillEnact(a, `変更点を見る新法 ${w}-${s}`, 'サブスク解約法');
	await a.getByRole('button', { name: '条を足す' }).click();
	await article(a, 2).getByLabel('条文').fill('消費者は、いつでも解約を申し出ることができる。');
	await a.getByLabel('附則').fill('この法律は、公布の日から施行する。');
	await save(a);
	await expect(a).toHaveURL(/\/houan\/\d+$/);

	await a.getByRole('link', { name: '変更点 3' }).click();
	const change = (heading: string) => a.locator('article').filter({ has: a.getByRole('heading', { name: heading }) });
	const first = change('1. 第1条 ・ 新しく追加');
	const added = first.locator('ins').filter({ hasText: '＋（目的）' });
	await expect(added).toHaveCSS('text-decoration-line', /underline/);
	await expect(first.locator('ins').filter({ hasText: '定期購入の解約をいつでも' })).toBeVisible();
	await expect(change('2. 第2条 ・ 新しく追加').locator('ins').filter({ hasText: 'いつでも解約を申し出る' })).toBeVisible();
	await expect(change('附則 ・ 新しく追加').locator('ins').filter({ hasText: '公布の日から施行する' })).toBeVisible();
	if (w === 'pc') await expect(first.getByText('（なし）')).toBeVisible();
	else await expect(first.getByText('（なし）')).toBeHidden();
});

test('基準4：条の番号は順に付き、途中の条を外すと詰まって、詰まった番号で保存される', async ({ browser }, info) => {
	const p = info.project.name;
	const s = stamp();
	const a = await user(browser, `e4-a-${p}-${s}`, ip(p, 4, 1));
	await openEnact(a, `e4-${p}-${s}`);
	await fillEnact(a, `番号の詰まる新法 ${p}-${s}`, 'サブスク解約法');
	for (const n of [2, 3]) {
		await a.getByRole('button', { name: '条を足す' }).click();
		await article(a, n).getByLabel('条文').fill(`第${n}条として書いた本文`);
	}
	await article(a, 2).getByRole('button', { name: 'この条を外す' }).click();
	await expect(article(a, 3)).toHaveCount(0);
	await expect(article(a, 2).getByLabel('条文')).toHaveValue('第3条として書いた本文');
	await save(a);
	await expect(a).toHaveURL(/\/houan\/\d+$/);

	await a.getByRole('link', { name: '変更点 2' }).click();
	const second = a.locator('article').filter({ has: a.getByRole('heading', { name: '2. 第2条 ・ 新しく追加' }) });
	await expect(second.locator('ins').filter({ hasText: '第3条として書いた本文' })).toBeVisible();
});

test('基準5：提出者は法令名と条が入った画面で直して保存できる。種類は変えられない', async ({ browser }, info) => {
	const p = info.project.name;
	const s = stamp();
	const a = await user(browser, `e5-a-${p}-${s}`, ip(p, 5, 1));
	await openEnact(a, `e5-${p}-${s}`);
	const title = `直す新法 ${p}-${s}`;
	await fillEnact(a, title, 'サブスク解約法');
	await save(a);
	await expect(a.getByRole('heading', { level: 1, name: title })).toBeVisible();

	await a.getByRole('link', { name: '編集する' }).click();
	await hydrated(a);
	await expect(a.getByRole('radio')).toHaveCount(0);
	await expect(a.getByText('種類：制定')).toBeVisible();
	await expect(a.getByLabel('法令名')).toHaveValue('サブスク解約法');
	await expect(article(a, 1).getByLabel('条文')).toHaveValue(PURPOSE);
	await a.getByLabel('法令名').fill('定期購入解約法');
	await save(a);
	await expect(a.getByText('定期購入解約法案', { exact: true })).toBeVisible();
});

test('基準6：法令名と第1条と条文の形の誤りは欄のそばに出し、入力を残す', async ({ browser }, info) => {
	const p = info.project.name;
	const s = stamp();
	const a = await user(browser, `e6-a-${p}-${s}`, ip(p, 6, 1));
	await openEnact(a, `e6-${p}-${s}`);
	const title = `誤りのある新法 ${p}-${s}`;
	await fillEnact(a, title, 'サブスク解約法');
	const name = a.getByLabel('法令名');
	// ブラウザでも止める形なので、サーバーの確かめを見るために外す
	await name.evaluate((el) => {
		el.removeAttribute('required');
		el.removeAttribute('maxlength');
	});

	for (const [value, message] of [
		['', 'ここを書いてください。'],
		['あ'.repeat(60) + '法', '長すぎます。字数を減らしてください。'],
		['サブスク解約のルール', '法令名は「法」か「法律」で終わるようにしてください。'],
		['消費者契約法', '同じ名前の法律があります。別の名前にしてください。']
	]) {
		await name.fill(value);
		await save(a);
		await expect(a.getByText(message)).toBeVisible();
		await expect(name).toHaveAttribute('aria-invalid', 'true');
		await expect(name).toHaveValue(value);
		await expect(a.getByLabel('題名')).toHaveValue(title);
	}
	await name.fill('サブスク解約法');

	const purpose = article(a, 1);
	await purpose.getByLabel('条文').fill(TEMPLATE);
	await save(a);
	await expect(purpose.getByText('「○○」を書きかえてください。')).toBeVisible();
	await expect(purpose.getByLabel('条文')).toHaveAttribute('aria-invalid', 'true');
	await expect(purpose.getByLabel('条文')).toHaveValue(TEMPLATE);
	await purpose.getByLabel('条文').fill(PURPOSE);

	await purpose.getByLabel('見出し').fill('（趣旨）');
	await save(a);
	await expect(purpose.getByText('新しい法律には、見出しが「（目的）」の第1条が要ります。')).toBeVisible();
	await expect(purpose.getByLabel('見出し')).toHaveAttribute('aria-invalid', 'true');
	await purpose.getByLabel('見出し').fill('（目的）');

	await a.getByRole('button', { name: '条を足す' }).click();
	await article(a, 2).getByLabel('条文').fill('第1項の本文\n3　2を飛ばした項');
	await save(a);
	await expect(article(a, 2).getByText('2行目：項の番号が順になっていません（2、3、4…と続けてください）。')).toBeVisible();
	await expect(article(a, 2).getByLabel('条文')).toHaveAttribute('aria-invalid', 'true');
});

test('信頼の境界：制定のフォームの作り変えた値は 400 で、保存しない', async ({ browser }, info) => {
	const p = info.project.name;
	const s = stamp();
	const a = await user(browser, `eb-a-${p}-${s}`, ip(p, 7, 1));
	const { ids } = await issueWithSolutions(a, `eb-${p}-${s}`, [`境界の解決策 ${p}-${s}`]);
	const form = (extra: BillForm = {}): BillForm => ({
		kind: 'enact',
		title: `作り変え ${p}-${s}`,
		newTitle: 'サブスク解約法',
		'op.0': 'add',
		'num.0': '1',
		'caption.0': '（目的）',
		'body.0': PURPOSE,
		affected: '困っている人',
		sideEffects: '副作用',
		solution: ids[0],
		'cf-turnstile-response': 'test-pass',
		...extra
	});
	const rows = Object.fromEntries(
		Array.from({ length: 51 }, (_, i) => [
			[`op.${i}`, 'add'],
			[`num.${i}`, String(i + 1)],
			[`caption.${i}`, i === 0 ? '（目的）' : ''],
			[`body.${i}`, '本文']
		]).flat()
	);
	const base = (await (await a.request.get(`/houan/kaku/joubun?law=${LAW}`)).json()) as { revisionId: string };

	const cases: [string, BillForm][] = [
		['番号の飛んだ条', form({ 'num.0': '2' })],
		['枝番の条', form({ 'num.0': '第1条の2' })],
		['変え方「書きかえ」', form({ 'op.0': 'amend', 'target.0': '1' })],
		['法令の番号', form({ law: LAW })],
		['基にした版', form({ base: base.revisionId })],
		['51条', form(rows)],
		['法令名の改行', form({ newTitle: 'サブスク\n解約法' })]
	];
	for (const [label, f] of cases) expect((await billRequest(a, '/houan/kaku', f)).status(), label).toBe(400);
	// どれも保存していない（作れる3件の上限に1件も数えていない）
	for (let i = 0; i < 3; i++) billPath(await billRequest(a, '/houan/kaku', form({ title: `通る ${i} ${p}-${s}` })));
});
