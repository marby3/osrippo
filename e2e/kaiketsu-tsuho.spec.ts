// Issue #36 解決策の通報と非表示（設計書 docs/spec/36.md）
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import {
	newUser,
	postIssue,
	reactRequest,
	reportRequest,
	reportSolutionRequest,
	solutionRequest,
	solutionStaffRequest
} from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});

const ip = (project: string, test: number, n: number) => `10.${project === 'sp' ? 9 : 10}.${test}.${n}`;
const stamp = () => Date.now() % 1e8;
const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });

async function user(
	browser: Browser,
	name: string,
	ipAddress: string,
	opts: { days?: number; role?: 'moderator' | 'operator'; country?: string } = {}
): Promise<Page> {
	const u = await newUser(browser, { name, ip: ipAddress, ...opts });
	contexts.push(u.context);
	return u.page;
}

/** 課題と、その解決策を1つ作り、課題の番号と解決策の番号を返す */
async function issueWithSolution(author: Page, writer: Page, title: string, body: string) {
	const issueId = await postIssue(author, { title });
	const res = await solutionRequest(writer, issueId, body);
	expect(res.status(), await res.text()).toBe(303);
	return { issueId, solutionId: await solutionIdOf(writer, issueId, body) };
}

async function solutionIdOf(page: Page, issueId: number, body: string) {
	await page.goto(`/kadai/${issueId}/kaiketsu`);
	const id = await page.locator('article').filter({ hasText: body }).first().getAttribute('id');
	expect(id).toMatch(/^kaiketsu-\d+$/);
	return (id as string).replace('kaiketsu-', '');
}

/** 登録から2日たった別々の n 人に解決策を通報させる */
async function reportBy(browser: Browser, issueId: number, solutionId: string, prefix: string, ipAddress: string, n: number) {
	for (let i = 0; i < n; i++) {
		const r = await user(browser, `${prefix}${i}`, ipAddress);
		expect((await reportSolutionRequest(r, issueId, { solution: solutionId, reason: 'attack' })).status()).toBe(200);
	}
}

test('基準1：理由を選んで解決策を通報すると受け付け、通報済みになる。自分の解決策には出さず、ログインしていなければログインへ', async ({ browser, page }, info) => {
	const p = info.project.name;
	const s = stamp();
	const author = await user(browser, `st1-author-${p}-${s}`, ip(p, 1, 1));
	const writer = await user(browser, `st1-writer-${p}-${s}`, ip(p, 1, 2));
	const body = `通報される解決策 ${s}`;
	const { issueId, solutionId } = await issueWithSolution(author, writer, `解決策の通報 ${p}-${s}`, body);

	// 自分の解決策には出さない
	await writer.goto(`/kadai/${issueId}`);
	await expect(writer.locator('article').filter({ hasText: body }).getByRole('button', { name: 'この解決策を通報する' })).toHaveCount(0);

	// ログインしていなければログインへ
	await page.goto(`/kadai/${issueId}`);
	await page.locator('article').filter({ hasText: body }).getByRole('button', { name: 'この解決策を通報する' }).click();
	await expect(page).toHaveURL(`/login?next=%2Fkadai%2F${issueId}`);

	const b = await user(browser, `st1-b-${p}-${s}`, ip(p, 1, 3));
	await b.goto(`/kadai/${issueId}`);
	await hydrated(b);
	const card = b.locator('article').filter({ hasText: body });
	await card.getByRole('button', { name: 'この解決策を通報する' }).click();
	await card.getByRole('radio', { name: 'その他' }).check();
	await card.getByLabel('その他の説明').fill('宣伝のような書き方');
	await card.getByRole('button', { name: '通報する', exact: true }).click();
	await expect(card.getByText('通報を受け付けました')).toBeVisible();
	await b.reload();
	await expect(card.getByText('この解決策は通報済みです')).toBeVisible();
	await expect(card.getByRole('button', { name: 'この解決策を通報する' })).toHaveCount(0);

	const again = await reportSolutionRequest(b, issueId, { solution: solutionId, reason: 'spam' });
	expect(again.status()).toBe(200);
	expect(await again.text()).toContain('この解決策は通報済みです');
});

test('基準2：登録から24時間たった別々の3人の通報で、解決策はほかの人から見えなくなり、何もできなくなる', async ({ browser, page }, info) => {
	const p = info.project.name;
	const s = stamp();
	const author = await user(browser, `st2-author-${p}-${s}`, ip(p, 2, 1));
	const writer = await user(browser, `st2-writer-${p}-${s}`, ip(p, 2, 2));
	const title = `解決策の自動非表示 ${p}-${s}`;
	const body = `自動で消える解決策 ${s}`;
	const { issueId, solutionId } = await issueWithSolution(author, writer, title, body);

	// 数えない通報（登録したばかり）と、数える2人。2人目は2回送る
	const fresh = await user(browser, `st2-new-${p}-${s}`, ip(p, 2, 3), { days: 0 });
	expect((await reportSolutionRequest(fresh, issueId, { solution: solutionId })).status()).toBe(200);
	await reportBy(browser, issueId, solutionId, `st2-r-${p}-${s}-`, ip(p, 2, 4), 2);
	await page.goto(`/kadai/${issueId}`);
	await expect(page.getByText(body)).toBeVisible();

	await reportBy(browser, issueId, solutionId, `st2-r3-${p}-${s}-`, ip(p, 2, 5), 1);

	await page.goto(`/kadai/${issueId}`);
	await expect(page.getByRole('heading', { name: /^解決策\s*0件$/ })).toBeVisible();
	await expect(page.getByText(body)).toHaveCount(0);
	await page.goto(`/kadai/${issueId}/kaiketsu`);
	await expect(page.getByText(body)).toHaveCount(0);
	await expect(page.getByRole('heading', { name: '非表示の解決策' })).toHaveCount(0);
	await page.goto('/kadai?sort=new');
	const row = page.locator('tr').filter({ has: page.getByRole('link', { name: title, exact: true }) });
	await expect(row.locator('td').nth(2)).toHaveText(/^\s*(解決策)?\s*0\s*$/);
	await page.goto('/kadai?sort=new&kaiketsu=ari');
	await expect(page.getByRole('link', { name: title, exact: true })).toHaveCount(0);

	const other = await user(browser, `st2-other-${p}-${s}`, ip(p, 2, 6));
	const reacted = await reactRequest(other, issueId, { solution: solutionId, kind: 'support', op: 'add' });
	expect(reacted.status()).toBe(403);
	expect(await reacted.text()).toContain('非表示の解決策には操作できません');
	const reported = await reportSolutionRequest(other, issueId, { solution: solutionId, reason: 'spam' });
	expect(reported.status()).toBe(403);
	expect(await reported.text()).toContain('非表示の解決策には操作できません');
});

test('基準3：書いた本人と運営・運営協力者には、解決策の一覧の「非表示の解決策」に本文と理由を出す', async ({ browser }, info) => {
	const p = info.project.name;
	const s = stamp();
	const author = await user(browser, `st3-author-${p}-${s}`, ip(p, 3, 1));
	const writer = await user(browser, `st3-writer-${p}-${s}`, ip(p, 3, 2));
	const body = `本人と運営に見える解決策 ${s}`;
	const { issueId, solutionId } = await issueWithSolution(author, writer, `非表示の解決策の見え方 ${p}-${s}`, body);
	await reportBy(browser, issueId, solutionId, `st3-r-${p}-${s}-`, ip(p, 3, 3), 3);

	for (const [viewer, staff] of [
		[writer, false],
		[await user(browser, `st3-mod-${p}-${s}`, ip(p, 3, 4), { role: 'moderator' }), true],
		[await user(browser, `st3-op-${p}-${s}`, ip(p, 3, 5), { role: 'operator' }), true]
	] as const) {
		await viewer.goto(`/kadai/${issueId}`);
		await expect(viewer.getByText(body)).toHaveCount(0);
		await viewer.getByRole('link', { name: '非表示の解決策を見る' }).click();
		await expect(viewer).toHaveURL(`/kadai/${issueId}/kaiketsu`);
		await expect(viewer.getByRole('heading', { name: '非表示の解決策' })).toBeVisible();
		const card = viewer.locator('article').filter({ hasText: body });
		await expect(card).toContainText('この解決策は通報により非表示になっています');
		await expect(card.getByRole('button')).toHaveCount(0);
		await expect(card.getByRole('link', { name: 'この解決策に運営として対応する' })).toHaveCount(staff ? 1 : 0);
	}
	// 課題を書いた人（解決策を書いていない、運営でもない）には出さない
	await author.goto(`/kadai/${issueId}/kaiketsu`);
	await expect(author.getByText(body)).toHaveCount(0);
});

test('基準4：「通報を受けた解決策」は運営と運営協力者だけ。自動で非表示を先に、課題・本文・数・理由・説明つきで出す', async ({ browser, page }, info) => {
	const p = info.project.name;
	const s = stamp();
	const author = await user(browser, `st4-author-${p}-${s}`, ip(p, 4, 1));
	const writer = await user(browser, `st4-writer-${p}-${s}`, ip(p, 4, 2));
	const issueTitle = `管理の解決策 ${p}-${s}`;
	const shownBody = `通報1件の解決策 ${s}`;
	const hiddenBody = `通報3件の解決策 ${s}`;
	const issueId = await postIssue(author, { title: issueTitle });
	for (const b of [shownBody, hiddenBody]) expect((await solutionRequest(writer, issueId, b)).status()).toBe(303);
	const shownId = await solutionIdOf(writer, issueId, shownBody);
	const hiddenId = await solutionIdOf(writer, issueId, hiddenBody);
	const reporterName = `st4-reporter-${p}-${s}`;
	const reporter = await user(browser, reporterName, ip(p, 4, 3));
	expect((await reportSolutionRequest(reporter, issueId, { solution: shownId, reason: 'other', note: `説明 ${s}` })).status()).toBe(200);
	await reportBy(browser, issueId, hiddenId, `st4-r-${p}-${s}-`, ip(p, 4, 4), 3);

	// ログインしていない人、ふつうの参加者には、表示も操作も 404
	expect((await page.request.get(`/kanri?solution=${shownId}`)).status()).toBe(404);
	expect((await solutionStaffRequest(page, 'hideSolution', { solution: shownId, reason: 'spam', note: 'メモ' })).status()).toBe(404);
	expect((await reporter.request.get(`/kanri?solution=${shownId}`)).status()).toBe(404);
	expect((await solutionStaffRequest(reporter, 'hideSolution', { solution: shownId, reason: 'spam', note: 'メモ' })).status()).toBe(404);
	expect((await solutionStaffRequest(reporter, 'restoreSolution', { solution: hiddenId, note: 'メモ' })).status()).toBe(404);

	const mod = await user(browser, `st4-mod-${p}-${s}`, ip(p, 4, 5), { role: 'moderator' });
	// ?solution= の形が違う・ないときは 404（信頼の境界）
	for (const q of ['abc', '01', '0', '9999999999']) {
		expect((await mod.request.get(`/kanri?solution=${q}`)).status(), q).toBe(404);
	}
	await mod.goto('/kanri');
	const section = mod.locator('section').filter({ has: mod.getByRole('heading', { name: '通報を受けた解決策' }) });
	await expect(section).toBeVisible();
	const block = (body: string) => section.locator('article').filter({ hasText: body });
	await expect(block(hiddenBody)).toContainText('自動で非表示');
	await expect(block(hiddenBody)).toContainText('通報 3件（数えたもの 3件）');
	await expect(block(hiddenBody)).toContainText('人への攻撃・差別 3');
	await expect(block(hiddenBody).getByRole('link', { name: new RegExp(issueTitle) })).toHaveAttribute('href', `/kadai/${issueId}`);
	await expect(block(shownBody)).toContainText('表示中');
	await expect(block(shownBody)).toContainText('その他 1');
	await expect(block(shownBody)).toContainText(`説明 ${s}`);
	const bodies = await section.locator('article').allInnerTexts();
	expect(bodies.findIndex((t) => t.includes(hiddenBody))).toBeLessThan(bodies.findIndex((t) => t.includes(shownBody)));
	const html = await mod.content();
	expect(html).not.toContain(reporterName);
	expect(html).not.toContain(`st4-writer-${p}-${s}`);
});

test('基準5：解決策を非表示にする・表示に戻すができ、状態に合わない操作と自分の解決策は断る。表示に戻した解決策は自動では消えない', async ({ browser, page }, info) => {
	const p = info.project.name;
	const s = stamp();
	const author = await user(browser, `st5-author-${p}-${s}`, ip(p, 5, 1));
	const writer = await user(browser, `st5-writer-${p}-${s}`, ip(p, 5, 2));
	const body = `運営が扱う解決策 ${s}`;
	const { issueId, solutionId } = await issueWithSolution(author, writer, `解決策の運営の操作 ${p}-${s}`, body);
	const mod = await user(browser, `st5-mod-${p}-${s}`, ip(p, 5, 3), { role: 'moderator' });

	// 解決策から「運営として対応する」で、通報されていない解決策も扱える
	await mod.goto(`/kadai/${issueId}`);
	await mod.locator('article').filter({ hasText: body }).getByRole('link', { name: 'この解決策に運営として対応する' }).click();
	await expect(mod).toHaveURL(`/kanri?solution=${solutionId}`);
	await hydrated(mod);
	const block = mod.locator('article').filter({ hasText: body });
	await block.getByLabel('非表示にする理由').selectOption({ label: '宣伝・荒らし' });
	await block.getByLabel('非表示にするメモ').fill('宣伝だけの解決策');
	await block.getByRole('button', { name: '非表示にする' }).click();
	await expect(block.getByText('非表示', { exact: true })).toBeVisible();
	await page.goto(`/kadai/${issueId}`);
	await expect(page.getByText(body)).toHaveCount(0);

	const twice = await solutionStaffRequest(mod, 'hideSolution', { solution: solutionId, reason: 'spam', note: 'もう一度' });
	expect(twice.status()).toBe(400);
	expect(await twice.text()).toContain('すでに非表示です');

	await block.getByLabel('表示に戻すメモ').fill('確認したところ問題なし');
	await block.getByRole('button', { name: '表示に戻す' }).click();
	await expect(block.getByText('表示に戻した', { exact: true })).toBeVisible();
	const back = await solutionStaffRequest(mod, 'restoreSolution', { solution: solutionId, note: 'もう一度' });
	expect(back.status()).toBe(400);
	expect(await back.text()).toContain('表示されています');

	// 表示に戻した解決策は、3人の通報でも自動では消えない
	await reportBy(browser, issueId, solutionId, `st5-r-${p}-${s}-`, ip(p, 5, 4), 3);
	await page.goto(`/kadai/${issueId}`);
	await expect(page.getByText(body)).toBeVisible();

	// 自分の解決策には操作できない（画面にもボタンを出さない）
	const ownBody = `運営自身の解決策 ${s}`;
	expect((await solutionRequest(mod, issueId, ownBody)).status()).toBe(303);
	const ownId = await solutionIdOf(mod, issueId, ownBody);
	await mod.goto(`/kanri?solution=${ownId}`);
	await expect(mod.locator('article').filter({ hasText: ownBody }).getByRole('button', { name: '非表示にする' })).toHaveCount(0);
	const self = await solutionStaffRequest(mod, 'hideSolution', { solution: ownId, reason: 'spam', note: '自分で' });
	expect(self.status()).toBe(403);
	expect(await self.text()).toContain('自分の解決策には対応できません');
});

test('基準6：運営の記録に「#課題 の解決策」として残る。基準の文に解決策も含める', async ({ browser, page }, info) => {
	const p = info.project.name;
	const s = stamp();
	const author = await user(browser, `st6-author-${p}-${s}`, ip(p, 6, 1));
	const writer = await user(browser, `st6-writer-${p}-${s}`, ip(p, 6, 2));
	const { issueId, solutionId } = await issueWithSolution(author, writer, `解決策の記録 ${p}-${s}`, `記録に残る解決策 ${s}`);
	await reportBy(browser, issueId, solutionId, `st6-r-${p}-${s}-`, ip(p, 6, 3), 3);
	const op = await user(browser, `st6-op-${p}-${s}`, ip(p, 6, 4), { role: 'operator' });
	const note = `解決策は問題なし ${s}`;
	expect((await solutionStaffRequest(op, 'restoreSolution', { solution: solutionId, note })).status()).toBeLessThan(400);

	await page.goto('/unei');
	await expect(page.getByText('課題や解決策は、運営か委員長が確認するまで一時的に見えなくなります')).toBeVisible();
	const rows = page.locator('tr').filter({ hasText: `#${issueId} の解決策` });
	await expect(rows).toHaveCount(2);
	const cell = (row: number, col: number) => rows.nth(row).locator(`td:nth-child(${col})`);
	await expect(cell(0, 2).getByRole('link', { name: `#${issueId}` })).toHaveAttribute('href', `/kadai/${issueId}`);
	await expect(cell(0, 3)).toHaveText('表示に戻した');
	await expect(cell(0, 4)).toHaveText('運営');
	await expect(cell(0, 6)).toHaveText(note);
	await expect(cell(1, 3)).toHaveText('自動で非表示');
	await expect(cell(1, 5)).toHaveText('通報が3件');
	const html = await page.content();
	expect(html).not.toContain(`st6-writer-${p}-${s}`);
	expect(html).not.toContain(`st6-r-${p}-${s}`);
});

test('基準7：通報の上限は課題の通報と合わせて24時間に10件。超えると違反に数えて締め出す。日本からだけ', async ({ browser }, info) => {
	test.setTimeout(90_000);
	const p = info.project.name;
	const s = stamp();
	const authors = [await user(browser, `st7-a0-${p}-${s}`, ip(p, 7, 1)), await user(browser, `st7-a1-${p}-${s}`, ip(p, 7, 2))];
	const issueIds: number[] = [];
	for (const a of authors) for (let i = 0; i < 4; i++) issueIds.push(await postIssue(a, { title: `通報の上限 ${p}-${s} ${issueIds.length}` }));
	const writer = await user(browser, `st7-writer-${p}-${s}`, ip(p, 7, 3));
	const solutions: { issueId: number; solutionId: string }[] = [];
	for (let i = 0; i < 6; i++) {
		const body = `上限の解決策 ${i} ${s}`;
		expect((await solutionRequest(writer, issueIds[0], body)).status()).toBe(303);
		solutions.push({ issueId: issueIds[0], solutionId: await solutionIdOf(writer, issueIds[0], body) });
	}

	const us = await user(browser, `st7-us-${p}-${s}`, ip(p, 7, 4), { country: 'US' });
	const outside = await reportSolutionRequest(us, solutions[0].issueId, { solution: solutions[0].solutionId });
	expect(outside.status()).toBe(403);
	expect(await outside.text()).toContain('日本国内からのみ参加できます');

	// 課題を7件、解決策を3件で10件。11件目（解決策）で断る
	const r = await user(browser, `st7-r-${p}-${s}`, ip(p, 7, 5));
	for (let i = 0; i < 7; i++) expect((await reportRequest(r, issueIds[i + 1], { reason: 'spam' })).status(), `課題${i}`).toBe(200);
	for (let i = 0; i < 3; i++) {
		expect((await reportSolutionRequest(r, solutions[i].issueId, { solution: solutions[i].solutionId })).status(), `解決策${i}`).toBe(200);
	}
	const over = await reportSolutionRequest(r, solutions[3].issueId, { solution: solutions[3].solutionId });
	expect(over.status()).toBe(429);
	expect(await over.text()).toContain('通報は24時間に10件までできます');
	await reportSolutionRequest(r, solutions[4].issueId, { solution: solutions[4].solutionId });
	await reportSolutionRequest(r, solutions[5].issueId, { solution: solutions[5].solutionId });
	const banned = await reportSolutionRequest(r, solutions[3].issueId, { solution: solutions[3].solutionId });
	expect(banned.status()).toBe(429);
	expect(await banned.text()).toContain('課題や解決策の投稿、「わかる」「考えが変わった」、通報ができません');
});

test('信頼の境界：解決策の通報の solution の形が違えば 400', async ({ browser }, info) => {
	const p = info.project.name;
	const s = stamp();
	const author = await user(browser, `stb-author-${p}-${s}`, ip(p, 8, 1));
	const writer = await user(browser, `stb-writer-${p}-${s}`, ip(p, 8, 2));
	const { issueId } = await issueWithSolution(author, writer, `通報の境界 ${p}-${s}`, `境界の解決策 ${s}`);
	const r = await user(browser, `stb-r-${p}-${s}`, ip(p, 8, 3));
	for (const solution of ['abc', '0', '01', '', '-1', '1.5']) {
		expect((await reportSolutionRequest(r, issueId, { solution, reason: 'spam' })).status(), solution).toBe(400);
	}
	expect((await reportSolutionRequest(r, issueId, { reason: 'spam' })).status()).toBe(400);
});
