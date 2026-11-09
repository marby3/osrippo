// Issue #123：採決の画面と結果の見た目を案に合わせる（SpVote・PcVote・SpResult・PcResult）
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { billSupportRequest, createAmendBill, issueWithSolutions, newUser, proposeRequest } from './helpers';

const sp = (name: string) => name === 'sp';
type Box = { x: number; y: number; width: number; height: number };
const box = async (target: Locator): Promise<Box> => (await target.boundingBox())!;
const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });

/** 発議した法案。第1条の本文の頭（「…格差に鑑み、」まで）は変えず、そのあとを書きかえる */
async function proposedBill(browser: Browser, w: string, n: number) {
	const year = 2660 + n * 2 + (sp(w) ? 0 : 1);
	const at = (month: number, d: number) => `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}T09:00:00+09:00`;
	const label = `${w}${n}-${Date.now() % 1e7}`;
	const people: { page: Page; ip: string }[] = [];
	const person = async (who: string) => {
		const ip = `10.123.${n * 2 + (sp(w) ? 0 : 1)}.${people.length + 1}`;
		const u = await newUser(browser, { name: `${who}${label}`, ip, days: 8 });
		await u.context.setExtraHTTPHeaders({ 'x-test-ip': ip, 'x-test-now': at(5, 5) });
		people.push({ page: u.page, ip });
		return u.page;
	};
	const author = await person('a');
	const { ids } = await issueWithSolutions(author, `採決の見た目 ${label}`, [`解決策 ${label}`]);
	const added = `${label}のためのものである`;
	const bill = await createAmendBill(author, `採決の見た目 ${label}`, ids[0], {
		'body.0': `この法律は、消費者と事業者との間の情報の質及び量並びに交渉力の格差に鑑み、${added}。`
	});
	const backers = [await person('b'), await person('c'), await person('d')];
	const reader = await person('e');
	for (const b of backers) expect((await billSupportRequest(b, bill, { op: 'add', rev: '1' })).status()).toBe(200);
	expect((await proposeRequest(author, bill)).status()).toBe(200);
	const setNow = async (month: number, d: number) => {
		for (const p of people) await p.page.context().setExtraHTTPHeaders({ 'x-test-ip': p.ip, 'x-test-now': at(month, d) });
	};
	return { reader, id: bill.replace('/houan/', ''), added, setNow };
}

/** 投票の画面を開き、変更点の行（第1条）を返す。スマホは変更点を開く */
async function voteRow(browser: Browser, w: string, n: number) {
	const s = await proposedBill(browser, w, n);
	await s.setNow(5, 22);
	await s.reader.goto(`/saiketsu/${s.id}`);
	await hydrated(s.reader);
	if (sp(w)) await s.reader.getByRole('button', { name: /変更点 1か所/ }).click();
	const heading = s.reader.getByRole('heading', { level: 3, name: '第1条 ・ 書きかえ', exact: true });
	await expect(heading).toBeVisible();
	return { ...s, heading };
}

test('基準1：変更点は、場所の見出しのすぐ右に同じ行から続ける', async ({ browser }, info) => {
	test.setTimeout(120_000);
	const { heading } = await voteRow(browser, info.project.name, 1);
	const h = await box(heading);
	// 条文は見出しの下の段落ではなく、見出しと同じ行から始まる（最初の行の頭は見出しの右）
	const text = await box(heading.locator('xpath=following-sibling::*[1]'));
	expect(text.y).toBeLessThan(h.y + h.height);
	const first = await heading.locator('xpath=following-sibling::*[1]').evaluate((el) => {
		const range = document.createRange();
		range.selectNodeContents(el);
		const r = range.getClientRects()[0];
		return { x: r.left, y: r.top };
	});
	expect(first.x).toBeGreaterThan(h.x + h.width - 1);
	expect(Math.abs(first.y - h.y)).toBeLessThanOrEqual(8);
});

test('基準2：変わっていないところは前後10文字だけを残して「…」にし、変わったところは全部出す。改行は空白', async ({ browser }, info) => {
	test.setTimeout(120_000);
	const { heading, added } = await voteRow(browser, info.project.name, 2);
	const row = heading.locator('xpath=..');
	// 「（目的）\nこの法律は、消費者と事業者との間の情報の質及び量並びに交渉力の格差に鑑み、」の最後の10文字だけ
	await expect(row).toContainText('…交渉力の格差に鑑み、');
	await expect(row).not.toContainText('（目的）');
	await expect(row).not.toContainText('消費者と事業者との間');
	// 変わったところは全部
	await expect(row.getByText(/^−.*一定の行為により消費者が誤認し.*国民経済の健全な発展に寄与することを目的とする$/)).toBeVisible();
	await expect(row.getByText(`＋${added}`, { exact: true })).toBeVisible();
	// 条文の中に改行がない（innerText は段落の前後に必ず改行を足すので、段落の中だけを見る）
	expect(await heading.locator('xpath=following-sibling::*[1]').innerText()).not.toContain('\n');
});

test('基準3：結果のページの下のリンクは「›」の付いた行の一覧。PC は右の列、スマホは参考の票の下。結果の前も同じ形', async ({ browser }, info) => {
	test.setTimeout(120_000);
	const w = info.project.name;
	const s = await proposedBill(browser, w, 3);
	const rows = async (names: string[]) => {
		for (const name of names) {
			const item = s.reader.getByRole('listitem').filter({ has: s.reader.getByRole('link', { name, exact: true }) });
			const link = item.getByRole('link', { name, exact: true });
			await expect(link, name).toBeVisible();
			// 行全体が押せて、右に「›」、行の下に区切り線
			const [l, i] = [await box(link), await box(item)];
			expect(Math.abs(l.width - i.width), name).toBeLessThanOrEqual(1);
			await expect(link.locator('svg'), name).toHaveCount(1);
			await expect(item, name).toHaveCSS('border-bottom-width', '1px');
		}
	};
	// 結果の前（締切の前）
	await s.setNow(5, 25);
	await s.reader.goto(`/saiketsu/${s.id}/kekka`);
	await rows(['法案のページへ', '委員会']);
	// 結果のあと
	await s.setNow(6, 2);
	await s.reader.goto(`/saiketsu/${s.id}/kekka`);
	await rows(['法案のページへ', '委員会']);
	const list = await box(s.reader.getByRole('list').filter({ has: s.reader.getByRole('link', { name: '委員会', exact: true }) }));
	const reference = await box(s.reader.getByRole('heading', { name: /参考の票/ }).locator('xpath=..'));
	if (sp(w)) {
		expect(list.y).toBeGreaterThan(reference.y + reference.height);
	} else {
		const verdict = await box(s.reader.getByText('廃案', { exact: true }));
		expect(list.x).toBeGreaterThan(verdict.x + verdict.width);
		expect(Math.abs(list.x - reference.x)).toBeLessThanOrEqual(1);
		expect(list.y).toBeGreaterThan(reference.y + reference.height);
	}
});
