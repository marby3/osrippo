// Issue #30 似た課題を出す機能と、課題の統合（設計書 docs/spec/30.md）
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { newUser, postIssue, reportRequest, similarRequest, staffRequest, supportRequest } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});

const ip = (project: string, test: number, n: number) => `10.${project === 'sp' ? 5 : 6}.${test}.${n}`;
const stamp = () => Date.now() % 1e8;
/** テストごと・幅ごとに違う英字の印（タイトルに入れて、ほかのテストの課題より似ているようにする） */
const code = (n: number) =>
	[...n.toString(26)].map((c) => String.fromCharCode('a'.charCodeAt(0) + parseInt(c, 26))).join('');
const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });

async function user(
	browser: Browser,
	name: string,
	ipAddress: string,
	opts: { days?: number; role?: 'moderator' | 'operator' } = {}
): Promise<Page> {
	const u = await newUser(browser, { name, ip: ipAddress, ...opts });
	contexts.push(u.context);
	return u.page;
}

test('基準1・2：タイトルを打つと似た課題を出し、いちばん上に「わかる」を付けるとその課題へ移る。非表示・統合した課題は出さない', async ({ browser }, info) => {
	const p = info.project.name;
	const s = stamp();
	const c = code(s * 2 + (p === 'sp' ? 0 : 1));
	const author = await user(browser, `n1-author-${p}-${s}`, ip(p, 1, 1));
	const near = `${c}自転車で歩道を走っていい場所がわかりにくい`;
	const nearId = await postIssue(author, { title: near });
	// 打つタイトルと同じ題名の課題を2つ作り、1つは非表示、1つは統合済みにする（どちらも出ない）
	const query = `${c}駅前で自転車の走る場所がわからない`;
	const hiddenId = await postIssue(author, { title: query });
	const mergedId = await postIssue(author, { title: query + '。' });
	const op = await user(browser, `n1-op-${p}-${s}`, ip(p, 1, 2), { role: 'operator' });
	expect((await staffRequest(op, 'hide', { issue: String(hiddenId), reason: 'spam', note: 'テスト' })).status()).toBeLessThan(400);
	expect((await staffRequest(op, 'merge', { issue: String(mergedId), target: String(nearId), note: 'テスト' })).status()).toBeLessThan(400);

	const writer = await user(browser, `n1-writer-${p}-${s}`, ip(p, 1, 3));
	await writer.goto('/kadai/kaku');
	await hydrated(writer);
	// 似た課題がないとき
	await writer.getByLabel('何に困っていますか？').fill(`${code(s + 7)}ゑゐ`);
	await expect(writer.getByRole('button', { name: '次へ', exact: true })).toBeVisible();
	await expect(writer.getByText('似た課題があります')).toHaveCount(0);

	await writer.getByLabel('何に困っていますか？').fill(query);
	await expect(writer.getByText('似た課題があります')).toBeVisible();
	await expect(writer.getByRole('button', { name: 'どれとも違うので、次へ' })).toBeVisible();
	const cards = writer.getByRole('listitem').filter({ has: writer.getByRole('link') });
	await expect(cards.first().getByRole('link')).toHaveText(near);
	await expect(cards.first()).toContainText('わかる 0');
	expect(await cards.count()).toBeLessThanOrEqual(3);
	await expect(writer.getByRole('link', { name: query, exact: true })).toHaveCount(0);
	await expect(writer.getByRole('link', { name: query + '。' })).toHaveCount(0);
	// いちばん上のカードにだけ「これに『わかる』を付ける」
	await expect(writer.getByRole('button', { name: 'これに「わかる」を付ける' })).toHaveCount(1);
	await writer.getByRole('button', { name: 'これに「わかる」を付ける' }).click();

	await expect(writer).toHaveURL(`/kadai/${nearId}`);
	const wakaru = writer.getByRole('button', { name: /^わかる/ });
	await expect(wakaru).toHaveAttribute('aria-pressed', 'true');
	// 統合した課題の「わかる」はまだ誰も付けていないので、付けたのはこの1人
	await expect(wakaru).toHaveText(/わかる\s*1$/);
});

test('基準4：確認の欄を通して統合すると、転送・合算・まとめた課題・一覧・運営の記録に反映される', async ({ browser, page }, info) => {
	const p = info.project.name;
	const s = stamp();
	const author = await user(browser, `n4-author-${p}-${s}`, ip(p, 4, 1));
	const source = `統合する元 ${p}-${s}`;
	const target = `統合先 ${p}-${s}`;
	const sourceId = await postIssue(author, { title: source });
	const targetId = await postIssue(author, { title: target });
	// 両方に付けた人1人、元だけ1人、統合先だけ1人 → 合算は3
	const both = await user(browser, `n4-both-${p}-${s}`, ip(p, 4, 2));
	const onlySource = await user(browser, `n4-src-${p}-${s}`, ip(p, 4, 3));
	const onlyTarget = await user(browser, `n4-tgt-${p}-${s}`, ip(p, 4, 4));
	for (const [u, ids] of [
		[both, [sourceId, targetId]],
		[onlySource, [sourceId]],
		[onlyTarget, [targetId]]
	] as const) {
		for (const id of ids) expect((await supportRequest(u, id, 'add')).status()).toBeLessThan(400);
	}

	const mod = await user(browser, `n4-mod-${p}-${s}`, ip(p, 4, 5), { role: 'moderator' });
	await mod.goto(`/kanri?issue=${sourceId}`);
	await hydrated(mod);
	await mod.getByLabel('統合先の課題の番号').fill(String(targetId));
	await mod.getByRole('button', { name: '確かめる' }).click();
	await expect(mod).toHaveURL(`/kanri?issue=${sourceId}&merge=${targetId}`);
	await expect(mod.getByText(`#${sourceId}「${source}」を #${targetId}「${target}」に統合します`)).toBeVisible();
	await expect(mod.getByText('統合は取り消せません')).toBeVisible();
	await expect(mod.getByText('合算したあとの「わかる」 3')).toBeVisible();
	await mod.getByLabel('統合のメモ').fill('同じ困りごと');
	await mod.getByRole('button', { name: '統合する' }).click();
	await expect(mod.getByText(`統合した（#${targetId}）`)).toBeVisible();

	// 元の URL は統合先へ転送
	const res = await page.request.get(`/kadai/${sourceId}`, { maxRedirects: 0 });
	expect(res.status()).toBe(308);
	expect(res.headers()['location']).toBe(`/kadai/${targetId}`);
	await page.goto(`/kadai/${sourceId}`);
	await expect(page).toHaveURL(`/kadai/${targetId}`);
	await expect(page.getByRole('button', { name: /^わかる/ })).toHaveText(/わかる\s*3$/);
	await expect(page.getByRole('heading', { name: 'この課題にまとめた課題' })).toBeVisible();
	await expect(page.getByRole('listitem').filter({ hasText: source })).toBeVisible();

	// 一覧から元の課題が消える
	await page.goto('/kadai?sort=new');
	await expect(page.getByRole('link', { name: source, exact: true })).toHaveCount(0);
	await expect(page.getByRole('link', { name: target, exact: true })).toBeVisible();

	// 運営の記録
	await page.goto('/unei');
	const row = page.locator('tr').filter({ has: page.getByRole('link', { name: `#${sourceId}`, exact: true }) });
	await expect(row.locator('td:nth-child(3)')).toHaveText('統合');
	await expect(row.locator('td:nth-child(4)')).toHaveText('運営協力者');
	await expect(row.locator('td:nth-child(5)')).toHaveText(`#${targetId} にまとめた`);
	await expect(row.locator('td:nth-child(6)')).toHaveText('同じ困りごと');
});

test('基準5：統合できないときは理由を出して統合しない。統合した課題には何もできない', async ({ browser }, info) => {
	const p = info.project.name;
	const s = stamp();
	const author = await user(browser, `n5-author-${p}-${s}`, ip(p, 5, 1));
	const ids: number[] = [];
	for (const name of ['A', 'B', '非表示', '統合済み', '統合先']) {
		ids.push(await postIssue(author, { title: `統合できない ${name} ${p}-${s}` }));
	}
	const [idA, idB, idHidden, idMerged, idInto] = ids;
	const op = await user(browser, `n5-op-${p}-${s}`, ip(p, 5, 2), { role: 'operator' });
	const merge = (issue: number | string, target: number | string) =>
		staffRequest(op, 'merge', { issue: String(issue), target: String(target), note: 'テスト' });
	expect((await staffRequest(op, 'hide', { issue: String(idHidden), reason: 'spam', note: 'テスト' })).status()).toBeLessThan(400);
	expect((await merge(idMerged, idInto)).status()).toBeLessThan(400);

	const refused = async (issue: number | string, target: number | string, status: number, text: string) => {
		const res = await merge(issue, target);
		expect(res.status(), `${issue}→${target}`).toBe(status);
		expect(await res.text(), `${issue}→${target}`).toContain(text);
	};
	await refused(idA, idA, 400, '同じ課題には統合できません');
	await refused(idHidden, idA, 400, '非表示か統合済みの課題は統合できません');
	await refused(idMerged, idA, 400, '統合された課題には操作できません');
	await refused(idA, idHidden, 400, '統合先が非表示か統合済みか、ありません');
	await refused(idA, idMerged, 400, '統合先が非表示か統合済みか、ありません');
	await refused(idA, 9999999999, 400, '統合先が非表示か統合済みか、ありません');
	// 確認の欄でも理由を出す
	await op.goto(`/kanri?issue=${idA}&merge=${idHidden}`);
	await expect(op.getByText('統合先が非表示か統合済みか、ありません')).toBeVisible();
	await expect(op.getByRole('button', { name: '統合する' })).toHaveCount(0);

	// 自分が書いた課題（元でも統合先でも）
	const opIssue = await postIssue(op, { title: `運営が書いた課題 ${p}-${s}` });
	await refused(opIssue, idA, 403, '自分の課題には対応できません');
	await refused(idA, opIssue, 403, '自分の課題には対応できません');

	// 統合した課題には、非表示にする・表示に戻す・わかる・通報のどれもできない
	await refused(idMerged, idB, 400, '統合された課題には操作できません');
	const hide = await staffRequest(op, 'hide', { issue: String(idMerged), reason: 'spam', note: 'テスト' });
	expect(hide.status()).toBe(400);
	expect(await hide.text()).toContain('統合された課題には操作できません');
	const restore = await staffRequest(op, 'restore', { issue: String(idMerged), note: 'テスト' });
	expect(restore.status()).toBe(400);
	expect(await restore.text()).toContain('統合された課題には操作できません');
	const other = await user(browser, `n5-other-${p}-${s}`, ip(p, 5, 3));
	const support = await supportRequest(other, idMerged, 'add');
	expect(support.status()).toBe(403);
	expect(await support.text()).toContain('統合された課題には操作できません');
	const report = await reportRequest(other, idMerged, { reason: 'spam' });
	expect(report.status()).toBe(403);
	// 統合しなかった課題はそのまま
	await other.goto(`/kadai/${idA}`);
	await expect(other.getByRole('heading', { level: 1, name: `統合できない A ${p}-${s}` })).toBeVisible();
});

test('信頼の境界：似た課題を探す q は、文字列で60字まで。ログインが要る', async ({ browser, page }, info) => {
	const p = info.project.name;
	expect((await similarRequest(page, { q: '自転車' })).status()).toBe(401);
	const u = await user(browser, `n-q-${p}-${stamp()}`, ip(p, 6, 1));
	expect((await similarRequest(u, { q: '' })).status()).toBe(200);
	expect(await (await similarRequest(u, { q: '' })).json()).toEqual({ issues: [] });
	expect((await similarRequest(u, { q: 'あ'.repeat(60) })).status()).toBe(200);
	for (const body of [{ q: 'あ'.repeat(61) }, { q: 12 }, { q: null }, {}, [], 'q']) {
		expect((await similarRequest(u, body)).status(), JSON.stringify(body)).toBe(400);
	}
	expect((await similarRequest(u, '{not json', true)).status()).toBe(400);
});

test('信頼の境界：/kanri の merge の形が違えば 404', async ({ browser }, info) => {
	const p = info.project.name;
	const s = stamp();
	const author = await user(browser, `n-m-author-${p}-${s}`, ip(p, 7, 1));
	const id = await postIssue(author, { title: `merge の形 ${p}-${s}` });
	const mod = await user(browser, `n-m-mod-${p}-${s}`, ip(p, 7, 2), { role: 'moderator' });
	for (const m of ['abc', '01', '0', '', '-3']) {
		expect((await mod.request.get(`/kanri?issue=${id}&merge=${m}`)).status(), m).toBe(404);
	}
	// issue なしの merge も 404
	expect((await mod.request.get(`/kanri?merge=${id}`)).status()).toBe(404);
});
