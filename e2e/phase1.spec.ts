// フェーズ1 法令ビューアの締めのテスト（Issue #2）。
// 通ったらフェーズ1完了として v0.1 を打つ。それまでは test:phase でだけ回す。
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

type Revision = { law_revision_id: string; amendment_enforcement_date: string; current_revision_status: string };

const LAWS = ['412AC0000000061', '351AC0000000057', '337AC0000000134'];

function revisions(lawId: string): Revision[] {
	const path = new URL(`../tests/fixtures/egov/law_revisions_${lawId}.json`, import.meta.url);
	return JSON.parse(readFileSync(path, 'utf8')).revisions;
}

/** "2023-06-01" → "2023年6月1日" */
function jaDate(iso: string): string {
	const [y, m, d] = iso.split('-').map(Number);
	return `${y}年${m}月${d}日`;
}

for (const lawId of LAWS) {
	test(`改正履歴：${lawId} の2017年4月以降の施行済みの版がすべて並ぶ`, async ({ page }) => {
		await page.goto(`/hourei/${lawId}`);
		const history = page.getByRole('region', { name: '改正履歴' });
		const dates = revisions(lawId)
			.filter((r) => r.current_revision_status !== 'UnEnforced' && r.amendment_enforcement_date >= '2017-04-01')
			.map((r) => jaDate(r.amendment_enforcement_date));
		for (const d of new Set(dates)) await expect(history.getByText(d).first()).toBeVisible();
	});
}

test('2時点の変更点：消費者契約法の削除と追加が記号つきで出る', async ({ page }) => {
	await page.goto('/hourei/412AC0000000061/hikaku');
	// Issue #191 から、改正法を1つ選ぶと直前の版（2023-01-05）と比べる
	await page.getByLabel('改正法').selectOption('412AC0000000061_20230601_504AC0000000059');
	await page.getByRole('button', { name: '見る' }).click();

	const removed = page.locator('del').first();
	const added = page.locator('ins').first();
	await expect(removed).toBeVisible();
	await expect(added).toBeVisible();
	// 色だけで示さない：削除は取り消し線と「−」、追加は下線と「＋」
	await expect(removed).toHaveCSS('text-decoration-line', /line-through/);
	await expect(removed).toContainText('−');
	await expect(added).toHaveCSS('text-decoration-line', /underline/);
	await expect(added).toContainText('＋');
});
