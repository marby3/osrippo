// Issue #163 基準3・4と信頼の境界：法律の一覧と検索（画面の案 SpLaws・PcLaws）。基準1・2 の中身は src/lib/db/law-list.test.ts。
// 読める法律は db:reset でテストデータの一覧から入る（民法・日本国憲法と、遊べる3法）
import { expect, test, type Page } from '@playwright/test';

const MINPO = '民法';
const KENPO = '日本国憲法';
const SHOHIN = '不当景品類及び不当表示防止法';
const TOKUSHO = '特定商取引に関する法律';
const SHOHISHA = '消費者契約法';

const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
/** 読める法律の一覧 */
const readable = (page: Page) => page.getByRole('table', { name: /読める法律/ });
/** 一覧に並んだ法令名（略称の括弧を除く。上から） */
const listedTitles = async (page: Page) =>
	(await readable(page).getByRole('rowheader').getByRole('link').allInnerTexts()).map((t) => t.replace(/（.*$/s, '').trim());

test('基準3：分野で絞り込み、五十音／最近の改正／長く変わっていない順で並べ替えられる。PC には五十音の索引が出る', async ({ page }, info) => {
	await page.goto('/hourei');
	await hydrated(page);
	// 既定は五十音の順
	expect(await listedTitles(page)).toEqual([SHOHISHA, TOKUSHO, KENPO, SHOHIN, MINPO]);

	// 分野で絞り込む
	await page.getByRole('navigation', { name: '分野' }).getByRole('link', { name: /^民事/ }).click();
	await expect(page).toHaveURL(/[?&]bunya=/);
	expect(await listedTitles(page)).toEqual([MINPO]);

	// 並び順（スマホは選ぶ欄、PC は丸い選択肢）。変わった日は最後の改正日、なければ公布日
	const sortBy = async (label: string) => {
		await page.goto('/hourei');
		await hydrated(page);
		if (info.project.name === 'sp') await page.getByRole('combobox', { name: '並び順' }).selectOption({ label });
		else await page.getByRole('navigation', { name: '並び順' }).getByRole('link', { name: label, exact: true }).click();
		await expect(page).toHaveURL(/[?&]narabi=/);
	};
	await sortBy('最近の改正');
	expect(await listedTitles(page)).toEqual([TOKUSHO, SHOHISHA, SHOHIN, MINPO, KENPO]);
	await sortBy('長く変わっていない');
	expect(await listedTitles(page)).toEqual([KENPO, MINPO, SHOHIN, SHOHISHA, TOKUSHO]);

	// 五十音の索引：PC だけに出る
	await page.goto('/hourei');
	const index = page.getByRole('navigation', { name: '五十音の索引' });
	if (info.project.name === 'sp') {
		await expect(index).toBeHidden();
		return;
	}
	await expect(index).toBeVisible();
	await index.getByRole('link', { name: 'ま', exact: true }).click();
	await expect(page).toHaveURL(/[?&]kana=ma/);
	expect(await listedTitles(page)).toEqual([MINPO]);
	await expect(page.getByRole('navigation', { name: '五十音の索引' }).getByRole('link', { name: 'ま', exact: true })).toHaveAttribute('aria-current', 'page');
});

test('基準4：「いま遊べる法律」がいちばん上に出て、遊べる法律と読める法律は文字でも見分けられる', async ({ page }) => {
	await page.goto('/hourei');
	const playable = page.getByRole('region', { name: /いま遊べる法律/ });
	await expect(playable).toContainText('消費者保護委員会の対象');
	for (const title of [SHOHIN, TOKUSHO, SHOHISHA]) {
		const card = playable.getByRole('listitem').filter({ hasText: title });
		await expect(card).toHaveCount(1);
		await expect(card).toContainText('遊べる');
	}
	// いちばん上：読める法律の一覧より前
	const top = (await playable.boundingBox())!.y;
	expect(top).toBeLessThan((await readable(page).boundingBox())!.y);

	// 読める法律の一覧は遊べる法律も含み、遊べる法律の行にだけ「遊べる」が付く
	await expect(page.getByRole('heading', { name: /読める法律/ })).toContainText('遊べる法律も含む');
	const row = (title: string) => readable(page).getByRole('row').filter({ has: page.getByRole('rowheader').filter({ hasText: title }) });
	await expect(row(SHOHISHA)).toContainText('遊べる');
	await expect(row(MINPO)).not.toContainText('遊べる');
	await expect(row(KENPO)).not.toContainText('遊べる');
	// 行は法令番号・最後の改正（制定から改正のない法律はそう書く）
	await expect(row(MINPO)).toContainText('明治29年法律第89号');
	await expect(row(MINPO)).toContainText('2020年4月');
	await expect(row(KENPO)).toContainText('制定から変わっていない');
});

test('信頼の境界：形の違う一覧のパラメータは 404。形の違う言葉は理由を出し、記号はただの文字として探す', async ({ page, request }) => {
	for (const extra of [
		'page=0',
		'page=1',
		'page=-1',
		'page=abc',
		'page=01',
		'page=2',
		'page=99999',
		'narabi=',
		'narabi=gojuon',
		'narabi=KAISEI',
		'kana=',
		'kana=ka%27',
		'kana=%E3%81%8B',
		'kana=n',
		'bunya=',
		'bunya=%E3%81%AA%E3%81%84%E5%88%86%E9%87%8E',
		`bunya=${'a'.repeat(300)}`,
		'q=%E6%B0%91%E6%B3%95&page=2'
	])
		expect((await request.get(`/hourei?${extra}`)).status(), extra).toBe(404);
	expect((await request.get('/hourei?narabi=nagai&kana=ma&bunya=%E6%B0%91%E4%BA%8B')).status()).toBe(200);

	// 長すぎる言葉と使えない文字は、200 で理由を出し、一覧を空にする
	const reason = async (q: string, message: string) => {
		const res = await page.goto(`/hourei?q=${encodeURIComponent(q)}`);
		expect(res?.status(), q).toBe(200);
		await expect(page.getByRole('alert')).toHaveText(message);
		await expect(readable(page)).toHaveCount(0);
	};
	await reason('あ'.repeat(61), '60字まで、言葉は5つまでで入力してください');
	await reason('\u202e民法', '使えない文字が入っています');
	await reason('%_', '2文字以上で入力してください');

	// LIKE の記号と FTS の構文は、ただの文字として扱う
	await page.goto(`/hourei?q=${encodeURIComponent('民法%')}`);
	expect(await listedTitles(page)).toEqual([MINPO]);
	// 引用符は除いて探す。読める法律の条文（3文字以上）と、遊べる法律の条文（2文字から）が「条文から」に出る
	await page.goto(`/hourei?q=${encodeURIComponent('"公共の福祉"')}`);
	const articles = page.getByRole('region', { name: '条文から' });
	await expect(articles.getByRole('link', { name: /民法 第1条/ })).toHaveAttribute('href', '/hourei/129AC0000000089#jo-1');
	await page.goto(`/hourei?q=${encodeURIComponent('契約')}`);
	await expect(articles.getByRole('link').first()).toHaveAttribute('href', /^\/hourei\/(337AC0000000134|351AC0000000057|412AC0000000061)#jo-/);
	await expect(articles).toContainText('ほかの法律の条文は3文字以上で探せます');
	const res = await page.goto(`/hourei?q=${encodeURIComponent('"公共の福祉" OR NEAR(')}`);
	expect(res?.status()).toBe(200);
	await expect(readable(page)).toHaveCount(0);
	await expect(page.getByRole('region', { name: '条文から' })).toContainText('見つかりませんでした');
});
