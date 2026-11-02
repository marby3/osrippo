// Issue #10 法令ページ：現在の条文と改正履歴
import { expect, test } from '@playwright/test';

const SHOHISHA = '/hourei/412AC0000000061';

/** 今日（日本時間）までの満年数 */
function fullYears(from: string): number {
	const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
	const years = Number(today.slice(0, 4)) - Number(from.slice(0, 4));
	return today.slice(5) < from.slice(5) ? years - 1 : years;
}

test('基準1：法令名・法令番号・現在の版の条文が出る', async ({ page }) => {
	await page.goto(SHOHISHA);
	await expect(page.getByRole('heading', { level: 1, name: '消費者契約法' })).toBeVisible();
	await expect(page.getByText('平成十二年法律第六十一号')).toBeVisible();
	await expect(page.getByText('2026年6月24日施行の版')).toBeVisible();

	const art4 = page.getByRole('article', { name: '第4条', exact: true });
	await expect(art4).toContainText('（消費者契約の申込み又はその承諾の意思表示の取消し）');
	await expect(art4.getByText(/^一\s*重要事項について事実と異なることを告げること。/)).toBeVisible();
	await expect(art4.getByText(/^2\s*消費者は、事業者が消費者契約の締結について勧誘をするに際し、当該消費者に対してある重要事項/)).toBeVisible();
});

test('基準2：条ごとに最後に改正された時期が出る', async ({ page }) => {
	await page.goto(SHOHISHA);
	await expect(page.getByRole('article', { name: '第4条', exact: true })).toContainText(
		`2023年6月に改正・${fullYears('2023-06-01')}年変わっていない`
	);
	await expect(page.getByRole('article', { name: '第2条', exact: true })).toContainText('2017年4月より前から変更なし');
});

test('基準3：改正履歴に施行済みの版が新しい順に並び、施行予定は別に出る', async ({ page }) => {
	await page.goto(SHOHISHA);
	const history = page.getByRole('region', { name: '改正履歴' });
	const enforced = history.getByRole('list', { name: '施行された改正' }).getByRole('listitem');
	await expect(enforced.first()).toContainText('2026年6月24日');
	await expect(enforced.first()).toContainText('民法等の一部を改正する法律の施行に伴う関係法律の整備等に関する法律');
	await expect(enforced.last()).toContainText('2017年6月2日');
	await expect(enforced).toHaveCount(17);

	const scheduled = history.getByRole('list', { name: '施行予定' }).getByRole('listitem');
	await expect(scheduled).toHaveCount(1);
	await expect(scheduled.first()).toContainText('2028年12月23日');

	await expect(history).toContainText('2017年4月より前の改正は準備中');
	await expect(history).not.toContainText('2016年10月1日');
});

test('基準4：号の細分は見出しごとに改行して出る', async ({ page }) => {
	await page.goto(SHOHISHA);
	const item = page.getByRole('article', { name: '第4条', exact: true }).getByText(/^五\s*当該消費者が、社会生活上の経験が乏しいことから/);
	const text = await item.innerText();
	expect(text).toMatch(/\nイ\s*進学、就職、結婚、生計/);
	expect(text).toMatch(/\nロ\s*容姿、体型/);
});

test('基準5：全ページのフッターに非公式サービスの表示が出る', async ({ page }) => {
	for (const path of ['/', SHOHISHA]) {
		await page.goto(path);
		await expect(page.getByRole('contentinfo')).toContainText('国会・政府とは無関係の非公式サービスです');
	}
});

test('基準6：ない法令IDは 404', async ({ page }) => {
	const res = await page.goto('/hourei/000AC0000000000');
	expect(res?.status()).toBe(404);
});

test('URL の法令IDが崩れていても 404', async ({ page }) => {
	for (const id of ["'%20OR%201=1--", '%E3%81%82', '412AC0000000061%00']) {
		const res = await page.goto(`/hourei/${id}`);
		expect(res?.status(), id).toBe(404);
	}
});
