// Issue #124：法令のページと比較の見た目を案に合わせる（SpLaw・PcLaw・PcCompare）
import { expect, test, type Locator, type Page } from '@playwright/test';

const LAW = '351AC0000000057';
const REAL = `/hourei/${LAW}`;
const IF = `/if/hourei/${LAW}`;
const COMPARE = `/hourei/${LAW}/hikaku?mae=${LAW}_20170602_428AC0000000060&ato=${LAW}_20171201_428AC0000000060`;
const sp = (name: string) => name === 'sp';
type Box = { x: number; y: number; width: number; height: number };
const box = async (target: Locator): Promise<Box> => (await target.boundingBox())!;
const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
const switcher = (page: Page) => page.getByRole('navigation', { name: '現実の法律とIF世界の法律' });
const toc = (page: Page) => page.getByRole('navigation', { name: '目次', exact: true });
/** CSS 変数を色の値（rgb）にする */
const color = (page: Page, name: string) =>
	page.evaluate((v) => {
		const probe = document.createElement('span');
		probe.style.color = `var(${v})`;
		document.body.appendChild(probe);
		const value = getComputedStyle(probe).color;
		probe.remove();
		return value;
	}, name);

test('基準1：PC は切り替えを法令名の行の右に置き、スマホは法令名の上に横いっぱい', async ({ page }, info) => {
	for (const path of [REAL, IF]) {
		await page.goto(path);
		const h1 = await box(page.getByRole('heading', { level: 1 }));
		const s = await box(switcher(page));
		if (sp(info.project.name)) {
			expect(s.y + s.height, path).toBeLessThanOrEqual(h1.y);
			expect(Math.round(s.width), path).toBe(page.viewportSize()!.width - 32);
		} else {
			expect(s.x, path).toBeGreaterThan(h1.x + h1.width);
			// 法令名の行と高さが重なる
			expect(s.y, path).toBeLessThan(h1.y + h1.height);
			expect(s.y + s.height, path).toBeGreaterThan(h1.y);
			const mine = await box(page.getByRole('banner').getByRole('link', { name: 'わたしの記録', exact: true }));
			expect(Math.abs(s.x + s.width - (mine.x + mine.width)), path).toBeLessThanOrEqual(1);
		}
	}
});

test('基準2：IF世界を開いているときは「IF世界の法律」を紫の塗りに白い文字、「現実の法律」を白地に灰色の枠', async ({ page }) => {
	await page.goto(IF);
	const ifLink = switcher(page).getByRole('link', { name: 'IF世界の法律' });
	const real = switcher(page).getByRole('link', { name: '現実の法律' });
	await expect(ifLink).toHaveAttribute('aria-current', 'page');
	await expect(ifLink).toHaveCSS('background-color', await color(page, '--color-if'));
	await expect(ifLink).toHaveCSS('color', await color(page, '--color-bg'));
	await expect(real).toHaveCSS('background-color', await color(page, '--color-bg'));
	await expect(real).toHaveCSS('border-top-color', await color(page, '--color-input-border'));
	// 現実の法律を開いているときはいまのまま
	await page.goto(REAL);
	await expect(switcher(page).getByRole('link', { name: 'IF世界の法律' })).toHaveCSS('background-color', await color(page, '--color-if-bg'));
	await expect(switcher(page).getByRole('link', { name: '現実の法律' })).toHaveCSS('border-top-color', await color(page, '--color-base'));
});

test('基準3：IF世界の目次は、スマホは「目次から探す」で開き、PC は現実の法律と同じ見た目', async ({ page }, info) => {
	const name = '第三章　連鎖販売取引';
	if (sp(info.project.name)) {
		await page.goto(IF);
		await hydrated(page);
		await expect(toc(page)).toBeHidden();
		await page.getByRole('button', { name: '目次から探す' }).click();
		await expect(toc(page).getByRole('link', { name })).toBeVisible();
		return;
	}
	const look = async (path: string) => {
		await page.goto(path);
		const link = toc(page).getByRole('link', { name });
		await expect(link).toBeVisible();
		return link.evaluate((el) => {
			const s = getComputedStyle(el);
			return { color: s.color, size: s.fontSize, line: (el.parentElement as HTMLElement).getBoundingClientRect().height, decoration: s.textDecorationLine };
		});
	};
	expect(await look(IF)).toEqual(await look(REAL));
});

test('基準4：PC の目次は、いま画面のいちばん上に出ている章を太字にし aria-current を付ける。読み進めると変わる', async ({ page }, info) => {
	test.skip(sp(info.project.name), 'PC の案（PcLaw）');
	for (const path of [REAL, IF]) {
		await page.goto(path);
		await hydrated(page);
		const first = toc(page).getByRole('link', { name: '第一章　総則' });
		const third = toc(page).getByRole('link', { name: '第三章　連鎖販売取引' });
		// 開いたときは最初の章
		await expect(first, path).toHaveAttribute('aria-current', 'location');
		await expect(first, path).toHaveCSS('font-weight', '700');
		await expect(third, path).not.toHaveAttribute('aria-current', /.+/);
		// 第三章へ移ると、第三章に変わる
		await third.click();
		await expect(third, path).toHaveAttribute('aria-current', 'location');
		await expect(third, path).toHaveCSS('font-weight', '700');
		await expect(first, path).not.toHaveAttribute('aria-current', /.+/);
		await expect(first, path).not.toHaveCSS('font-weight', '700');
	}
});

test('基準5：PC の比較は、変わった条ごとに注記の行と見出しの行のある1つの表。スマホはいまのまま', async ({ page }, info) => {
	await page.goto(COMPARE);
	const article = page.getByRole('article').first();
	const after = article.getByRole('region', { name: '改正後' });
	const before = article.getByRole('region', { name: '改正前' });
	const note = article.getByText('線を引いた部分がちがうところです', { exact: true });
	if (sp(info.project.name)) {
		// 改正前が上の縦並びで、注記は出さない
		expect((await box(before)).y).toBeLessThan((await box(after)).y);
		await expect(note).toBeHidden();
		return;
	}
	const table = after.locator('xpath=..');
	await expect(table).toHaveCSS('border-top-width', '1px');
	await expect(table).not.toHaveCSS('border-top-left-radius', '0px');
	// 表の中の左右は角丸の箱ではない
	await expect(after).toHaveCSS('border-top-left-radius', '0px');
	await expect(before).toHaveCSS('border-top-left-radius', '0px');
	const t = await box(table);
	const n = await box(note);
	const ha = await box(after.getByRole('heading', { name: '改正後' }));
	const hb = await box(before.getByRole('heading', { name: '改正前' }));
	// いちばん上の行に注記、次の行に見出し（改正後が左、改正前が右）
	expect(n.y).toBeGreaterThanOrEqual(t.y);
	expect(n.y + n.height).toBeLessThanOrEqual(ha.y);
	expect(Math.abs(ha.y - hb.y)).toBeLessThanOrEqual(1);
	expect(ha.x).toBeLessThan(hb.x);
	expect(n.x).toBeLessThan(ha.x + 32);
});
