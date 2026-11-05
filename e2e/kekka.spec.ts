// Issue #71 会期の終わりの処理と結果のページ。処理の中身は src/lib/db/results.test.ts
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { billRequest, billSupportRequest, createAmendBill, ifTarget, issueWithSolutions, newUser, postIssue, proposeRequest } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});
test.use({ actionTimeout: 15_000 });
// 投票する人を10人以上作るので重い
test.beforeEach(() => test.setTimeout(240_000));

type Width = 'sp' | 'pc';
const stamp = () => Date.now() % 1e8;
const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
/** 基準ごと・幅ごとに別の年を使う（2151年までは採決の画面のテストと撮影が使っている） */
const monthOf = (w: string, group: number) => `${2160 + group * 2 + (w === 'sp' ? 0 : 1)}-05`;
const shift = (month: string, n: number) => month.replace(/-05$/, `-${String(5 + n).padStart(2, '0')}`);
const at = (month: string, day: number) => `${month}-${String(day).padStart(2, '0')}T09:00:00+09:00`;
/** 次の月の1日。締切から time のあと */
const firstOf = (month: string, time = '09:00:00') => `${shift(month, 1)}-01T${time}+09:00`;

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
	const label = `k${group}-${w}-${stamp()}`;
	let seq = 0;
	const nextIp = () => {
		seq += 1;
		return `10.${w === 'sp' ? 80 : 81}.${group}.${seq}`;
	};
	const person = (now: string) => {
		const address = nextIp();
		return user(browser, address, now, `u${seq}-${label}`);
	};
	const anonymous = (now: string) => user(browser, nextIp(), now);
	/** slot を渡すと可決するテスト用に IF_LAW のその位置の条を書きかえる（IF世界はテストのあいだで共有する） */
	async function bill(title: string, slot?: number) {
		const a = await person(at(month, 5));
		const { ids } = await issueWithSolutions(a.page, title, [`解決策 ${title}`]);
		const target = slot === undefined ? undefined : await ifTarget(a.page, slot);
		const path = await createAmendBill(a.page, title, ids[0], slot === undefined ? {} : { 'body.0': `本文 ${title}` }, target);
		for (let i = 0; i < 3; i++) {
			const b = await person(at(month, 5));
			const res = await billSupportRequest(b.page, path, { op: 'add', rev: '1' });
			expect(res.status(), await res.text()).toBe(200);
		}
		const res = await proposeRequest(a.page, path);
		expect(res.status(), await res.text()).toBe(200);
		return { path, id: path.replace('/houan/', ''), title };
	}
	const ballot = (choice: string) => ({ choice, 'cf-turnstile-response': 'test-pass' });
	/** n 人が投票する。eligible なら前の月に課題を書いた人（数えた票）、そうでなければ何もしていない人（参考の票） */
	async function cast(id: string, choice: string, n: number, eligible = true) {
		const people: User[] = [];
		for (let i = 0; i < n; i++) {
			const u = await person(at(eligible ? shift(month, -1) : month, eligible ? 10 : 22));
			if (eligible) {
				await postIssue(u.page, { title: `前の月の課題 ${label} ${seq}` });
				await u.setNow(at(month, 22));
			}
			const res = await billRequest(u.page, `/saiketsu/${id}?/vote`, ballot(choice));
			expect(res.status(), await res.text()).toBe(200);
			people.push(u);
		}
		return people;
	}
	return { month, label, person, anonymous, bill, cast, ballot };
}

const kekkaOf = (id: string) => `/saiketsu/${id}/kekka`;
const main = (u: Page) => u.getByRole('main');
const band = (u: Page) => u.locator('[data-if-band]');
const robots = (u: Page) => u.locator('meta[name="robots"]');
const status = (u: Page, w: Width, name: string) => (w === 'sp' ? u.getByText(`いま：${name}`, { exact: true }) : u.getByText(`${name}（いまここ）`, { exact: true }));
const open = async (u: Page, path: string) => {
	await u.goto(path);
	await hydrated(u);
};
/** 「終わった」のタブから法案の行を探す。新しい発議が先に並ぶので、ページをたどる */
async function ownedRow(u: Page, title: string) {
	for (let page = 1; page <= 30; page++) {
		await u.goto(page === 1 ? '/houan?tab=owari' : `/houan?tab=owari&page=${page}`);
		const row = u.getByRole('row').filter({ hasText: title });
		if (await row.count()) return row;
		expect(await u.getByRole('link', { name: '次のページ' }).count(), `一覧に ${title} がない`).toBeGreaterThan(0);
	}
	throw new Error('一覧が30ページを超えました');
}

test('基準4：Cron の入口で、読まれなくても結果が記録される。サーバーの入口のファイルは公開されない', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 1);
	const { id, title } = await s.bill(`Cron の法案 ${s.label}`, w === 'sp' ? 0 : 1);
	await s.cast(id, 'yes', 10);
	// 参考の票も定足数に届き、可否は数えた票と同じ
	await s.cast(id, 'yes', 10, false);

	const viewer = await s.anonymous(`${shift(s.month, 2)}-01T09:00:00+09:00`);
	const time = Date.parse(firstOf(s.month, '00:01:00'));
	const cron = await viewer.page.request.get(`/cdn-cgi/handler/scheduled?cron=1+15+*+*+*&time=${time}`);
	expect(cron.status(), await cron.text()).toBe(200);

	// 2か月後の一覧は1つ前の会期だけを処理するので、可決と出るのは Cron が記録したから
	const row = await ownedRow(viewer.page, title);
	await expect(row).toContainText('可決');

	await open(viewer.page, kekkaOf(id));
	if (w === 'sp') await viewer.page.getByRole('button', { name: /参考の票/ }).click();
	await expect(viewer.page.getByText('結果は数えた票と同じでした')).toBeVisible();

	for (const path of ['/_app_worker.js', '/_worker.js']) expect((await viewer.page.request.get(path)).status(), path).toBe(404);
});

test('基準5：次の会期で最初に読まれると確定する。古い会期も法案のページで確定する。締切の前はログインなしで読め、票の数は出ない', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const s = setup(browser, w, 2);
	const { id, title, path } = await s.bill(`読むと確定する法案 ${s.label}`);
	await s.cast(id, 'yes', 1);

	// 締切の前：題名と締切の日時だけ
	const v = await s.anonymous(at(s.month, 25));
	await open(v.page, kekkaOf(id));
	await expect(v.page.getByRole('heading', { level: 1, name: title })).toBeVisible();
	await expect(v.page.getByText('結果は締切のあとに出ます')).toBeVisible();
	await expect(v.page.getByText(/締切 6月1日.*0時/)).toBeVisible();
	await expect(band(v.page)).toBeVisible();
	await expect(robots(v.page)).toHaveAttribute('content', /noindex/);
	await expect(main(v.page)).not.toContainText(/数えた票|(賛成|反対|棄権)\s*\d/);
	const data = await (await v.page.request.get(`${kekkaOf(id)}/__data.json`)).text();
	expect(data).not.toMatch(/outcome|ref_?yes|abstain/i);

	// 次の会期の一覧の「終わった」のタブ：読むと確定する（1票なので廃案）
	await v.setNow(firstOf(s.month));
	await expect(await ownedRow(v.page, title)).toContainText('廃案');

	// 2つ以上前の会期：一覧では確定せず、法案のページで確定する
	const old = setup(browser, w, 3);
	const stale = await old.bill(`古い会期の法案 ${old.label}`);
	const viewer = await old.anonymous(`${shift(old.month, 3)}-01T09:00:00+09:00`);
	await expect(await ownedRow(viewer.page, stale.title)).toContainText('集計中');
	await open(viewer.page, stale.path);
	await expect(status(viewer.page, w, '廃案')).toBeVisible();
	await expect(await ownedRow(viewer.page, stale.title)).toContainText('廃案');
	await open(v.page, path);
	await expect(status(v.page, w, '廃案')).toBeVisible();
});

test('基準6：結果のページ（可決）に帯・noindex・文言・数えた票と内訳・参考の票・修正案の結果が出る', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const s = setup(browser, w, 4);
	const { id, title, path } = await s.bill(`可決の法案 ${s.label}`, w === 'sp' ? 2 : 3);

	// 2人の賛同で本案より先に採決する修正案（第2条）
	const proposer = await s.person(at(s.month, 15));
	const body = `可決する修正案の本文 ${s.label}`;
	const other = await ifTarget(proposer.page, w === 'sp' ? 4 : 5);
	const posted = await billRequest(proposer.page, `${path}/shusei/kaku`, { rev: '1', reason: '', article: `0:${other.num}`, body, 'cf-turnstile-response': 'test-pass' });
	expect(posted.status(), await posted.text()).toBe(303);
	await proposer.page.goto(`${path}/shusei`);
	const amendment = ((await proposer.page.locator('article').filter({ hasText: body }).getAttribute('id')) as string).replace('shusei-', '');
	for (let i = 0; i < 2; i++) {
		const b = await s.person(at(s.month, 15));
		expect((await billRequest(b.page, `${path}/shusei?/support`, { amendment, revision: '1', op: 'add' })).status()).toBe(200);
	}

	const yes = await s.cast(id, 'yes', 7);
	await s.cast(id, 'no', 2);
	await s.cast(id, 'abstain', 1);
	// 参考の票は1票だけで、定足数に届かないので比べない
	await s.cast(id, 'yes', 1, false);
	// 修正案にも数えた票で10票
	for (const u of yes) expect((await billRequest(u.page, `${path}/shusei?/vote`, { amendment, ...s.ballot('yes') })).status()).toBe(200);
	const rest = await s.cast(id, 'yes', 3);
	for (const u of rest) expect((await billRequest(u.page, `${path}/shusei?/vote`, { amendment, ...s.ballot('yes') })).status()).toBe(200);

	const v = await s.anonymous(firstOf(s.month));
	await open(v.page, kekkaOf(id));
	await expect(band(v.page)).toHaveCSS('background-image', /gradient/);
	await expect(v.page.getByText(w === 'sp' ? '架空の法律です' : 'このページの条文は架空のものです。現実の法律ではありません。')).toBeVisible();
	await expect(robots(v.page)).toHaveAttribute('content', /noindex/);
	await expect(v.page.getByRole('heading', { level: 1, name: title })).toBeVisible();
	await expect(v.page.getByText('可決', { exact: true })).toBeVisible();
	await expect(v.page.getByText('IF世界の法律になりました')).toBeVisible();
	await expect(v.page.getByText('ゲームの中の結果です。世論調査ではありません。')).toBeVisible();
	await expect(main(v.page)).toContainText(/数えた票\s*13(?!\d)/);
	await expect(main(v.page)).toContainText(/賛成\s*10(?!\d)/);
	await expect(main(v.page)).toContainText(/反対\s*2(?!\d)/);
	await expect(main(v.page)).toContainText(/棄権\s*1(?!\d)/);

	// 参考の票：スマホは開くと出る、PC は出ている
	const reference = v.page.getByText(/賛成 1 ・ 反対 0 ・ 棄権 0/);
	if (w === 'sp') {
		await expect(reference).toBeHidden();
		await v.page.getByRole('button', { name: /参考の票/ }).click();
	}
	await expect(v.page.getByText(/参考の票（可否には使いません）/)).toBeVisible();
	await expect(reference).toBeVisible();
	await expect(v.page.getByText('結果は数えた票と同じでした')).toHaveCount(0);
	await expect(v.page.getByText(/可否が逆/)).toHaveCount(0);

	// 修正案の結果
	await expect(main(v.page)).toContainText(new RegExp(`${other.label}\\s*・\\s*可決`));
	await expect(v.page.getByRole('link', { name: '修正案を見る' })).toHaveAttribute('href', `${path}/shusei`);
	await expect(v.page.getByRole('link', { name: '法案のページへ' })).toHaveAttribute('href', path);
});

test('基準7：否決と廃案の文言と定足数。参考の票が定足数に届いて可否が逆なら目立つ形で出す。廃案のときは比べない', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 5);
	const rejected = await s.bill(`否決の法案 ${s.label}`);
	await s.cast(rejected.id, 'yes', 3);
	await s.cast(rejected.id, 'no', 7);
	await s.cast(rejected.id, 'yes', 10, false);
	const v = await s.anonymous(firstOf(s.month));
	await open(v.page, kekkaOf(rejected.id));
	await expect(v.page.getByText('否決', { exact: true })).toBeVisible();
	await expect(v.page.getByText('IF世界の法律にはなりません')).toBeVisible();
	await expect(v.page.getByText('IF世界の法律になりました')).toHaveCount(0);
	// 開かなくても見える
	await expect(v.page.getByText('数えた票と参考の票で、可否が逆になりました')).toBeVisible();

	// 数えた票が定足数に届かず、参考の票は届いている：比べない
	const s2 = setup(browser, w, 6);
	const lapsed = await s2.bill(`廃案の法案 ${s2.label}`);
	await s2.cast(lapsed.id, 'yes', 10, false);
	const v2 = await s2.anonymous(firstOf(s2.month));
	await open(v2.page, kekkaOf(lapsed.id));
	await expect(v2.page.getByText('廃案', { exact: true })).toBeVisible();
	await expect(v2.page.getByText('数えた票が定足数（10票）に届きませんでした')).toBeVisible();
	await expect(main(v2.page)).toContainText(/数えた票\s*0(?!\d)/);
	await expect(v2.page.getByText(/可否が逆/)).toHaveCount(0);
	await expect(v2.page.getByText('結果は数えた票と同じでした')).toHaveCount(0);
});

test('基準8：法案のページに段階と「結果を見る」、一覧の「終わった」のタブに段階が出る。投票の画面から結果のページへ移る。処理の前は「結果を集計しています」', async ({ browser }, info) => {
	const w = info.project.name as Width;
	const s = setup(browser, w, 7);
	const { id, path, title } = await s.bill(`段階の法案 ${s.label}`, w === 'sp' ? 6 : 7);
	await s.cast(id, 'yes', 10);

	// 締切から1分のあいだは処理しない
	const v = await s.anonymous(firstOf(s.month, '00:00:30'));
	await open(v.page, kekkaOf(id));
	await expect(v.page.getByText('結果を集計しています')).toBeVisible();
	await expect(v.page.getByText('可決', { exact: true })).toHaveCount(0);
	await open(v.page, path);
	await expect(status(v.page, w, '集計中')).toBeVisible();

	await v.setNow(firstOf(s.month));
	await open(v.page, path);
	await expect(status(v.page, w, '可決')).toBeVisible();
	await v.page.getByRole('link', { name: '結果を見る' }).click();
	await expect(v.page).toHaveURL(new RegExp(`${kekkaOf(id)}$`));
	await expect(await ownedRow(v.page, title)).toContainText('可決');

	// 投票の画面はログインが要るので、ログインした人で確かめる
	const signedIn = await s.person(firstOf(s.month));
	const res = await signedIn.page.request.get(`/saiketsu/${id}`, { maxRedirects: 0 });
	expect(res.status()).toBe(303);
	expect(res.headers()['location']).toBe(kekkaOf(id));
});

test('信頼の境界：URL の法案の番号が形の違うとき、存在しないとき、下書きのときは 404', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 8);
	const a = await s.person(at(s.month, 5));
	const { ids } = await issueWithSolutions(a.page, `下書き ${s.label}`, [`下書きの解決策 ${s.label}`]);
	const draft = (await createAmendBill(a.page, `下書きの法案 ${s.label}`, ids[0])).replace('/houan/', '');
	for (const id of ['abc', '01', '0', '-1', '1.5', '99999999999', '9999999999', draft]) {
		expect((await a.page.request.get(kekkaOf(id))).status(), id).toBe(404);
	}
});
