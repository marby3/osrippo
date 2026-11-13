// Issue #166：条の「リンク元」（受入基準は Issue #198 の「#166」の節）。
// 非表示・統合済みと下書きを外す決まりの細かいところは src/lib/db/law-backlinks.test.ts。ここでは条だけのページに出ることを確かめる
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { billRequest, billSupportRequest, createAmendBill, newUser, postIssue, proposeRequest, solutionRequest, staffRequest } from './helpers';

const TOKUSHOHO = '351AC0000000057';
const MINPO = '129AC0000000089';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});
test.use({ actionTimeout: 15_000 });
// 発議までの準備が重く、並列で流すと30秒を超えることがある
test.beforeEach(() => test.setTimeout(120_000));

const ip = (w: string, group: number, n: number) => `10.${w === 'sp' ? 164 : 165}.${group}.${n}`;
const stamp = () => Date.now() % 1e8;
/** 幅ごとに別の年を使う（ほかのテストが使っていない年） */
const monthOf = (w: string, group: number) => `${2850 + group * 2 + (w === 'sp' ? 0 : 1)}-05`;
const at = (month: string, day: number) => `${month}-${String(day).padStart(2, '0')}T09:00:00+09:00`;

type User = { page: Page; setNow: (now: string) => Promise<void> };

async function user(browser: Browser, ipAddress: string, now: string, name: string, role?: 'operator'): Promise<User> {
	const u = await newUser(browser, { name, ip: ipAddress, days: 8, role });
	contexts.push(u.context);
	const setNow = (t: string) => u.context.setExtraHTTPHeaders({ 'x-test-ip': ipAddress, 'x-test-now': t });
	await setNow(now);
	return { page: u.page, setNow };
}

const section = (page: Page) => page.getByRole('region', { name: 'この条に触れている議論' });
const billList = (page: Page) => section(page).getByRole('list', { name: 'この条を変える法案' });
const talkList = (page: Page) => section(page).getByRole('list', { name: '課題・解決策・質疑' });

test('基準1・2：条だけのページに、その条を変える法案（下書きは除く）と、触れている課題・解決策・質疑が出る。非表示は出ない', async ({ browser }, info) => {
	const w = info.project.name;
	const s = stamp();
	const month = monthOf(w, 1);
	// 幅ごとに別の条（ほかのテストが触れない条）
	const num = w === 'sp' ? '24_2' : '24_3';
	const label = w === 'sp' ? '第24条の2' : '第24条の3';
	const ref = `特商法${label}`;
	const a = await user(browser, ip(w, 1, 1), at(month, 5), `rm-a-${w}-${s}`);

	const issueTitle = `${ref}を知らずに困った ${w}-${s}`;
	const issueId = await postIssue(a.page, { title: issueTitle, example: `${ref}のとおりにしてほしい` });
	const solutionBody = `${ref}と民法第2条に沿って直す ${w}-${s}`;
	const res = await solutionRequest(a.page, issueId, solutionBody);
	expect(res.status(), await res.text()).toBe(303);
	await a.page.goto(`/kadai/${issueId}/kaiketsu`);
	const solutionId = ((await a.page.locator('article').filter({ hasText: solutionBody }).getAttribute('id')) ?? '').replace('kaiketsu-', '');

	// 発議した法案と、下書きの法案。どちらもこの条を書きかえる
	const target = { law: TOKUSHOHO, num, caption: '（テストの見出し）', label };
	const billTitle = `条を変える法案 ${w}-${s}`;
	const bill = await createAmendBill(a.page, billTitle, solutionId, {}, target);
	for (const n of [2, 3, 4]) {
		const u = await user(browser, ip(w, 1, n), at(month, 5), `rm-u${n}-${w}-${s}`);
		const r = await billSupportRequest(u.page, bill, { op: 'add', rev: '1' });
		expect(r.status(), await r.text()).toBe(200);
	}
	const proposed = await proposeRequest(a.page, bill);
	expect(proposed.status(), await proposed.text()).toBe(200);
	const draftTitle = `下書きの法案 ${w}-${s}`;
	await createAmendBill(a.page, draftTitle, solutionId, {}, target);

	// 3週目の質疑
	const q = await user(browser, ip(w, 1, 5), at(month, 15), `rm-q-${w}-${s}`);
	const questionBody = `${ref}の期間は変えないのですか ${w}-${s}`;
	const qr = await billRequest(q.page, `${bill}/shitsugi/kaku`, { body: questionBody, 'cf-turnstile-response': 'test-pass' });
	expect(qr.status(), await qr.text()).toBeLessThan(400);

	// 非表示にした課題は出ない
	const hiddenTitle = `非表示にする課題 ${ref} ${w}-${s}`;
	const hiddenId = await postIssue(a.page, { title: hiddenTitle, example: `${ref}の話` });
	const op = await user(browser, ip(w, 1, 6), at(month, 15), `rm-op-${w}-${s}`, 'operator');
	expect((await staffRequest(op.page, 'hide', { issue: String(hiddenId), reason: 'spam', note: 'テスト' })).status()).toBeLessThan(400);

	await q.page.goto(`/hourei/${TOKUSHOHO}/${num}`);
	await expect(section(q.page).getByRole('heading', { name: 'この条に触れている議論' })).toBeVisible();
	const bills = billList(q.page);
	await expect(bills.getByRole('link', { name: billTitle })).toHaveAttribute('href', bill);
	await expect(bills.getByRole('listitem').filter({ hasText: billTitle })).toContainText('質疑中');
	await expect(section(q.page).getByText(draftTitle)).toHaveCount(0);

	const talks = talkList(q.page);
	await expect(talks.getByRole('link', { name: issueTitle })).toHaveAttribute('href', `/kadai/${issueId}`);
	await expect(talks.getByRole('listitem').filter({ hasText: issueTitle }).first()).toContainText('課題');
	const solutionItem = talks.getByRole('listitem').filter({ hasText: solutionBody });
	await expect(solutionItem.getByRole('link')).toHaveAttribute('href', `/kadai/${issueId}/kaiketsu#kaiketsu-${solutionId}`);
	await expect(solutionItem).toContainText('解決策');
	const questionItem = talks.getByRole('listitem').filter({ hasText: questionBody });
	await expect(questionItem.getByRole('link')).toHaveAttribute('href', new RegExp(`^${bill}/shitsugi#shitsugi-\\d+$`));
	await expect(questionItem).toContainText('質疑');
	await expect(questionItem).toContainText(billTitle);
	await expect(section(q.page).getByText(hiddenTitle)).toHaveCount(0);

	// 読める法律の条にも、触れている議論が出る（法案の欄はない）
	await q.page.goto(`/hourei/${MINPO}/2`);
	await expect(talkList(q.page).getByRole('listitem').filter({ hasText: solutionBody })).toBeVisible();
	await expect(section(q.page).getByRole('heading', { name: 'この条を変える法案' })).toHaveCount(0);
});

test('基準3：0件のときは「まだありません」。IF世界の条だけのページには出さない', async ({ page }) => {
	// どのテストも触れない条
	await page.goto(`/hourei/${TOKUSHOHO}/36_4`);
	const s = section(page);
	await expect(s.getByRole('heading', { name: 'この条を変える法案' })).toBeVisible();
	await expect(s.getByRole('heading', { name: '課題・解決策・質疑' })).toBeVisible();
	await expect(s.getByText('まだありません')).toHaveCount(2);

	await page.goto(`/if/hourei/${TOKUSHOHO}/36_4`);
	await expect(page.getByRole('heading', { level: 1, name: /第36条の4/ })).toBeVisible();
	await expect(page.getByText('この条に触れている議論')).toHaveCount(0);
});
