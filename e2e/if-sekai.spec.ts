// Issue #72 IF世界の版と法令ページ。反映と衝突の中身は src/lib/db/if-world.test.ts。
// IF世界はテストのあいだで共有するので、可決するテストは IF_LAW（ほかのテストが可決しない法令）の別々の条を使う
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { billRequest, billSupportRequest, createAmendBill, ifTarget, IF_LAW, issueWithSolutions, newUser, postIssue, proposeRequest, type IfTarget } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});
test.use({ actionTimeout: 15_000 });
// 投票する人を10人以上作るので重い
test.beforeEach(() => test.setTimeout(300_000));

type Width = 'sp' | 'pc';
const stamp = () => Date.now() % 1e8;
const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
/** 基準ごと・幅ごとに別の年を使う（2191年までは結果のページのテストと撮影が使っている） */
const monthOf = (w: string, group: number) => `${2230 + group * 3 + (w === 'sp' ? 0 : 1)}-05`;
const shift = (month: string, n: number) => month.replace(/-05$/, `-${String(5 + n).padStart(2, '0')}`);
const at = (month: string, day: number) => `${month}-${String(day).padStart(2, '0')}T09:00:00+09:00`;
/** テストと幅ごとの、IF_LAW の条の位置（可決して変わる条を分ける。kekka.spec.ts は 0〜9） */
const slot = (w: string, group: number, n = 0) => 10 + group * 4 + (w === 'sp' ? 0 : 2) + n;

type User = { page: Page; setNow: (now: string) => Promise<void> };

async function user(browser: Browser, address: string, now: string, name?: string): Promise<User> {
	const u = await newUser(browser, { name, ip: address, days: 8 });
	contexts.push(u.context);
	const setNow = (t: string) => u.context.setExtraHTTPHeaders({ 'x-test-ip': address, 'x-test-now': t });
	await setNow(now);
	return { page: u.page, setNow };
}

function setup(browser: Browser, w: string, group: number) {
	const month = monthOf(w, group);
	const label = `f${group}-${w}-${stamp()}`;
	let seq = 0;
	const nextIp = () => {
		seq += 1;
		return `10.${w === 'sp' ? 90 : 91}.${group}.${seq}`;
	};
	const person = (now: string) => {
		const address = nextIp();
		return user(browser, address, now, `u${seq}-${label}`);
	};
	const anonymous = (now: string) => user(browser, nextIp(), now);
	let backers: User[] | undefined;
	/** IF_LAW の条を書きかえる法案を発議する。dayMonth は発議する月 */
	async function bill(title: string, target: IfTarget, body: string, proposeAt = at(month, 5)) {
		const a = await person(proposeAt);
		const { ids } = await issueWithSolutions(a.page, title, [`解決策 ${title}`]);
		const path = await createAmendBill(a.page, title, ids[0], { 'body.0': body }, target);
		backers ??= [await person(proposeAt), await person(proposeAt), await person(proposeAt)];
		for (const b of backers) {
			await b.setNow(proposeAt);
			const res = await billSupportRequest(b.page, path, { op: 'add', rev: '1' });
			expect(res.status(), await res.text()).toBe(200);
		}
		const res = await proposeRequest(a.page, path);
		expect(res.status(), await res.text()).toBe(200);
		return { a, path, id: path.replace('/houan/', ''), title };
	}
	/** 投票資格のある n 人が賛成する（どの法案も割り当てられるので、全部に入れる） */
	async function passAll(ids: string[], voteMonth = month, n = 10) {
		for (let i = 0; i < n; i++) {
			const u = await person(at(shift(voteMonth, -1), 10));
			await postIssue(u.page, { title: `前の月の課題 ${label} ${seq}` });
			await u.setNow(at(voteMonth, 22));
			for (const id of ids) {
				const res = await billRequest(u.page, `/saiketsu/${id}?/vote`, { choice: 'yes', 'cf-turnstile-response': 'test-pass' });
				expect(res.status(), await res.text()).toBe(200);
			}
		}
	}
	return { month, label, person, anonymous, bill, passAll };
}

const LAW_PATH = `/if/hourei/${IF_LAW}`;
const main = (u: Page) => u.getByRole('main');
const band = (u: Page) => u.locator('[data-if-band]');
const robots = (u: Page) => u.locator('meta[name="robots"]');
const open = async (u: Page, path: string) => {
	await u.goto(path);
	await hydrated(u);
};
const status = (u: Page, w: Width, name: string) => (w === 'sp' ? u.getByText(`いま：${name}`, { exact: true }) : u.getByText(`${name}（いまここ）`, { exact: true }));
const articleOf = (u: Page, label: string) => u.getByRole('article', { name: label, exact: true });

test('基準4：IF世界の法令ページに帯・架空の法令・noindex・変わった条と元の法案が出て、現実の法令ページは元のまま。切り替えがある。制定の新法も読める', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 1);
	const seed = await s.anonymous(at(s.month, 5));
	const target = await ifTarget(seed.page, slot(w, 1));
	const body = `IF世界で書きかえた本文 ${s.label}`;
	const { id, title, path } = await s.bill(`IF世界の法案 ${s.label}`, target, body);

	// 新法の法案
	const author = await s.person(at(s.month, 5));
	const enactTitle = `新法 ${s.label} 保護法`;
	const { ids } = await issueWithSolutions(author.page, enactTitle, [`解決策 ${enactTitle}`]);
	const enacted = await billRequest(author.page, '/houan/kaku', {
		kind: 'enact',
		title: enactTitle,
		newTitle: enactTitle,
		'op.0': 'add',
		'num.0': '1',
		'caption.0': '（目的）',
		'body.0': `この法律は、${s.label}を守ることを目的とする。`,
		affected: '困っている人',
		sideEffects: '副作用',
		solution: ids[0],
		'cf-turnstile-response': 'test-pass'
	});
	expect(enacted.status(), await enacted.text()).toBe(303);
	const enactPath = enacted.headers()['location'];
	for (let i = 0; i < 3; i++) {
		const b = await s.person(at(s.month, 5));
		expect((await billSupportRequest(b.page, enactPath, { op: 'add', rev: '1' })).status()).toBe(200);
	}
	expect((await proposeRequest(author.page, enactPath)).status()).toBe(200);
	const enactId = enactPath.replace('/houan/', '');

	await s.passAll([id, enactId]);
	const v = await s.anonymous(`${shift(s.month, 1)}-01T09:00:00+09:00`);
	// 読むと確定する
	await open(v.page, `/saiketsu/${id}/kekka`);
	await v.page.getByRole('link', { name: 'IF世界の条文を見る' }).click();
	await expect(v.page).toHaveURL(new RegExp(`${LAW_PATH}$`));
	await hydrated(v.page);
	await expect(band(v.page)).toHaveCSS('background-image', /gradient/);
	await expect(v.page.getByText('架空の法令').first()).toBeVisible();
	await expect(robots(v.page)).toHaveAttribute('content', /noindex/);
	const changed = articleOf(v.page, target.label);
	await expect(changed).toContainText(body);
	await expect(changed).toContainText('IF世界で変わりました');
	await expect(changed.getByRole('link', { name: title })).toHaveAttribute('href', path);
	// 改正履歴、変わった記録、2時点の比較は出さない
	await expect(v.page.getByRole('button', { name: '変わった記録を見る' })).toHaveCount(0);
	await expect(main(v.page).getByRole('link', { name: /2つの時点|比べる/ })).toHaveCount(0);
	// 切り替え
	await v.page.getByRole('link', { name: '現実の法律' }).click();
	await expect(v.page).toHaveURL(new RegExp(`/hourei/${IF_LAW}$`));
	const real = articleOf(v.page, target.label);
	await expect(real).not.toContainText(body);
	await expect(band(v.page)).toHaveCount(0);
	await expect(v.page.getByText('架空の法令')).toHaveCount(0);
	await v.page.getByRole('link', { name: 'IF世界の法律' }).click();
	await expect(v.page).toHaveURL(new RegExp(`${LAW_PATH}$`));

	// 制定の新法
	await open(v.page, `/saiketsu/${enactId}/kekka`);
	await v.page.getByRole('link', { name: 'IF世界の条文を見る' }).click();
	await expect(v.page).toHaveURL(new RegExp(`/if/hourei/if-${enactId}$`));
	await expect(v.page.getByRole('heading', { level: 1, name: enactTitle })).toBeVisible();
	await expect(band(v.page)).toBeVisible();
	await expect(v.page.getByText('架空の法令').first()).toBeVisible();
	await expect(articleOf(v.page, '第1条')).toContainText(`${s.label}を守る`);
	await expect(v.page.getByRole('link', { name: '現実の法律' })).toHaveCount(0);
});

test('基準5：書く画面の条文が IF世界の最新から始まり、架空の法令と出る。開いたあと IF世界が変わると保存を断る。変更点のタブの「いま」は基にした版の条', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 2);
	const a = await s.person(at(s.month, 5));
	const target = await ifTarget(a.page, slot(w, 2));
	const body = `次の法案の基になる本文 ${s.label}`;

	// 書きかける画面（可決の前の IF世界の印を持つ）
	const { ids } = await issueWithSolutions(a.page, `書く ${s.label}`, [`解決策 書く ${s.label}`]);
	const staleForm = await (await a.page.request.get(`/houan/kaku/joubun?law=${IF_LAW}`)).json() as { revisionId: string };

	const passed = await s.bill(`基になる法案 ${s.label}`, target, body);
	await s.passAll([passed.id]);
	const next = shift(s.month, 1);
	const reader = await s.anonymous(at(next, 3));
	await open(reader.page, `/saiketsu/${passed.id}/kekka`);
	await expect(reader.page.getByText('可決', { exact: true })).toBeVisible();

	await a.setNow(at(next, 3));
	await open(a.page, `/houan/kaku?kaiketsu=${ids[0]}`);
	await a.page.getByRole('radio', { name: '改正' }).check();
	await a.page.getByLabel('対象の法令').selectOption(IF_LAW);
	await expect(a.page.getByText('ここに出る条文は IF世界の最新です（架空の法令）')).toBeVisible();
	await a.page.getByLabel('変える条').selectOption(target.num);
	await expect(a.page.getByLabel('変更後の条文')).toHaveValue(body);

	// 開いたあと IF世界が変わった：古い印では保存しない
	const form = { kind: 'amend', title: `古い印の法案 ${s.label}`, law: IF_LAW, base: staleForm.revisionId, 'op.0': 'amend', 'target.0': target.num, 'caption.0': target.caption, 'body.0': `古い印の本文 ${s.label}`, affected: '人', sideEffects: '副作用', solution: ids[0], 'cf-turnstile-response': 'test-pass' };
	const refused = await billRequest(a.page, '/houan/kaku', form);
	expect(refused.status()).toBe(409);
	expect(await refused.text()).toContain('条文が新しくなりました');

	// 最新を基にした法案の変更点の「いま」は IF世界の本文
	const { revisionId } = (await (await a.page.request.get(`/houan/kaku/joubun?law=${IF_LAW}`)).json()) as { revisionId: string };
	const saved = await billRequest(a.page, '/houan/kaku', { ...form, title: `新しい印の法案 ${s.label}`, base: revisionId });
	expect(saved.status(), await saved.text()).toBe(303);
	await open(a.page, `${saved.headers()['location']}/henkou`);
	await expect(main(a.page).locator('section').filter({ hasText: 'いま' })).toContainText(/次の法案の基になる/);
});

test('基準6・7：同じ条の後の法案は要調整と出て、提出者が期限までに直すと次の会期の質疑に戻る。前の会期の質疑は読むだけ。ほかの人は直せない', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const s = setup(browser, w, 3);
	const seed = await s.anonymous(at(s.month, 4));
	const target = await ifTarget(seed.page, slot(w, 3));
	const first = await s.bill(`先の法案 ${s.label}`, target, `先の本文 ${s.label}`);
	const second = await s.bill(`後の法案 ${s.label}`, target, `後の本文 ${s.label}`);

	// 前の会期の質疑
	const asker = await s.person(at(s.month, 15));
	const question = `前の会期の質疑 ${s.label}`;
	const asked = await billRequest(asker.page, `${second.path}/shitsugi/kaku`, { body: question, 'cf-turnstile-response': 'test-pass' });
	expect(asked.status(), await asked.text()).toBe(303);

	await s.passAll([first.id, second.id]);
	const next = shift(s.month, 1);
	const v = await s.anonymous(at(next, 3));

	// 結果のページ：先の法案は IF世界の法律に、後の法案は要調整
	await open(v.page, `/saiketsu/${first.id}/kekka`);
	await expect(v.page.getByText('IF世界の法律になりました')).toBeVisible();
	await open(v.page, `/saiketsu/${second.id}/kekka`);
	await expect(v.page.getByText('可決', { exact: true })).toBeVisible();
	await expect(v.page.getByText('IF世界の法律になりました')).toHaveCount(0);
	await expect(v.page.getByText(/可決しましたが、先に変わった条と重なるので、調整が要ります/)).toBeVisible();
	await expect(main(v.page)).toContainText(/6月15日/);
	await expect(v.page.getByRole('link', { name: 'IF世界の条文を見る' })).toHaveCount(0);

	await open(v.page, second.path);
	await expect(status(v.page, w, '要調整')).toBeVisible();
	await expect(v.page.getByRole('link', { name: '直す' })).toHaveCount(0);

	// ほかの人は直せない
	const stranger = await s.person(at(next, 3));
	expect((await stranger.page.request.get(`${second.path}/kaku`)).status()).toBe(403);

	// 提出者が直す。いまの条文が出て、確かめなしでは保存できない（基準8）
	const a = second.a;
	await a.setNow(at(next, 3));
	await open(a.page, second.path);
	await a.page.getByRole('link', { name: '直す' }).click();
	await expect(a.page).toHaveURL(new RegExp(`${second.path}/kaku$`));
	await hydrated(a.page);
	await expect(a.page.getByText(`先の本文 ${s.label}`).first()).toBeVisible();
	await expect(a.page.getByLabel('題名')).toHaveAttribute('readonly', '');
	const fixedBody = `直した本文 ${s.label}`;
	await a.page.getByLabel('変更後の条文').fill(fixedBody);
	const save = a.page.getByRole('button', { name: '直して質疑に戻す' });
	await save.click();
	await expect(a.page.getByRole('alert')).toContainText('いまの条文を確かめて');
	await a.page.getByLabel('いまの条文を確かめました').check();
	await save.click();
	await expect(a.page).toHaveURL(new RegExp(`${second.path}$`));
	await expect(status(a.page, w, '発議')).toBeVisible();
	await expect(main(a.page)).toContainText('賛同 3人');

	// 次の会期の質疑に戻り、前の会期の質疑は読むだけ
	await a.setNow(at(next, 16));
	await open(a.page, `${second.path}/shitsugi`);
	const card = a.page.locator('article').filter({ hasText: question });
	await expect(card).toBeVisible();
	await expect(card.getByRole('button', { name: '答弁する' })).toHaveCount(0);
	await expect(card.getByText('答弁待ち')).toHaveCount(0);
	await open(a.page, `${second.path}/henkou`);
	await expect(main(a.page)).toContainText(/直した本文/);
});

test('基準6：直さないまま期限を過ぎると廃案と出て、直せない', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const s = setup(browser, w, 4);
	const seed = await s.anonymous(at(s.month, 4));
	const target = await ifTarget(seed.page, slot(w, 4));
	const first = await s.bill(`先の法案 ${s.label}`, target, `先の本文 ${s.label}`);
	const second = await s.bill(`後の法案 ${s.label}`, target, `後の本文 ${s.label}`);
	await s.passAll([first.id, second.id]);

	const next = shift(s.month, 1);
	const v = await s.anonymous(at(next, 3));
	await open(v.page, second.path);
	await expect(status(v.page, w, '要調整')).toBeVisible();

	await v.setNow(at(next, 15));
	await open(v.page, second.path);
	await expect(status(v.page, w, '廃案')).toBeVisible();
	await open(v.page, `/saiketsu/${second.id}/kekka`);
	await expect(v.page.getByText('調整の期限までに直されなかったので、廃案になりました')).toBeVisible();
	await second.a.setNow(at(next, 15));
	expect((await second.a.page.request.get(`${second.path}/kaku`)).status()).toBe(403);
});

test('基準8：基にしたあとで変わった条に触れる下書きを開くと、いまの条文が出て、確かめなしでは保存できない。そのままでは発議できない', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 5);
	const a = await s.person(at(s.month, 4));
	const target = await ifTarget(a.page, slot(w, 5));
	// 先に下書きを書き、賛同を集めておく
	const title = `古い下書き ${s.label}`;
	const { ids } = await issueWithSolutions(a.page, title, [`解決策 ${title}`]);
	const draft = await createAmendBill(a.page, title, ids[0], { 'body.0': `古い下書きの本文 ${s.label}` }, target);
	for (let i = 0; i < 3; i++) {
		const b = await s.person(at(s.month, 4));
		expect((await billSupportRequest(b.page, draft, { op: 'add', rev: '1' })).status()).toBe(200);
	}

	const passed = await s.bill(`先に可決する法案 ${s.label}`, target, `先に可決した本文 ${s.label}`);
	await s.passAll([passed.id]);
	const next = shift(s.month, 1);
	const reader = await s.anonymous(at(next, 2));
	await open(reader.page, `/saiketsu/${passed.id}/kekka`);
	await expect(reader.page.getByText('IF世界の法律になりました')).toBeVisible();

	// そのままでは発議できない
	await a.setNow(at(next, 2));
	const proposed = await proposeRequest(a.page, draft);
	expect(proposed.status()).toBe(409);
	expect(await proposed.text()).toContain('基にしたあとで条文が変わりました');

	await open(a.page, `${draft}/kaku`);
	await expect(a.page.getByRole('heading', { name: 'ぶつかった条文' })).toBeVisible();
	await expect(a.page.getByText(`先に可決した本文 ${s.label}`).first()).toBeVisible();
	await a.page.getByLabel('変更後の条文').fill(`確かめた本文 ${s.label}`);
	const save = a.page.getByRole('button', { name: '下書きを保存する' });
	await save.click();
	await expect(a.page.getByRole('alert')).toContainText('いまの条文を確かめて');
	await a.page.getByLabel('いまの条文を確かめました').check();
	await save.click();
	await expect(a.page).toHaveURL(new RegExp(`${draft}$`));
	await open(a.page, `${draft}/kaku`);
	await expect(a.page.getByRole('heading', { name: 'ぶつかった条文' })).toHaveCount(0);
});

test('基準9：変更点のタブ、修正案のタブ、投票の画面に noindex。条文の JSON に X-Robots-Tag', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 6);
	const a = await s.person(at(s.month, 5));
	const { ids } = await issueWithSolutions(a.page, `検索よけ ${s.label}`, [`解決策 検索よけ ${s.label}`]);
	const draft = await createAmendBill(a.page, `検索よけの法案 ${s.label}`, ids[0]);
	for (let i = 0; i < 3; i++) {
		const b = await s.person(at(s.month, 5));
		expect((await billSupportRequest(b.page, draft, { op: 'add', rev: '1' })).status()).toBe(200);
	}
	expect((await proposeRequest(a.page, draft)).status()).toBe(200);
	const v = await s.person(at(s.month, 22));
	for (const path of [`${draft}/henkou`, `${draft}/shusei`, draft.replace('/houan/', '/saiketsu/')]) {
		await v.page.goto(path);
		await expect(robots(v.page), path).toHaveAttribute('content', /noindex/);
	}
	const res = await v.page.request.get(`/houan/kaku/joubun?law=${IF_LAW}`);
	expect(res.headers()['x-robots-tag']).toContain('noindex');
});

test('信頼の境界：/if/hourei/ の番号が形の違うとき、存在しないときは 404', async ({ browser }, info) => {
	const s = setup(browser, info.project.name, 7);
	const v = await s.anonymous(at(s.month, 5));
	for (const id of ['abc', '000AC0000000000', 'if-', 'if-abc', 'if-0', 'if-999999999', '../hourei', '%00']) {
		expect((await v.page.request.get(`/if/hourei/${id}`)).status(), id).toBe(404);
	}
});

test('信頼の境界：フォームの基にした版の印が形の違うとき、別の法令のときは断る', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 8);
	const a = await s.person(at(s.month, 5));
	const { ids } = await issueWithSolutions(a.page, `印 ${s.label}`, [`解決策 印 ${s.label}`]);
	const target = await ifTarget(a.page, slot(w, 8));
	const other = ((await (await a.page.request.get('/houan/kaku/joubun?law=412AC0000000061')).json()) as { revisionId: string }).revisionId;
	const form = (base: string) => ({ kind: 'amend', title: `印の法案 ${s.label}`, law: IF_LAW, base, 'op.0': 'amend', 'target.0': target.num, 'caption.0': target.caption, 'body.0': `印の本文 ${s.label}`, affected: '人', sideEffects: '副作用', solution: ids[0], 'cf-turnstile-response': 'test-pass' });
	const { revisionId } = (await (await a.page.request.get(`/houan/kaku/joubun?law=${IF_LAW}`)).json()) as { revisionId: string };
	const [rev] = revisionId.split('@');
	for (const bad of ['', rev, `${rev}@`, `${rev}@abc`, `${rev}@-1`, `${rev}@01`, `@0`, `nope@0`, other]) {
		const res = await billRequest(a.page, '/houan/kaku', form(bad));
		expect(res.status(), bad).toBe(400);
	}
});
