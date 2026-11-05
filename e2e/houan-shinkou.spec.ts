// Issue #50 法案の状態の進み方（設計書 docs/spec/50.md）。境界の時刻とタブの分け方は src/lib/domain/bills.test.ts と src/lib/db/bills-list.test.ts
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { billRequest, billSupportRequest, createAmendBill, issueWithSolutions, newUser, proposeRequest } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});

type Width = 'sp' | 'pc';
const ip = (w: string, group: number, n: number) => `10.${w === 'sp' ? 50 : 51}.${group}.${n}`;
const stamp = () => Date.now() % 1e8;
const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });

/** テストごと・幅ごとに別の月を使う（2031〜2034年はほかのテストが使っている）。その月と次の月 */
const months = (w: string, year: number) => {
	const [m1, m2] = w === 'sp' ? ['03', '04'] : ['07', '08'];
	return { now: `${year}-${m1}`, next: `${year}-${m2}` };
};
const at = (month: string, day: number) => `${month}-${String(day).padStart(2, '0')}T09:00:00+09:00`;

type User = { page: Page; setNow: (now: string) => Promise<void> };

async function user(browser: Browser, ipAddress: string, now: string, name?: string): Promise<User> {
	const u = await newUser(browser, { name, ip: ipAddress, days: 8 });
	contexts.push(u.context);
	const setNow = (t: string) => u.context.setExtraHTTPHeaders({ 'x-test-ip': ipAddress, 'x-test-now': t });
	await setNow(now);
	return { page: u.page, setNow };
}

/** a の下書きに3人が賛同する。b は賛同した人の1人 */
async function draftWithSupports(browser: Browser, w: string, group: number, now: string) {
	const label = `s${group}-${w}-${stamp()}`;
	const a = await user(browser, ip(w, group, 1), now, `a-${label}`);
	const { ids } = await issueWithSolutions(a.page, label, [`進み方の解決策 ${label}`]);
	const title = `進む法案 ${label}`;
	const bill = await createAmendBill(a.page, title, ids[0]);
	let b: User | undefined;
	for (const n of [2, 3, 4]) {
		const u = await user(browser, ip(w, group, n), now, `u${n}-${label}`);
		const res = await billSupportRequest(u.page, bill, { op: 'add', rev: '1' });
		expect(res.status(), await res.text()).toBe(200);
		b ??= u;
	}
	return { a, b: b as User, bill, title, label };
}

async function proposedBill(browser: Browser, w: string, group: number, now: string) {
	const made = await draftWithSupports(browser, w, group, now);
	const res = await proposeRequest(made.a.page, made.bill);
	expect(res.status(), await res.text()).toBe(200);
	return made;
}

/** いまの状態の出し方：スマホは「いま：」の1行、PC は段階の並び */
function status(page: Page, w: string, sp: string, pc = sp) {
	return w === 'sp' ? page.getByText(`いま：${sp}`, { exact: true }) : page.getByText(`${pc}（いまここ）`, { exact: true });
}

test('基準3：法案のページの状態。スマホは「いま：」と次の日付、PC は段階の並びと日付。「委員会へ」はいまの段にならない', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const { now, next } = months(w, 2035);
	const m = Number(now.slice(5));
	const made = await draftWithSupports(browser, w, 1, at(now, 3));
	const a = made.a.page;
	await a.goto(made.bill);
	await expect(status(a, w, '下書き')).toBeVisible();

	expect((await proposeRequest(a, made.bill)).status()).toBe(200);
	const v = await user(browser, ip(w, 1, 9), at(now, 5));
	const open = async (t: string) => {
		await v.setNow(t);
		await v.page.goto(made.bill);
	};
	const shown = (text: string) => v.page.getByText(text, { exact: true });

	await open(at(now, 5));
	await expect(status(v.page, w, '発議')).toBeVisible();
	await expect(shown(w === 'sp' ? `質疑は${m}月15日から` : `質疑（${m}月15日から）`)).toBeVisible();
	if (w === 'pc') await expect(shown('委員会へ')).toBeVisible();

	await open(at(now, 15));
	await expect(status(v.page, w, '質疑（3週目）', '質疑')).toBeVisible();
	await expect(shown(w === 'sp' ? `採決は${m}月22日から` : `採決（${m}月22日から）`)).toBeVisible();
	if (w === 'pc') await expect(shown('委員会へ（いまここ）')).toHaveCount(0);

	await open(at(now, 22));
	await expect(status(v.page, w, '採決（4週目）', '採決')).toBeVisible();

	await open(at(next, 1));
	await expect(status(v.page, w, '廃案')).toBeVisible();
	if (w === 'pc') await expect(shown('結果')).toHaveCount(0);
});

test('基準4：一覧の段階の列は 発議・質疑中・採決中・廃案で、廃案になると「終わった」のタブに移る', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const { now, next } = months(w, 2036);
	const made = await proposedBill(browser, w, 2, at(now, 5));
	const v = await user(browser, ip(w, 2, 9), at(now, 5));
	const row = (page: Page) => page.getByRole('row').filter({ has: page.getByRole('link', { name: made.title, exact: true }) });
	const expectStage = async (stage: string) => {
		if (w === 'pc') await expect(row(v.page).getByRole('cell', { name: stage, exact: true })).toBeVisible();
		else await expect(row(v.page)).toContainText(`${stage} ・ 賛同 3人`);
	};

	// 未来の日付で作った法案が1ページ目を埋めることがあるので、ページをたどる
	const openRow = async (path: string) => {
		for (let page = 1; page <= 30; page++) {
			await v.page.goto(page === 1 ? path : `${path}${path.includes('?') ? '&' : '?'}page=${page}`);
			if (await row(v.page).count()) return true;
			if ((await v.page.getByRole('link', { name: '次のページ' }).count()) === 0) return false;
		}
		throw new Error('一覧が30ページを超えました');
	};

	expect(await openRow('/houan')).toBe(true);
	await expectStage('発議');
	await v.setNow(at(now, 15));
	expect(await openRow('/houan')).toBe(true);
	await expectStage('質疑中');
	await v.setNow(at(now, 22));
	expect(await openRow('/houan')).toBe(true);
	await expectStage('採決中');

	await v.setNow(at(next, 1));
	expect(await openRow('/houan')).toBe(false);
	expect(await openRow('/houan?tab=owari')).toBe(true);
	await expectStage('廃案');
});

test('基準5：質疑・採決・廃案の法案にはボタンが出ず、送っても受け付けない。賛同の数は出たまま', async ({ browser }, info) => {
	// 3人が3つの時刻で読むので重い（全部の画面のテストと一緒だと30秒に届く）
	test.setTimeout(120_000);
	const w = info.project.name as Width;
	const { now, next } = months(w, 2037);
	const made = await proposedBill(browser, w, 3, at(now, 5));
	const a = made.a;
	const c = await user(browser, ip(w, 3, 5), at(now, 5), `c-${made.label}`);
	expect((await a.page.request.get(`${made.bill}/kaku`)).status()).toBe(403);

	for (const t of [at(now, 15), at(now, 22), at(next, 1)]) {
		for (const u of [a, made.b, c]) {
			await u.setNow(t);
			await u.page.goto(made.bill);
			await expect(u.page.getByText('賛同 3人')).toBeVisible();
			await expect(u.page.getByRole('link', { name: '編集する' })).toHaveCount(0);
			for (const name of ['賛同する', '賛同を取り消す', '発議する']) await expect(u.page.getByRole('button', { name, exact: true })).toHaveCount(0);
		}
		expect((await billSupportRequest(c.page, made.bill, { op: 'add', rev: '1' })).status(), t).toBe(409);
		expect((await billSupportRequest(made.b.page, made.bill, { op: 'remove', rev: '1' })).status(), t).toBe(409);
		expect((await proposeRequest(a.page, made.bill)).status(), t).toBe(409);
		expect((await billRequest(a.page, `${made.bill}/kaku`, { rev: '1' })).status(), t).toBe(403);
		await c.page.goto(made.bill);
		await expect(c.page.getByText('賛同 3人')).toBeVisible();
	}
});

test('基準6：発議しなかった下書きは、次の会期も下書きのままで賛同を数え、提出者が発議できる', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const { now, next } = months(w, 2038);
	const made = await draftWithSupports(browser, w, 4, at(now, 5));
	const a = made.a;
	await a.setNow(at(next, 5));
	await a.page.goto(made.bill);
	await hydrated(a.page);
	await expect(status(a.page, w, '下書き')).toBeVisible();
	await expect(a.page.getByText('賛同 3人')).toBeVisible();
	await a.page.getByRole('button', { name: '発議する', exact: true }).click();
	await expect(status(a.page, w, '発議')).toBeVisible();
});
