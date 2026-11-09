// Issue #122：法案の一覧とページの見た目を案に合わせる（SpBills・SpBillChanges・PcBillChanges・SpBillQA・PcBillQA）
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { billRequest, billSupportRequest, createAmendBill, issueWithSolutions, newUser, proposeRequest } from './helpers';

const sp = (name: string) => name === 'sp';
type Box = { x: number; y: number; width: number; height: number };
const box = async (target: Locator): Promise<Box> => (await target.boundingBox())!;
const area = async (target: Locator) => {
	const b = await box(target);
	return b.width * b.height;
};
const middle = (b: Box) => b.y + b.height / 2;

/** 質疑の期間（15日）の法案。質疑を1つ書いておき、読む人を返す */
async function billInQa(browser: Browser, w: string, n: number) {
	const year = 2620 + n * 2 + (sp(w) ? 0 : 1);
	const day = (d: number) => `${year}-05-${String(d).padStart(2, '0')}T09:00:00+09:00`;
	const label = `${w}${n}-${Date.now() % 1e7}`;
	const people: { page: Page; ip: string }[] = [];
	const person = async (who: string) => {
		const ip = `10.122.${n * 2 + (sp(w) ? 0 : 1)}.${people.length + 1}`;
		const u = await newUser(browser, { name: `${who}${label}`, ip, days: 8 });
		await u.context.setExtraHTTPHeaders({ 'x-test-ip': ip, 'x-test-now': day(5) });
		people.push({ page: u.page, ip });
		return u.page;
	};
	const author = await person('a');
	const { ids } = await issueWithSolutions(author, `法案の見た目 ${label}`, [`解決策 ${label}`]);
	const bill = await createAmendBill(author, `法案の見た目 ${label}`, ids[0], { 'body.0': `この法律は、${label}のためのものである。` });
	const backers = [await person('b'), await person('c'), await person('d')];
	const reader = await person('e');
	for (const b of backers) expect((await billSupportRequest(b, bill, { op: 'add', rev: '1' })).status()).toBe(200);
	expect((await proposeRequest(author, bill)).status()).toBe(200);
	for (const p of people) await p.page.context().setExtraHTTPHeaders({ 'x-test-ip': p.ip, 'x-test-now': day(15) });
	const res = await billRequest(backers[0], `${bill}/shitsugi/kaku`, {
		body: `見た目の質疑 ${label}`,
		'cf-turnstile-response': 'test-pass'
	});
	expect(res.status(), await res.text()).toBeLessThan(400);
	return { reader, bill };
}

test('基準1：スマホは法案の一覧の本文の見出しを見えない見出しにし、PC は見せる', async ({ page }, info) => {
	await page.goto('/houan');
	const h1 = page.getByRole('heading', { level: 1, name: '法案', exact: true });
	await expect(h1).toHaveCount(1);
	if (sp(info.project.name)) expect(await area(h1)).toBeLessThanOrEqual(1);
	else await expect(h1).toBeVisible();
});

test('基準2：PC の「場所」の欄は場所だけを見せ、番号と種類は読み上げに残す。スマホのカードの見出しはいまのまま', async ({ browser }, info) => {
	test.setTimeout(120_000);
	const w = info.project.name;
	const { reader, bill } = await billInQa(browser, w, 1);
	await reader.goto(`${bill}/henkou`);
	// 読み上げる名前はいまのまま
	const heading = reader.getByRole('heading', { level: 2, name: '1. 第1条 ・ 書きかえ', exact: true });
	await expect(heading).toHaveCount(1);
	const place = heading.getByText('第1条', { exact: true });
	const rest = heading.getByText(/書きかえ/);
	expect(await area(place)).toBeGreaterThan(1);
	if (sp(w)) {
		expect(await area(rest)).toBeGreaterThan(1);
		await expect(heading.getByText(/^1\./)).toBeVisible();
	} else {
		expect(await area(rest)).toBeLessThanOrEqual(1);
		expect(await area(heading.getByText(/^1\./))).toBeLessThanOrEqual(1);
	}
});

test('基準3：PC の変更点の表は、下の2つの角も丸い', async ({ browser }, info) => {
	test.skip(sp(info.project.name), 'PC の案（PcBillChanges）');
	test.setTimeout(120_000);
	const { reader, bill } = await billInQa(browser, 'pc', 2);
	await reader.goto(`${bill}/henkou`);
	const last = reader.getByRole('main').getByRole('article').last();
	await expect(last).toHaveCSS('border-bottom-left-radius', '12px');
	await expect(last).toHaveCSS('border-bottom-right-radius', '12px');
});

test('基準4：凡例「−消す」「＋足す」は札の形。PC は右の「条文全体のなかで見る」と縦の真ん中がそろう', async ({ browser }, info) => {
	test.setTimeout(120_000);
	const w = info.project.name;
	const { reader, bill } = await billInQa(browser, w, 3);
	await reader.goto(`${bill}/henkou`);
	for (const text of ['−消す', '＋足す']) {
		const tag = reader.getByText(text, { exact: true });
		await expect(tag).toBeVisible();
		await expect(tag).not.toHaveCSS('padding-left', '0px');
		await expect(tag).not.toHaveCSS('border-top-left-radius', '0px');
	}
	if (!sp(w)) {
		const tag = await box(reader.getByText('−消す', { exact: true }));
		const link = await box(reader.getByRole('link', { name: '条文全体のなかで見る' }));
		expect(Math.abs(middle(tag) - middle(link))).toBeLessThanOrEqual(2);
	}
});

test('基準5：「あなたの今の考え」は、スマホは見出しの右に「自分だけに見えます」、PC は見出しの下に1行で残りの回数と並べる', async ({ browser }, info) => {
	test.setTimeout(120_000);
	const w = info.project.name;
	const { reader, bill } = await billInQa(browser, w, 4);
	await reader.goto(`${bill}/shitsugi`);
	const stance = reader.getByRole('region', { name: 'あなたの今の考え' });
	const heading = await box(stance.getByRole('heading', { name: 'あなたの今の考え' }));
	const first = await box(stance.getByRole('button', { name: '賛成寄り' }));
	const last = await box(stance.getByRole('button', { name: '反対寄り' }));
	if (sp(w)) {
		const note = await box(stance.getByText('自分だけに見えます', { exact: true }));
		expect(note.x).toBeGreaterThan(heading.x + heading.width);
		expect(Math.abs(middle(note) - middle(heading))).toBeLessThanOrEqual(6);
		const left = await box(stance.getByText('この会期はあと2回変えられます', { exact: true }));
		expect(left.y).toBeGreaterThan(last.y + last.height);
	} else {
		const line = stance.getByText('自分だけに見えます ・ この会期はあと2回変えられます', { exact: true });
		await expect(line).toBeVisible();
		const b = await box(line);
		expect(b.y).toBeGreaterThan(heading.y + heading.height - 1);
		expect(b.y + b.height).toBeLessThanOrEqual(first.y);
		// ボタンの下には残りの回数を重ねて出さない
		await expect(stance.getByText('この会期はあと2回変えられます', { exact: true })).toBeHidden();
	}
});

test('基準6：PC は最初の質疑の上にも区切り線を引く', async ({ browser }, info) => {
	test.skip(sp(info.project.name), 'PC の案（PcBillQA）');
	test.setTimeout(120_000);
	const { reader, bill } = await billInQa(browser, 'pc', 5);
	await reader.goto(`${bill}/shitsugi`);
	const first = reader.getByRole('main').getByRole('article').first();
	await expect(first).toBeVisible();
	await expect(first).toHaveCSS('border-top-width', '1px');
	const filters = await box(reader.getByRole('navigation', { name: '質疑の絞り込み' }));
	expect((await box(first)).y).toBeGreaterThan(filters.y + filters.height);
});
