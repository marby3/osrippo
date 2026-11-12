// Issue #143：法令用語のかんたんな説明（基準2・3）。一覧と当て方（基準1・4）は src/lib/domain/law/glossary-notes.test.ts
import { expect, test, type Browser, type Page } from '@playwright/test';
import { createAmendBill, issueWithSolutions, newUser, ORIGIN } from './helpers';

const LAW = '351AC0000000057';
const DISCLAIMER = '運営が書いたかんたんな説明です。正確な意味は条文で確かめてください。';
const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
/** 第17条（電話勧誘販売の再勧誘の禁止）：「役務」「勧誘」がある */
const article17 = (page: Page) => page.locator('[id="jo-17"]');
/** 説明のある言葉（ボタン）。読み仮名は CSS で描くので、名前の頭が言葉になる */
const term = (scope: Page | ReturnType<Page['locator']>, word: string) => scope.getByRole('button', { name: new RegExp(`^${word}`) });
const decoration = (el: ReturnType<Page['locator']>) => el.evaluate((e) => getComputedStyle(e).textDecorationStyle);
const popoverOf = async (page: Page, button: ReturnType<Page['locator']>) => page.locator(`[id="${await button.getAttribute('popovertarget')}"]`);

/** 特定商取引法 第17条の「当該売買契約又は当該役務提供契約の締結について」を消す法案（変更点のページ） */
async function billChanges(browser: Browser, w: string) {
	const u = await newUser(browser, { name: `setsu${w}${Date.now() % 1e7}`, ip: `10.143.0.${w === 'sp' ? 1 : 2}`, days: 8 });
	const { articles } = (await (await u.page.request.get(`/houan/kaku/joubun?law=${LAW}`)).json()) as { articles: { num: string; caption: string }[] };
	const caption = articles.find((a) => a.num === '17')!.caption;
	const { ids } = await issueWithSolutions(u.page, `説明の法案 ${w}${Date.now() % 1e7}`, ['解決策']);
	const bill = await createAmendBill(
		u.page,
		`説明の法案 ${w}`,
		ids[0],
		{ 'body.0': '販売業者又は役務提供事業者は、電話勧誘販売に係る売買契約又は役務提供契約を締結しない旨の意思を表示した者に対し、勧誘をしてはならない。' },
		{ law: LAW, num: '17', caption, label: '第17条' }
	);
	return { ...u, bill };
}

test('基準2：読み仮名と同じ場所で、説明のある言葉に点線の下線が付く。ふりがなを付けなくても出る。変更点の印は残る', async ({ browser }, info) => {
	test.setTimeout(120_000);
	const { page, context, bill } = await billChanges(browser, info.project.name);
	for (const path of [`/hourei/${LAW}`, `/if/hourei/${LAW}`]) {
		await page.goto(path);
		const word = term(article17(page), '役務').first();
		await expect(word, path).toBeVisible();
		expect(await decoration(word), path).toBe('dotted');
		// 説明のない言葉（読み仮名だけ）はボタンにしない
		await expect(term(article17(page), '勧誘'), path).toHaveCount(0);
	}
	await page.goto(`${bill}/henkou`);
	// 消した部分の「役務」にも説明が付き、「−」と取り消し線は残る
	const removed = page.locator('del', { has: page.getByRole('button', { name: /^役務/ }) }).first();
	await expect(removed).toBeVisible();
	expect((await removed.textContent())!.startsWith('−')).toBe(true);
	expect(await removed.evaluate((el) => getComputedStyle(el).textDecorationLine)).toContain('line-through');
	await page.goto(`${bill}/zenbun`);
	await expect(term(page, '役務').first()).toBeVisible();

	// ふりがなを付けない設定でも、説明は出る
	await page.request.post('/hyouji', { form: { back: '/', size: 'm', ruby: 'off' }, headers: { origin: ORIGIN }, maxRedirects: 0 });
	await page.goto(`/hourei/${LAW}`);
	await expect(article17(page).locator('rt').first()).toBeHidden();
	await expect(term(article17(page), '役務').first()).toBeVisible();
	await context.close();
});

test('基準3：押すと言葉のすぐ下に説明が開き、もう一度押す・Esc・枠の外で閉じる。ほかを開くと前は閉じる。キーボードでも開ける', async ({ page }) => {
	await page.goto(`/hourei/${LAW}`);
	await hydrated(page);
	const word = term(article17(page), '役務').first();
	const pop = await popoverOf(page, word);
	await expect(pop).toBeHidden();
	await expect(word).toHaveAttribute('aria-expanded', 'false');

	await word.click();
	await expect(pop).toBeVisible();
	await expect(word).toHaveAttribute('aria-expanded', 'true');
	await expect(pop).toContainText('役務');
	await expect(pop).toContainText('えきむ');
	await expect(pop).toContainText('人のためにする仕事やサービス');
	await expect(pop).toContainText(DISCLAIMER);
	// 言葉のすぐ下
	const [w, p] = [await word.boundingBox(), await pop.boundingBox()];
	expect(w && p && p.y >= w.y + w.height - 1 && p.y <= w.y + w.height + 24).toBe(true);

	// もう一度押すと閉じる
	await word.click();
	await expect(pop).toBeHidden();
	await expect(word).toHaveAttribute('aria-expanded', 'false');
	// Esc で閉じる
	await word.click();
	await expect(pop).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(pop).toBeHidden();
	// 枠の外を押すと閉じる
	await word.click();
	await expect(pop).toBeVisible();
	await page.getByRole('heading', { level: 1 }).click();
	await expect(pop).toBeHidden();
	// ほかの言葉を開くと、前の枠は閉じる
	const other = term(page, '準用').first();
	await word.click();
	await expect(pop).toBeVisible();
	await other.scrollIntoViewIfNeeded();
	await other.click();
	await expect(await popoverOf(page, other)).toBeVisible();
	await expect(pop).toBeHidden();
	await page.keyboard.press('Escape');

	// キーボードで開く
	await word.focus();
	await page.keyboard.press('Enter');
	await expect(pop).toBeVisible();
});
