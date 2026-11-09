// Issue #121：課題のページと課題を書く画面の見た目を案に合わせる（SpIssue・PcIssue・SpIssueNew・PcIssueNew）
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { issueWithSolutions, newUser } from './helpers';

const sp = (name: string) => name === 'sp';
type Box = { x: number; y: number; width: number; height: number };
const box = async (target: Locator): Promise<Box> => (await target.boundingBox())!;
const right = (b: Box) => b.x + b.width;
const bottom = (b: Box) => b.y + b.height;

/** 見えない（読み上げにだけ残る）部品：大きさが 1px 以下 */
async function visuallyHidden(target: Locator) {
	await expect(target).toHaveCount(1);
	const b = await box(target);
	expect(b.width * b.height).toBeLessThanOrEqual(1);
}

/** メニューの右端（「わたしの記録」の右端） */
const menuRight = async (page: Page) =>
	right(await box(page.getByRole('banner').getByRole('link', { name: 'わたしの記録', exact: true })));

let seq = 0;
/** 解決策のある課題を書き、別の人がそのページを開く */
async function issuePage(browser: Browser, w: string, n: number, solutions = 3) {
	const label = `${w}${n}-${Date.now() % 1e7}-${++seq}`;
	const writer = await newUser(browser, { name: `km${label}`, ip: `10.121.${n}.${sp(w) ? 1 : 2}`, days: 8 });
	const bodies = Array.from({ length: solutions }, (_, i) => `解決策の見た目 ${label} その${i + 1}`);
	const { issueId, title } = await issueWithSolutions(writer.page, label, bodies);
	await writer.context.close();
	const reader = await newUser(browser, { name: `kr${label}`, ip: `10.121.${n}.${sp(w) ? 3 : 4}`, days: 8 });
	await reader.page.goto(`/kadai/${issueId}`);
	return { page: reader.page, title };
}

/** 課題の「わかる」のボタン（解決策の「わかる」は読み上げで「この解決策に」が前に付く） */
const supportButton = (page: Page) => page.getByRole('button', { name: /^わかる \d+$/ });
/** 課題の通報のボタン */
const reportButton = (page: Page) => page.getByRole('button', { name: 'この課題を通報する', exact: true });

test('基準1：PC は左に本文と解決策、右の列に「わかる」の枠と通報。スマホは1列のまま', async ({ browser }, info) => {
	const w = info.project.name;
	const { page } = await issuePage(browser, w, 1);
	const h1 = await box(page.getByRole('heading', { level: 1 }));
	const example = await box(page.getByText('具体例', { exact: true }));
	const solutions = await box(page.getByRole('heading', { name: /^解決策/ }));
	const support = await box(supportButton(page));
	const report = await box(reportButton(page));
	if (sp(w)) {
		// 本文 → わかる → 解決策 → 通報 の順に縦に並ぶ
		expect(support.y).toBeGreaterThan(bottom(example));
		expect(solutions.y).toBeGreaterThan(bottom(support));
		expect(report.y).toBeGreaterThan(bottom(solutions));
		return;
	}
	// 「わかる」とボタンの説明を枠で囲む
	const frame = await supportButton(page).evaluate((el) => {
		let node: HTMLElement | null = el.parentElement;
		while (node && !node.textContent?.includes('同じことで困っていたら押してください')) node = node.parentElement;
		const s = getComputedStyle(node!);
		const r = node!.getBoundingClientRect();
		return { border: s.borderTopWidth, radius: s.borderTopLeftRadius, x: r.left, y: r.top, right: r.right };
	});
	expect(frame.border).not.toBe('0px');
	expect(frame.radius).not.toBe('0px');
	// 右の列：本文と解決策の右にあり、見出しの高さから始まり、右端はメニューの端にそろう
	const left = Math.max(right(example), right(solutions), right(h1));
	expect(frame.x).toBeGreaterThan(left);
	expect(Math.abs(frame.y - h1.y)).toBeLessThanOrEqual(16);
	expect(Math.abs(frame.right - (await menuRight(page)))).toBeLessThanOrEqual(1);
	// 通報は枠の下、同じ右の列
	expect(report.x).toBeGreaterThanOrEqual(frame.x);
	expect(report.y).toBeGreaterThan(bottom(support));
	// 解決策は本文のすぐ下から（右の列のせいで空きができない）
	expect(solutions.y - bottom(example)).toBeLessThanOrEqual(80);
});

test('基準2：スマホの解決策は、1件ずつ枠線と角丸のカード', async ({ browser }, info) => {
	test.skip(!sp(info.project.name), 'スマホの案（SpIssue）');
	const { page } = await issuePage(browser, 'sp', 2);
	const cards = page.getByRole('article');
	await expect(cards).toHaveCount(3);
	for (let i = 0; i < 3; i++) {
		const card = cards.nth(i);
		await expect(card).toHaveCSS('border-left-width', '1px');
		await expect(card).toHaveCSS('border-top-width', '1px');
		await expect(card).not.toHaveCSS('border-top-left-radius', '0px');
	}
	// カードどうしは離れている
	const [a, b] = [await box(cards.nth(0)), await box(cards.nth(1))];
	expect(b.y).toBeGreaterThan(bottom(a));
});

test('基準3：PC の解決策は1件を1行にし、本文が左、「わかる」「考えが変わった」が右。行のあいだに区切り線', async ({ browser }, info) => {
	test.skip(sp(info.project.name), 'PC の案（PcIssue）');
	const { page } = await issuePage(browser, 'pc', 3);
	const rows = page.getByRole('article');
	await expect(rows).toHaveCount(3);
	for (let i = 0; i < 3; i++) {
		const row = rows.nth(i);
		const body = await box(row.getByText(/^解決策の見た目 /));
		const buttons = row.getByRole('button', { name: /^この解決策に/ });
		await expect(buttons).toHaveCount(2);
		const first = await box(buttons.nth(0));
		const second = await box(buttons.nth(1));
		// ボタンは本文の右、本文の1行目と同じ高さ
		expect(first.x).toBeGreaterThan(right(body));
		expect(first.y).toBeLessThan(bottom(body));
		expect(Math.abs(second.y - first.y)).toBeLessThanOrEqual(1);
		await expect(row).toHaveCSS('border-bottom-width', '1px');
		await expect(row).toHaveCSS('border-left-width', '0px');
	}
});

test('基準4：スマホの「解決策を書く」は解決策の並びの下に横いっぱい。PC は見出しの右', async ({ browser }, info) => {
	const w = info.project.name;
	const { page } = await issuePage(browser, w, 4, 4);
	const write = await box(page.getByRole('link', { name: '解決策を書く', exact: true }));
	const heading = await box(page.getByRole('heading', { name: /^解決策/ }));
	if (sp(w)) {
		const all = await box(page.getByRole('link', { name: /解決策をすべて見る/ }));
		expect(write.y).toBeGreaterThan(bottom(all));
		expect(Math.round(write.width)).toBe(page.viewportSize()!.width - 32);
		await expect(page.getByRole('link', { name: '解決策を書く', exact: true })).toHaveCSS('border-top-width', '1px');
	} else {
		expect(write.x).toBeGreaterThan(right(heading));
		expect(Math.abs(write.y + write.height / 2 - (heading.y + heading.height / 2))).toBeLessThanOrEqual(8);
	}
});

/** 課題を書く画面を開き、スクリプトが動くのを待つ */
async function writePage(browser: Browser, w: string, n: number) {
	const user = await newUser(browser, { name: `kw${w}${n}-${Date.now() % 1e7}`, ip: `10.121.${n}.${sp(w) ? 5 : 6}`, days: 8 });
	await user.page.goto('/kadai/kaku');
	await user.page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
	return user.page;
}

test('基準5：まだの段の棒は白抜き。スマホは「ステップ 1 / 3」で段の名前は見えない形、PC は棒の下に段の名前', async ({ browser }, info) => {
	const w = info.project.name;
	const page = await writePage(browser, w, 5);
	const steps = page.getByRole('list', { name: '課題を書く段' }).getByRole('listitem');
	await expect(steps).toHaveCount(3);
	const bar = (i: number) =>
		steps.nth(i).evaluate((el) => {
			const s = getComputedStyle(el, '::before');
			return { bg: s.backgroundColor, border: s.borderTopWidth, height: s.height };
		});
	const pageBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
	const now = await bar(0);
	expect(now.bg).not.toBe(pageBg);
	for (const i of [1, 2]) {
		const later = await bar(i);
		expect(later.bg, `${i + 1}段目`).toBe(pageBg);
		expect(later.border, `${i + 1}段目`).not.toBe('0px');
	}
	if (sp(w)) {
		await expect(page.getByText('ステップ 1 / 3', { exact: true })).toBeVisible();
		await visuallyHidden(page.getByText('1 タイトル', { exact: true }));
		// 段を進めると表示も進む
		await page.getByLabel('何に困っていますか？').fill('段の表示を確かめる');
		await page.getByRole('button', { name: '次へ' }).click();
		await expect(page.getByText('ステップ 2 / 3', { exact: true })).toBeVisible();
	} else {
		await expect(page.getByText('ステップ 1 / 3', { exact: true })).toBeHidden();
		const label = await box(page.getByText('1 タイトル', { exact: true }));
		const first = await box(steps.nth(0));
		expect(label.width * label.height).toBeGreaterThan(1);
		expect(label.y).toBeGreaterThan(first.y);
	}
});

test('基準6：スマホは段のボタンを画面の下に横いっぱいで留め、似た課題の欄は入力欄のすぐ下に背景なしで出す', async ({ browser }, info) => {
	test.skip(!sp(info.project.name), 'スマホの案（SpIssueNew）');
	const { title } = await issuePage(browser, 'sp', 6, 0);
	const page = await writePage(browser, 'sp', 6);
	const viewport = page.viewportSize()!;
	const input = page.getByLabel('何に困っていますか？');
	await input.fill(title);
	const heading = page.getByRole('heading', { name: '似た課題があります' });
	await expect(heading).toBeVisible();
	const next = page.getByRole('button', { name: 'どれとも違うので、次へ' });
	const cancel = page.getByRole('link', { name: 'やめる', exact: true });
	const check = async (button: Locator) => {
		const b = await box(button);
		expect(viewport.height - bottom(b)).toBeLessThanOrEqual(16);
		expect(Math.round(b.x)).toBe(16);
		return b;
	};
	// 1段目：「次へ」が下に留まり、「やめる」はその右
	const b = await check(next);
	const c = await box(cancel);
	expect(c.x).toBeGreaterThan(right(b));
	expect(right(c)).toBeLessThanOrEqual(viewport.width - 16);
	// 似た課題の欄は入力欄のすぐ下で、灰色の背景がない
	const i = await box(input);
	const h = await box(heading);
	expect(h.y).toBeGreaterThan(bottom(i));
	expect(h.y - bottom(i)).toBeLessThanOrEqual(64);
	const bg = await heading.evaluate((el) => getComputedStyle(el.parentElement!).backgroundColor);
	expect(bg).toBe('rgba(0, 0, 0, 0)');
	// 一番下まで送っても、最後の行が帯に隠れない
	await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
	const footer = await box(page.getByRole('contentinfo'));
	expect(bottom(footer)).toBeLessThanOrEqual((await box(next)).y);
	// 2段目の「次へ」「戻る」も下に留まる
	await next.click();
	await check(page.getByRole('button', { name: '次へ', exact: true }));
	const back = await box(page.getByRole('button', { name: '戻る', exact: true }));
	expect(viewport.height - bottom(back)).toBeLessThanOrEqual(16);
});

test('基準7：PC の書く画面は、見出し・段・入力欄のあいだに空きがなく、似た課題の欄は見出しの高さから右端まで', async ({ browser }, info) => {
	test.skip(sp(info.project.name), 'PC の案（PcIssueNew）');
	const { title } = await issuePage(browser, 'pc', 7, 0);
	const page = await writePage(browser, 'pc', 7);
	const input = page.getByLabel('何に困っていますか？');
	await input.fill(title);
	const similar = page.getByRole('complementary').filter({ has: page.getByRole('heading', { name: '似た課題があります' }) });
	await expect(similar).toBeVisible();
	const h1 = await box(page.getByRole('heading', { level: 1, name: '課題を書く' }));
	const steps = await box(page.getByRole('list').filter({ hasText: '1 タイトル' }));
	const field = await box(input);
	const s = await box(similar);
	expect(steps.y - bottom(h1)).toBeLessThanOrEqual(24);
	// 段の下は「何に困っていますか？」の1行をはさんで入力欄
	expect(field.y - bottom(steps)).toBeLessThanOrEqual(80);
	expect(Math.abs(s.y - h1.y)).toBeLessThanOrEqual(16);
	expect(Math.abs(right(s) - (await menuRight(page)))).toBeLessThanOrEqual(1);
	expect(s.x).toBeGreaterThan(right(field));
});
