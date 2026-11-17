// Issue #225：説明の画面に図を足す（遊び方、法案の書き方、ログイン、β版のお約束）
import { readFileSync, readdirSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { sessionDays } from '../src/lib/domain/session';

/** 図を足す画面 */
const PAGES = ['/asobikata', '/asobikata/2', '/asobikata/3', '/houan/kakikata', '/login', '/yakusoku'];
/** 図は data-figure の付いた figure */
const figures = (page: Page) => page.locator('main figure[data-figure]');
const box = async (l: Locator) => {
	await expect(l).toBeVisible();
	return (await l.boundingBox())!;
};
/** 文字が、この順に出てくる */
async function expectInOrder(l: Locator, words: string[]) {
	const text = await l.innerText();
	const at = words.map((w) => text.indexOf(w));
	expect(at.every((i) => i >= 0), `${words.join('・')} が図にある`).toBe(true);
	expect([...at].sort((a, b) => a - b), `${words.join('・')} の順`).toEqual(at);
}

test('基準1：遊び方の3つの段に、見出しと文のあいだに図が1つずつある', async ({ page }) => {
	const d = sessionDays();
	const firstLine = ['暮らしの中で', '課題と解決策をもとに', `${d.vote}日から採決です`];
	for (const [i, path] of ['/asobikata', '/asobikata/2', '/asobikata/3'].entries()) {
		await page.goto(path);
		await expect(figures(page), path).toHaveCount(1);
		const figure = figures(page);
		const f = await box(figure);
		const h1 = await box(page.getByRole('heading', { level: 1 }));
		const body = await box(page.getByRole('main').getByText(firstLine[i]));
		expect(f.y, path).toBeGreaterThanOrEqual(h1.y + h1.height);
		expect(f.y + f.height, path).toBeLessThanOrEqual(body.y);
	}

	await page.goto('/asobikata');
	await expectInOrder(figures(page), ['課題', 'わかる', '解決策']);

	await page.goto('/asobikata/2');
	await expectInOrder(figures(page), ['発議', '質疑', '採決']);
	// この段（1日〜質疑の終わり）が目立つ：発議と質疑
	await expect(figures(page).locator('[data-current]')).toHaveCount(2);
	await expect(figures(page).locator('[data-current]').nth(0)).toContainText('発議');
	await expect(figures(page).locator('[data-current]').nth(1)).toContainText('質疑');

	await page.goto('/asobikata/3');
	const ifLane = figures(page).locator('[data-lane="if"]');
	const realLane = figures(page).locator('[data-lane="real"]');
	await expect(ifLane).toContainText('IF世界の法律');
	await expect(ifLane).toContainText('架空');
	await expect(ifLane).toContainText('変わる');
	await expect(realLane).toContainText('現実の法律');
	await expect(realLane).toContainText('変わらない');
	// IF世界の側は紫の斜線の模様
	expect(await ifLane.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('repeating-linear-gradient');
	expect(await realLane.evaluate((el) => getComputedStyle(el).backgroundImage)).toBe('none');
});

test('基準2：法案の書き方の「法案ができるまで」「法案の種類」「変える条の書き方」に図がある', async ({ page }) => {
	await page.goto('/houan/kakikata');
	const flow = page.locator('#nagare figure[data-figure]');
	await expect(flow).toHaveCount(1);
	await expectInOrder(flow, ['課題', '解決策', '下書き', '発議', '質疑', '採決', 'IF世界の法律']);

	const kinds = page.locator('#shurui figure[data-figure]');
	await expect(kinds).toHaveCount(1);
	await expectInOrder(kinds, ['改正', '廃止', '制定']);

	// 書き方の例の各行に、何にあたるかを書き込む
	const example = page.locator('#jo figure[data-figure]');
	await expect(example).toHaveCount(1);
	const rows = example.locator('[data-row]');
	await expect(rows).toHaveCount(4);
	const expected = [
		['第1項', '事業者は、契約を結ぶ前に'],
		['第1号', '一　契約の期間'],
		['第2号', '二　解約の方法'],
		['第2項', '2　前項の事項は']
	];
	for (const [i, [tag, line]] of expected.entries()) {
		await expect(rows.nth(i).locator('[data-tag]')).toHaveText(tag);
		await expect(rows.nth(i).locator('[data-line]')).toContainText(line);
	}
	// 行頭の「一」「2」と全角の空白を指す
	await expect(example).toContainText('「一」と全角の空白');
	await expect(example).toContainText('半角の「2」と全角の空白');
	await expect(rows.nth(1).locator('[data-mark]')).toHaveText('一　');
	await expect(rows.nth(3).locator('[data-mark]')).toHaveText('2　');
});

test('基準3：ログインのはじめての方への説明に、登録の3つの手順の図がある', async ({ page }) => {
	await page.goto('/login');
	await expect(figures(page)).toHaveCount(1);
	const figure = figures(page);
	const f = await box(figure);
	const newcomer = await box(page.getByText(/^はじめての方は、招待コードを入れて/));
	const invite = await box(page.getByText('招待コード（はじめての方）', { exact: true }));
	expect(f.y).toBeGreaterThanOrEqual(newcomer.y + newcomer.height);
	expect(f.y + f.height).toBeLessThanOrEqual(invite.y);
	await expectInOrder(figure, ['1', '招待コードを入れる', '2', 'お約束にチェックを入れる', '3', 'GoogleかLINEのボタンで登録']);
});

test('基準4：β版のお約束の一覧の上に、要点の図がある。お約束の文は変えない', async ({ page }) => {
	await page.goto('/yakusoku');
	await expect(figures(page)).toHaveCount(1);
	const figure = figures(page);
	const f = await box(figure);
	const list = await box(page.locator('main ol.items'));
	expect(f.y + f.height).toBeLessThanOrEqual(list.y);
	await expectInOrder(figure, ['非公式のゲーム', 'CC BY 4.0', '1人1アカウント']);
	// お約束の7項目はそのまま（図の中の項目を一覧と数えない）
	await expect(page.locator('main ol.items > li')).toHaveCount(7);
	await expect(page.getByRole('main').getByRole('listitem')).toHaveCount(7);
});

test('基準5：図は SVG で描き、色は Tokens の変数だけ。色の変数を暗い色に差し替えると、図の色もすべて変わる', async ({ page }) => {
	// Tokens の色の変数を、元とは違う色（暗い表示を想定）に差し替える
	const names = [...readFileSync('src/lib/styles/tokens.css', 'utf8').matchAll(/(--color-[a-z-]+)\s*:/g)].map((m) => m[1]);
	expect(names.length).toBeGreaterThan(10);
	const swapped = names.map((n, i) => [n, `rgb(${10 + i}, ${20 + 2 * i}, ${200 - i})`] as const);
	const css = `:root{${swapped.map(([n, v]) => `${n}:${v}`).join(';')}}`;
	const allowed = new Set(swapped.map(([, v]) => v.replace(/,\s*/g, ', ')));

	for (const path of PAGES) {
		await page.goto(path);
		const count = await figures(page).count();
		expect(count, path).toBeGreaterThan(0);
		for (let i = 0; i < count; i++) await expect(figures(page).nth(i).locator('svg').first(), path).toBeAttached();
		await page.addStyleTag({ content: css });
		const used = await figures(page).evaluateAll((els) => {
			const out: string[] = [];
			const push = (v: string) => {
				for (const c of v.match(/rgba?\([^)]*\)/g) ?? []) if (!/rgba\(.*,\s*0\)$/.test(c)) out.push(c);
			};
			for (const root of els)
				for (const el of [root, ...root.querySelectorAll('*')]) {
					const s = getComputedStyle(el);
					push(s.color);
					push(s.backgroundColor);
					push(s.backgroundImage);
					for (const side of ['Top', 'Right', 'Bottom', 'Left'] as const)
						if (s[`border${side}Style`] !== 'none' && parseFloat(s[`border${side}Width`]) > 0) push(s[`border${side}Color`]);
					if (s.textDecorationLine !== 'none') push(s.textDecorationColor);
					if (s.outlineStyle !== 'none') push(s.outlineColor);
					if (el instanceof SVGElement) {
						if (s.fill !== 'none') push(s.fill);
						if (s.stroke !== 'none') push(s.stroke);
					}
				}
			return out;
		});
		expect(used.length, path).toBeGreaterThan(0);
		for (const c of new Set(used)) expect(allowed.has(c), `${path}：${c} は Tokens の変数の色でない`).toBe(true);
	}
});

test('基準6：図の文字は画像にせず、文言は ja.ts に置く。図には読み上げ用の説明がある', async ({ page }) => {
	for (const path of PAGES) {
		await page.goto(path);
		const facts = await figures(page).evaluateAll((els) =>
			els.map((el) => ({
				name: el.getAttribute('role') === 'img' ? (el.getAttribute('aria-label') ?? '') : (el.querySelector('figcaption')?.textContent ?? ''),
				images: el.querySelectorAll('img, image, canvas, picture').length,
				svgText: el.querySelectorAll('svg text').length,
				svgShown: [...el.querySelectorAll('svg')].filter((s) => s.getAttribute('aria-hidden') !== 'true').length,
				text: (el as HTMLElement).innerText.trim()
			}))
		);
		expect(facts.length, `${path}：図がある`).toBeGreaterThan(0);
		for (const f of facts) {
			expect(f.name.trim().length, `${path}：読み上げ用の説明`).toBeGreaterThan(0);
			expect(f.images, `${path}：画像の文字`).toBe(0);
			expect(f.svgText, `${path}：SVG の中の文字`).toBe(0);
			expect(f.svgShown, `${path}：SVG は読み上げない（説明は図の側に付ける）`).toBe(0);
			expect(f.text.length, `${path}：図の中の文字は本物の文字`).toBeGreaterThan(0);
		}
	}
	// 図の部品に日本語の文言を直接書かない（コメントは除く）
	const dir = 'src/lib/components/figures';
	const files = readdirSync(dir).filter((f) => f.endsWith('.svelte'));
	expect(files.length).toBeGreaterThan(0);
	for (const file of files) {
		const code = readFileSync(`${dir}/${file}`, 'utf8')
			.replace(/<!--[\s\S]*?-->/g, '')
			.replace(/\/\*[\s\S]*?\*\//g, '')
			.replace(/\/\/.*$/gm, '');
		expect(code.match(/[぀-ヿ㐀-鿿！-｠]+/g), file).toBeNull();
	}
});

test('基準7：目立たせるところは色のほかでも示し、改正の図は取り消し線と「−」、下線と「＋」', async ({ page }) => {
	await page.goto('/asobikata/2');
	const segments = figures(page).locator('[data-segment]');
	await expect(segments).toHaveCount(3);
	await expect(figures(page)).toContainText('この段');
	for (let i = 0; i < 3; i++) {
		const s = segments.nth(i);
		const current = (await s.getAttribute('data-current')) !== null;
		const style = await s.evaluate((el) => {
			const c = getComputedStyle(el);
			return { weight: Number(c.fontWeight), border: c.borderTopStyle };
		});
		// 色のほかに、太さと線の種類が違う
		if (current) expect(style).toEqual({ weight: 700, border: 'solid' });
		else expect(style).toEqual({ weight: 400, border: 'dashed' });
	}

	await page.goto('/houan/kakikata');
	const kinds = page.locator('#shurui figure[data-figure]');
	const del = kinds.locator('del');
	const ins = kinds.locator('ins');
	expect(await del.count()).toBeGreaterThan(0);
	expect(await ins.count()).toBeGreaterThan(0);
	for (const l of await del.all()) {
		await expect(l).toHaveText(/^−/);
		expect(await l.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe('line-through');
	}
	for (const l of await ins.all()) {
		await expect(l).toHaveText(/^＋/);
		expect(await l.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe('underline');
	}
});

test('基準8：図は画面の横からはみ出さず、図の中の文字は補足の文字より小さくない', async ({ page }) => {
	for (const path of PAGES) {
		await page.goto(path);
		const result = await page.evaluate(() => {
			const probe = document.createElement('div');
			probe.style.fontSize = 'var(--font-size-sub)';
			document.body.appendChild(probe);
			const min = parseFloat(getComputedStyle(probe).fontSize);
			probe.remove();
			const width = document.documentElement.clientWidth;
			const problems: string[] = [];
			if (!document.querySelector('main figure[data-figure]')) problems.push('図がない');
			if (document.documentElement.scrollWidth > width) problems.push(`横に ${document.documentElement.scrollWidth - width}px はみ出す`);
			for (const fig of document.querySelectorAll('main figure[data-figure]')) {
				const f = fig.getBoundingClientRect();
				if (f.left < 0 || f.right > width + 0.5) problems.push(`図が画面の外（${f.left}〜${f.right}）`);
				for (const el of fig.querySelectorAll('*')) {
					const own = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim());
					if (!own) continue;
					const r = el.getBoundingClientRect();
					const size = parseFloat(getComputedStyle(el).fontSize);
					const label = el.textContent!.trim().slice(0, 12);
					if (size < min - 0.01) problems.push(`「${label}」の文字が ${size}px`);
					if (r.left < f.left - 1 || r.right > f.right + 1) problems.push(`「${label}」が図の外`);
				}
			}
			return problems;
		});
		expect(result, path).toEqual([]);
	}
});

test('基準9：図の日付は会期の決まりの値から作り、本文と食い違わない', async ({ page }) => {
	const d = sessionDays();
	const days = [`1〜${d.proposeUntil}日`, `${d.deliberation}〜${d.discussUntil}日`, `${d.vote}日〜月末`];

	await page.goto('/asobikata/2');
	await expectInOrder(figures(page), days);
	await expect(page.getByRole('main')).toContainText(`毎月${d.proposeUntil}日まで`);
	await expect(page.getByRole('main')).toContainText(`毎月1日〜${d.discussUntil}日`);

	await page.goto('/houan/kakikata');
	const flow = page.locator('#nagare figure[data-figure]');
	await expectInOrder(flow, days);
	await expect(page.locator('#nagare')).toContainText(`毎月${d.vote}日から月末まで`);
});
