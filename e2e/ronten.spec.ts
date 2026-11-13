// Issue #168 質疑の「いまの場面」と、委員長が立てる論点（#198 の受入基準）。理事の代行の判定（lastChairAction）に論点の操作が入ることは基準2で確かめる
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { billRequest, billSupportRequest, createAmendBill, issueWithSolutions, newUser, ORIGIN, postIssue, proposeRequest } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});
test.use({ actionTimeout: 15_000 });
// 発議と委員長選挙の準備が重い
test.beforeEach(() => test.setTimeout(240_000));

const stamp = () => Date.now() % 1e8;
const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
const ip = (w: string, group: number, n: number) => `10.${w === 'sp' ? 168 : 169}.${group}.${n}`;
/** 基準ごと・幅ごとに別の年を使う（2900年より前はほかのテストが使っている）。どの基準も4月〜6月の中で動く */
const monthOf = (w: string, group: number) => `${2900 + group * 2 + (w === 'sp' ? 0 : 1)}-05`;
const prevOf = (month: string) => month.replace(/-05$/, '-04');
const nextOf = (month: string) => month.replace(/-05$/, '-06');
const at = (month: string, day: number) => `${month}-${String(day).padStart(2, '0')}T09:00:00+09:00`;

type User = {
	page: Page;
	name: string;
	setNow: (now: string) => Promise<void>;
};
type Opts = { role?: 'moderator' | 'operator'; country?: string };

async function user(browser: Browser, address: string, now: string, name: string, opts: Opts = {}): Promise<User> {
	const u = await newUser(browser, {
		name,
		ip: address,
		days: 40,
		...(opts.role ? { role: opts.role } : {}),
		...(opts.country ? { country: opts.country } : {})
	});
	contexts.push(u.context);
	const setNow = (t: string) =>
		u.context.setExtraHTTPHeaders({
			'x-test-ip': address,
			'x-test-now': t,
			...(opts.country ? { 'x-test-country': opts.country } : {})
		});
	await setNow(now);
	return { page: u.page, name, setNow };
}

function setup(browser: Browser, w: string, group: number) {
	const month = monthOf(w, group);
	const label = `r${group}${w}${stamp()}`;
	let seq = 0;
	const person = (now: string, opts: Opts = {}) => {
		seq += 1;
		return user(browser, ip(w, group, seq), now, `u${seq}-${label}`, opts);
	};
	/** 発議した法案。now に発議する。supporter を渡すと、その人も賛同する（関わった法案） */
	async function bill(now: string, supporter?: User) {
		const a = await person(now);
		const title = `論点の法案 ${label} ${seq}`;
		const { ids } = await issueWithSolutions(a.page, title, [`解決策 ${title}`]);
		const path = await createAmendBill(a.page, title, ids[0]);
		const supporters = supporter ? [supporter] : [];
		while (supporters.length < 3) supporters.push(await person(now));
		for (const b of supporters) {
			await b.setNow(now);
			const res = await billSupportRequest(b.page, path, {
				op: 'add',
				rev: '1'
			});
			expect(res.status(), await res.text()).toBe(200);
		}
		const res = await proposeRequest(a.page, path);
		expect(res.status(), await res.text()).toBe(200);
		return path;
	}
	return { month, label, person, bill };
}

const qa = (bill: string) => `${bill}/shitsugi`;
const scene = (page: Page) => page.getByRole('region', { name: 'いまの場面' });
const pointForm = (page: Page) => page.getByRole('region', { name: '論点を立てる' });
const openRequest = (page: Page, bill: string, title: string) => billRequest(page, `${qa(bill)}?/openPoint`, { title });
const closeRequest = (page: Page, bill: string, point: string) => billRequest(page, `${qa(bill)}?/closePoint`, { point });

/** 画面の欄から論点を立てる。断られていないことも確かめる */
async function openByForm(page: Page, bill: string, title: string) {
	await page.goto(qa(bill));
	await hydrated(page);
	await pointForm(page).getByLabel('論点の見出し').fill(title);
	const [res] = await Promise.all([
		page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('openPoint')),
		pointForm(page).getByRole('button', { name: '論点を立てる' }).click()
	]);
	expect(res.status()).toBe(200);
	expect(await res.text()).not.toContain('"type":"failure"');
	await expect(scene(page).getByText(title)).toBeVisible();
}

/** 画面の「閉じる」で論点を閉じる */
async function closeByButton(page: Page, bill: string, no: number) {
	await page.goto(qa(bill));
	await hydrated(page);
	const [res] = await Promise.all([
		page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('closePoint')),
		scene(page)
			.getByRole('button', { name: `論点${no}を閉じる` })
			.click()
	]);
	expect(res.status()).toBe(200);
	expect(await res.text()).not.toContain('"type":"failure"');
}

test('基準1：質疑のタブの上に「いまの場面」が出て、開いている論点の見出しが並ぶ。0件なら「論点はまだありません」', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 1);
	const bill = await s.bill(at(s.month, 5));
	const op = await s.person(at(s.month, 16), { role: 'operator' });

	// ログインしていない人にも出る
	const anonymous = await browser.newContext({
		baseURL: ORIGIN,
		extraHTTPHeaders: {
			'x-test-now': at(s.month, 16),
			'x-test-ip': ip(w, 1, 90)
		}
	});
	contexts.push(anonymous);
	const viewer = await anonymous.newPage();
	await viewer.goto(qa(bill));
	await expect(
		scene(viewer).getByRole('heading', {
			name: '3週目：質疑と修正。論点はまだありません'
		})
	).toBeVisible();

	const first = `解約の方法をどこに書かせるか ${s.label}`;
	const second = `事業者の負担はどれくらいか ${s.label}`;
	await openByForm(op.page, bill, first);
	await openByForm(op.page, bill, second);

	await viewer.goto(qa(bill));
	const box = scene(viewer);
	await expect(box.getByRole('heading', { name: '3週目：質疑と修正。論点は2つ' })).toBeVisible();
	const items = box.getByRole('listitem');
	await expect(items).toHaveCount(2);
	await expect(items.nth(0)).toContainText('論点1');
	await expect(items.nth(0)).toContainText(first);
	await expect(items.nth(1)).toContainText('論点2');
	await expect(items.nth(1)).toContainText(second);
	// 見る人には論点を立てる欄も閉じるボタンも出ない
	await expect(pointForm(viewer)).toHaveCount(0);
	await expect(box.getByRole('button')).toHaveCount(0);
	// 「いまの場面」は質疑の一覧より上にある
	const sceneTop = (await box.boundingBox())?.y ?? Infinity;
	const listTop = (await viewer.getByRole('navigation', { name: '質疑の絞り込み' }).boundingBox())?.y ?? -Infinity;
	expect(sceneTop).toBeLessThan(listTop);

	// 4週目は採決の場面
	await anonymous.setExtraHTTPHeaders({
		'x-test-now': at(s.month, 23),
		'x-test-ip': ip(w, 1, 90)
	});
	await viewer.goto(qa(bill));
	await expect(scene(viewer).getByRole('heading', { name: '4週目：採決。論点は2つ' })).toBeVisible();
});

test('基準2：論点を立てる・閉じるのは委員長、代行中の理事、運営、運営協力者だけ。関わった法案とほかの人には欄を出さず、送っても断る', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 2);
	const next = nextOf(s.month);

	// 5月：選挙。委員長と理事の2人は3週目に質疑を書いて立候補する
	const first = await s.bill(at(s.month, 5));
	const chair = await s.person(at(s.month, 16));
	const director = await s.person(at(s.month, 16));
	for (const u of [chair, director]) {
		const res = await billRequest(u.page, `${qa(first)}/kaku`, {
			body: `質疑 ${s.label} ${u.name}`,
			'cf-turnstile-response': 'test-pass'
		});
		expect(res.status(), await res.text()).toBeLessThan(400);
	}
	// 6月に審議する法案（5月の締切のあとの発議）。2本目は委員長が賛同している
	const bill = await s.bill(at(s.month, 16));
	const involved = await s.bill(at(s.month, 16), chair);
	for (const u of [chair, director]) {
		await u.setNow(at(s.month, 22));
		const res = await billRequest(u.page, '/iinkai?/stand', {
			'cf-turnstile-response': 'test-pass'
		});
		expect(res.status(), await res.text()).toBe(200);
	}
	// 投票資格のある人（4月に課題を書いた人）が2票と1票を入れる
	for (const whom of [chair, chair, director]) {
		const v = await s.person(at(prevOf(s.month), 10));
		await postIssue(v.page, { title: `前の月の課題 ${s.label} ${v.name}` });
		await v.setNow(at(s.month, 23));
		await v.page.goto('/iinkai');
		await hydrated(v.page);
		await v.page.getByRole('radio', { name: whom.name }).check();
		const [res] = await Promise.all([v.page.waitForResponse((r) => r.request().method() === 'POST'), v.page.getByRole('button', { name: '投票する', exact: true }).click()]);
		expect(await res.text()).not.toContain('"type":"failure"');
	}
	// 6月：確定させる
	for (const u of [chair, director]) await u.setNow(at(next, 2));
	await chair.page.goto('/iinkai');
	await expect(chair.page.getByRole('region', { name: '委員長と理事' }).getByText(chair.name)).toBeVisible();

	const stranger = await s.person(at(next, 2));
	const op = await s.person(at(next, 2), { role: 'operator' });
	const mod = await s.person(at(next, 2), { role: 'moderator' });

	// ほかの人：欄が出ず、送っても断る
	await stranger.page.goto(qa(bill));
	await expect(scene(stranger.page)).toBeVisible();
	await expect(pointForm(stranger.page)).toHaveCount(0);
	expect((await openRequest(stranger.page, bill, '権限のない論点')).status()).toBe(403);
	// 委員長が7日たたずに操作している理事も同じ
	await director.page.goto(qa(bill));
	await expect(pointForm(director.page)).toHaveCount(0);
	expect((await openRequest(director.page, bill, '代行でない理事の論点')).status()).toBe(403);

	// 委員長：立てられる。賛同した法案ではできない
	const chairPoint = `委員長の論点 ${s.label}`;
	await openByForm(chair.page, bill, chairPoint);
	await chair.page.goto(qa(involved));
	await expect(scene(chair.page)).toBeVisible();
	await expect(pointForm(chair.page)).toHaveCount(0);
	expect((await openRequest(chair.page, involved, '関わった法案の論点')).status()).toBe(403);

	// 運営と運営協力者
	expect((await openRequest(op.page, bill, `運営の論点 ${s.label}`)).status()).toBe(200);
	expect((await openRequest(mod.page, bill, `運営協力者の論点 ${s.label}`)).status()).toBe(200);
	await op.page.goto(qa(bill));
	await expect(pointForm(op.page)).toBeVisible();

	// 委員長の最後の操作（2日の論点）から7日たたない8日は、理事は代行できない。7日を過ぎた10日には代行でき、閉じられる
	await director.setNow(at(next, 8));
	expect((await closeRequest(director.page, bill, '1')).status()).toBe(403);
	await director.setNow(at(next, 10));
	await closeByButton(director.page, bill, 1);
	await expect(scene(director.page).getByRole('heading', { name: /論点は2つ$/ })).toBeVisible();

	// 公開の記録には役職が出る
	await stranger.page.goto('/unei');
	const log = stranger.page.getByRole('region', {
		name: '法案の質疑・修正案・専門家の解説への対応'
	});
	await expect(log.locator('tr', { hasText: '論点を立てた' }).filter({ hasText: chairPoint })).toContainText('委員長');
	await expect(log.locator('tr', { hasText: '論点を閉じた' }).filter({ hasText: chairPoint })).toContainText('理事');
});

test('基準3：論点を立てられるのは発議から採決の締切まで。閉じた論点は「閉じた論点」として残る', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 3);
	const bill = await s.bill(at(s.month, 5));
	const op = await s.person(at(s.month, 5), { role: 'operator' });

	// 下書きには質疑のタブがなく、論点も立てられない
	const a = await s.person(at(s.month, 5));
	const { ids } = await issueWithSolutions(a.page, `下書き ${s.label}`, [`下書きの解決策 ${s.label}`]);
	const draft = await createAmendBill(a.page, `下書き ${s.label}`, ids[0]);
	expect((await openRequest(op.page, draft, '下書きの論点')).status()).toBe(404);

	// 発議の段（1週目）から立てられる
	const early = `発議の段の論点 ${s.label}`;
	await openByForm(op.page, bill, early);
	await expect(scene(op.page).getByRole('heading', { name: '1週目：発議。論点は1つ' })).toBeVisible();

	// 3週目に1つ立てて、最初の論点を閉じる
	await op.setNow(at(s.month, 16));
	const middle = `質疑の段の論点 ${s.label}`;
	await openByForm(op.page, bill, middle);
	await closeByButton(op.page, bill, 1);
	await op.page.goto(qa(bill));
	const box = scene(op.page);
	await expect(box.getByRole('heading', { name: '3週目：質疑と修正。論点は1つ' })).toBeVisible();
	await box.getByText('閉じた論点 1').click();
	await expect(box.getByRole('group').getByText(early)).toBeVisible();
	// 閉じた論点は、もう閉じられない
	expect((await closeRequest(op.page, bill, '1')).status()).toBe(409);

	// 4週目（採決）も立てられる
	await op.setNow(at(s.month, 28));
	expect((await openRequest(op.page, bill, `採決の段の論点 ${s.label}`)).status()).toBe(200);

	// 採決の締切のあとは、欄が出ず断る。閉じた論点は残っている
	await op.setNow(at(nextOf(s.month), 2));
	await op.page.goto(qa(bill));
	await expect(pointForm(op.page)).toHaveCount(0);
	await expect(scene(op.page).getByRole('button', { name: /を閉じる$/ })).toHaveCount(0);
	expect((await openRequest(op.page, bill, `締切のあとの論点 ${s.label}`)).status()).toBe(409);
	expect((await closeRequest(op.page, bill, '2')).status()).toBe(409);
	await scene(op.page).getByText('閉じた論点 1').click();
	await expect(scene(op.page).getByText(early)).toBeVisible();
	await expect(scene(op.page).getByText(middle)).toBeVisible();
});

test('基準4：立てた・閉じたが /unei の記録に出る。出すのは役職だけで、だれがしたかは出さない', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 4);
	const bill = await s.bill(at(s.month, 5));
	const op = await s.person(at(s.month, 16), { role: 'operator' });
	const mod = await s.person(at(s.month, 16), { role: 'moderator' });
	const opPoint = `運営が立てた論点 ${s.label}`;
	const modPoint = `運営協力者が立てた論点 ${s.label}`;
	expect((await openRequest(op.page, bill, opPoint)).status()).toBe(200);
	expect((await openRequest(mod.page, bill, modPoint)).status()).toBe(200);
	expect((await closeRequest(mod.page, bill, '1')).status()).toBe(200);

	const anonymous = await browser.newContext({
		baseURL: ORIGIN,
		extraHTTPHeaders: {
			'x-test-now': at(s.month, 16),
			'x-test-ip': ip(w, 4, 90)
		}
	});
	contexts.push(anonymous);
	const viewer = await anonymous.newPage();
	await viewer.goto('/unei');
	const log = viewer.getByRole('region', {
		name: '法案の質疑・修正案・専門家の解説への対応'
	});
	const opened = log.locator('tr', { hasText: '論点を立てた' }).filter({ hasText: opPoint });
	await expect(opened).toHaveCount(1);
	await expect(opened.locator('td[data-label="何か"]')).toHaveText('論点');
	await expect(opened).toContainText('運営');
	await expect(opened.getByRole('link')).toHaveAttribute('href', qa(bill));
	await expect(log.locator('tr', { hasText: '論点を立てた' }).filter({ hasText: modPoint })).toContainText('運営協力者');
	await expect(log.locator('tr', { hasText: '論点を閉じた' }).filter({ hasText: opPoint })).toContainText('運営協力者');

	// だれがしたかは、画面にもデータにも出ない
	const data = await (await viewer.request.get('/unei/__data.json')).text();
	for (const u of [op, mod]) {
		await expect(viewer.getByText(u.name)).toHaveCount(0);
		expect(data, u.name).not.toContain(u.name);
	}
	expect(data).not.toContain('actorUserId');
});

test('信頼の境界：見出しの形（空、長すぎる、改行、制御文字）は 400、ない論点の番号は 400/404。ログインと国の確かめ', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 5);
	const bill = await s.bill(at(s.month, 5));
	const op = await s.person(at(s.month, 16), { role: 'operator' });

	for (const bad of ['', '   ', 'あ'.repeat(61), '改行の\n見出し', '制御文字\u0007の見出し', '向きの\u202e文字']) {
		expect((await openRequest(op.page, bill, bad)).status(), JSON.stringify(bad)).toBe(400);
	}
	expect((await billRequest(op.page, `${qa(bill)}?/openPoint`, {})).status()).toBe(400);
	// 60字までは立てられる。HTML は文字のまま出る
	expect((await openRequest(op.page, bill, 'い'.repeat(60))).status()).toBe(200);
	const html = `<b>太字</b><script>window.__x=1</script> ${s.label}`;
	expect((await openRequest(op.page, bill, html)).status()).toBe(200);
	await op.page.goto(qa(bill));
	await expect(scene(op.page).getByText(html)).toBeVisible();
	await expect(scene(op.page).locator('b')).toHaveCount(0);

	// 番号の形は 400、ない番号は 404
	for (const bad of ['', 'abc', '0', '-1', '1.5', '1e3', ' 1']) expect((await closeRequest(op.page, bill, bad)).status(), JSON.stringify(bad)).toBe(400);
	expect((await billRequest(op.page, `${qa(bill)}?/closePoint`, {})).status()).toBe(400);
	expect((await closeRequest(op.page, bill, '3')).status()).toBe(404);
	expect((await closeRequest(op.page, bill, '999999999')).status()).toBe(404);
	// ほかの法案の論点の番号は、この法案にはない
	const other = await s.bill(at(s.month, 5));
	expect((await closeRequest(op.page, other, '1')).status()).toBe(404);

	// ログインしていなければログインへ
	const anonymous = await browser.newContext({
		baseURL: ORIGIN,
		extraHTTPHeaders: {
			'x-test-now': at(s.month, 16),
			'x-test-ip': ip(w, 5, 90)
		}
	});
	contexts.push(anonymous);
	const stranger = await anonymous.newPage();
	for (const res of [await openRequest(stranger, bill, '論点'), await closeRequest(stranger, bill, '1')]) {
		expect(res.status()).toBe(303);
		expect(res.headers()['location']).toContain('/login?next=');
	}
	// 国：日本からだけ
	const abroad = await s.person(at(s.month, 16), {
		role: 'operator',
		country: 'US'
	});
	expect((await openRequest(abroad.page, bill, '海外からの論点')).status()).toBe(403);
	expect((await closeRequest(abroad.page, bill, '1')).status()).toBe(403);
});
