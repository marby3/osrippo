// Issue #59 法案の書き方のページ（/houan/kakikata）
import { expect, test, type Page } from '@playwright/test';
import { BILL_MAX, PROPOSAL_MIN, PROPOSAL_PERCENT } from '../src/lib/domain/bills';
import { DAY, LIMITS } from '../src/lib/domain/limits';

const SECTIONS = ['法案ができるまで', '書き始める', '法案の種類', '変える条の書き方', '2本以上の法令', '発議まで', '発議のあと'];
const box = async (page: Page, l: ReturnType<Page['getByRole']>) => (await l.boundingBox())!;

test('基準1：一覧の案の場所に「法案の書き方を見る」が出て、書き方のページを開く。「法案を書く」は出ない', async ({ page }, info) => {
	await page.goto('/houan');
	await expect(page.getByRole('link', { name: '法案を書く' })).toHaveCount(0);
	const link = page.getByRole('link', { name: '法案の書き方を見る' });
	// スマホは一覧の下（SpBills）、PC は見出しの右（PcBills）
	const at = await box(page, link);
	const tabs = await box(page, page.getByRole('navigation', { name: '法案のタブ' }));
	if (info.project.name === 'sp') expect(at.y).toBeGreaterThan(tabs.y);
	else expect(at.y).toBeLessThan(tabs.y);
	await link.click();
	await expect(page).toHaveURL('/houan/kakikata');
	await expect(page.getByRole('heading', { level: 1, name: '法案の書き方' })).toBeVisible();
});

test('基準2：ログインなしで7つの節と目次が出て、目次から節へ移る。条の書き方の例と、最後に課題の一覧へのリンク', async ({ page }) => {
	await page.goto('/houan/kakikata');
	const toc = page.getByRole('navigation', { name: '目次' });
	await expect(toc.getByRole('link')).toHaveText(SECTIONS);
	for (const name of SECTIONS) await expect(page.getByRole('heading', { level: 2, name, exact: true })).toBeVisible();
	await toc.getByRole('link', { name: '発議のあと' }).click();
	await expect(page).toHaveURL(/#.+$/);
	await expect(page.getByRole('heading', { level: 2, name: '発議のあと', exact: true })).toBeInViewport();

	const flow = page.getByRole('region', { name: '法案ができるまで' });
	await expect(flow).toContainText('毎月15日');
	await expect(flow).toContainText('毎月22日');
	await expect(flow).toContainText('IF世界の法律');
	const howto = page.getByRole('region', { name: '変える条の書き方' });
	await expect(howto).toContainText('2　');
	await expect(howto).toContainText('一　');
	await expect(howto).toContainText('第3条の2');
	await expect(page.getByRole('region', { name: '法案の種類' })).toContainText('第1条');
	await expect(page.getByRole('region', { name: '発議まで' })).toContainText('毎月14日');
	await expect(page.getByText('法案は、課題の解決策から書き始めます')).toBeVisible();
	await expect(page.getByRole('link', { name: '課題の一覧へ' })).toHaveAttribute('href', '/kadai');
});

test('基準3：数字はルールの値から出す（登録からの日数、解決策の数、法令の数、条の数、賛同の割合と最低の人数）', async ({ page }) => {
	await page.goto('/houan/kakikata');
	await expect(page.getByRole('region', { name: '書き始める' })).toContainText(`登録から${LIMITS.billAccountAge / DAY}日`);
	await expect(page.getByRole('region', { name: '書き始める' })).toContainText(`${BILL_MAX.solutions}つまで`);
	await expect(page.getByRole('region', { name: '2本以上の法令' })).toContainText(`${BILL_MAX.laws}本まで`);
	await expect(page.getByRole('region', { name: '2本以上の法令' })).toContainText(`${BILL_MAX.changes}条まで`);
	await expect(page.getByRole('region', { name: '発議まで' })).toContainText(`${PROPOSAL_PERCENT}%（最低${PROPOSAL_MIN}人）`);
});
