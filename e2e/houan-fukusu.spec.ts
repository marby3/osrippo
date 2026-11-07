// Issue #53 法案で2本以上の法令と、別の課題の解決策を扱う（設計書 docs/spec/53.md）。反映と出し直しの中身は src/lib/db/multi-law.test.ts
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { billPath, billRequest, billSupportRequest, ifTarget, IF_LAW, issueWithSolutions, newUser, ORIGIN, postIssue, proposeRequest, solutionStaffRequest, type BillForm } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});
test.use({ actionTimeout: 15_000 });
test.beforeEach(() => test.setTimeout(300_000));

const stamp = () => Date.now() % 1e8;
const hydrated = (page: Page) => page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
/** 基準ごと・幅ごとに別の年を使う（2477年まではほかのテストが使っている） */
const monthOf = (w: string, group: number) => `${2478 + group * 2 + (w === 'sp' ? 0 : 1)}-05`;
const shift = (month: string, n: number) => month.replace(/-05$/, `-${String(5 + n).padStart(2, '0')}`);
const at = (month: string, day: number) => `${month}-${String(day).padStart(2, '0')}T09:00:00+09:00`;
/** IF_LAW の条の位置（kekka 0〜9、if-sekai 10〜33、kakunin 34〜41、dashinaoshi 44・45） */
const slot = (w: string) => 46 + (w === 'sp' ? 0 : 1);

const LAW = '412AC0000000061';
const LAW_TITLE = '消費者契約法';
const TOKUSHO = '351AC0000000057';
const TOKUSHO_TITLE = '特定商取引に関する法律';
const KEIHYO_TITLE = '不当景品類及び不当表示防止法';
/** 消費者契約法の古い版（いまの版でない） */
const OLD_BASE = '412AC0000000061_20161001_425AC0000000096@0';

type User = { page: Page; name: string; setNow: (now: string) => Promise<void> };

function setup(browser: Browser, w: string, group: number) {
	const month = monthOf(w, group);
	const label = `k${group}${w}${stamp()}`;
	let seq = 0;
	const person = async (now: string | null, opts: { role?: 'moderator' | 'operator' } = {}): Promise<User> => {
		seq += 1;
		const address = `10.${w === 'sp' ? 115 : 116}.${group}.${seq}`;
		const name = `u${seq}-${label}`;
		const u = await newUser(browser, { name, ip: address, days: 8, role: opts.role });
		contexts.push(u.context);
		const setNow = (t: string) => u.context.setExtraHTTPHeaders({ 'x-test-ip': address, 'x-test-now': t });
		if (now) await setNow(now);
		return { page: u.page, name, setNow };
	};
	return { month, label, person };
}

/** 書く画面が条文を取りに行くのと同じところから、基にする版の印 */
async function baseOf(page: Page, law: string) {
	const res = await page.request.get(`/houan/kaku/joubun?law=${law}`);
	expect(res.status()).toBe(200);
	return ((await res.json()) as { revisionId: string }).revisionId;
}

const common = (title: string, solution: string | string[]): BillForm => ({
	title,
	affected: '解約できずに困っている人',
	sideEffects: '事業者の負担が増える',
	solution,
	'cf-turnstile-response': 'test-pass'
});

/** 消費者契約法の第1条と、特定商取引法の第1条を書きかえる一括改正のフォーム */
async function twoLawForm(page: Page, title: string, solution: string, extra: BillForm = {}): Promise<BillForm> {
	return {
		kind: 'amend',
		...common(title, solution),
		law: LAW,
		base: await baseOf(page, LAW),
		'law.1': TOKUSHO,
		'base.1': await baseOf(page, TOKUSHO),
		'op.0': 'amend',
		'target.0': '1',
		'caption.0': '（目的）',
		'body.0': `消費者契約法の書きかえ ${title}`,
		'op.1': 'amend',
		'seq.1': '1',
		'target.1': '1',
		'caption.1': '（目的）',
		'body.1': `特定商取引法の書きかえ ${title}`,
		...extra
	};
}

const changesTab = (page: Page) => page.getByRole('navigation', { name: '法案のページ' }).getByRole('link', { name: /^変更点/ });
const formal = (page: Page, text: string) => page.getByText(text, { exact: true });
const row = (page: Page, n: number) => page.getByRole('group', { name: `変更 ${n}` });

test('基準1：一括改正。ほかの法令を足して法令ごとに条を書いて保存でき、正式名は「等の一部を改正する法律案」、変更点は法令名つきで連番が続く', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 0);
	const a = await s.person(null);
	const { ids } = await issueWithSolutions(a.page, `一括改正 ${s.label}`, [`一括改正の解決策 ${s.label}`]);
	const title = `一括改正の法案 ${s.label}`;

	await a.page.goto(`/houan/kaku?kaiketsu=${ids[0]}`);
	await hydrated(a.page);
	await a.page.getByRole('radio', { name: '改正' }).check();
	await a.page.getByLabel('題名').fill(title);
	await a.page.getByLabel('対象の法令').selectOption({ label: LAW_TITLE });
	await row(a.page, 1).getByLabel('変える条').selectOption('1');
	await expect(row(a.page, 1).getByLabel('変更後の条文')).not.toHaveValue('');
	await row(a.page, 1).getByLabel('変更後の条文').fill(`主の法令の書きかえ ${s.label}`);

	await a.page.getByRole('button', { name: 'ほかの法令も変える' }).click();
	const other = a.page.getByRole('group', { name: 'ほかの法令 1' });
	// ほかの枠で選んだ法令は出ない
	await expect(other.getByLabel('法令', { exact: true }).locator('option', { hasText: LAW_TITLE })).toHaveCount(0);
	await other.getByLabel('法令', { exact: true }).selectOption({ label: KEIHYO_TITLE });
	await row(a.page, 2).getByLabel('変える条').selectOption('2');
	await expect(row(a.page, 2).getByLabel('変更後の条文')).not.toHaveValue('');
	await row(a.page, 2).getByLabel('変更後の条文').fill(`2本目の法令の書きかえ ${s.label}`);
	await a.page.getByLabel('誰が困っているか').fill('困っている人');
	await a.page.getByLabel('副作用').fill('副作用');
	await a.page.getByRole('button', { name: '下書きを保存する' }).click();

	await expect(a.page.getByRole('heading', { level: 1, name: title })).toBeVisible();
	await expect(formal(a.page, `${LAW_TITLE}等の一部を改正する法律案`)).toBeVisible();
	await changesTab(a.page).click();
	await expect(a.page.getByRole('heading', { name: `1. ${LAW_TITLE} 第1条 ・ 書きかえ` })).toBeVisible();
	await expect(a.page.getByRole('heading', { name: `2. ${KEIHYO_TITLE} 第2条 ・ 書きかえ` })).toBeVisible();
	await expect(a.page.getByText(`2本目の法令の書きかえ ${s.label}`).first()).toBeVisible();
});

test('基準2：制定の法案に関連する法令を足して条を書ける。正式名は新法の名前＋案、新法の条の番号は新法の中で順に付く', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 1);
	const a = await s.person(null);
	const { ids } = await issueWithSolutions(a.page, `制定と関連法 ${s.label}`, [`制定の解決策 ${s.label}`]);
	const newTitle = `解約保護 ${s.label} 法`;

	await a.page.goto(`/houan/kaku?kaiketsu=${ids[0]}`);
	await hydrated(a.page);
	await a.page.getByRole('radio', { name: '制定' }).check();
	await a.page.getByLabel('題名').fill(`制定と関連法の法案 ${s.label}`);
	await a.page.getByLabel('法令名').fill(newTitle);
	await a.page.getByRole('group', { name: '第1条' }).getByLabel('条文').fill(`この法律は、${s.label}を守ることを目的とする。`);
	await a.page.getByRole('button', { name: '条を足す' }).click();
	await a.page.getByRole('group', { name: '第2条' }).getByLabel('条文').fill(`新法の第2条 ${s.label}`);

	await a.page.getByRole('button', { name: 'ほかの法令も変える' }).click();
	const related = a.page.getByRole('group', { name: '関連する法令 1' });
	await expect(related.getByText('附則で')).toBeVisible();
	await related.getByLabel('法令', { exact: true }).selectOption({ label: LAW_TITLE });
	await row(a.page, 1).getByLabel('変える条').selectOption('1');
	await expect(row(a.page, 1).getByLabel('変更後の条文')).not.toHaveValue('');
	await row(a.page, 1).getByLabel('変更後の条文').fill(`関連法の書きかえ ${s.label}`);
	await a.page.getByLabel('誰が困っているか').fill('困っている人');
	await a.page.getByLabel('副作用').fill('副作用');
	await a.page.getByRole('button', { name: '下書きを保存する' }).click();

	await expect(formal(a.page, `${newTitle}案`)).toBeVisible();
	await changesTab(a.page).click();
	await expect(a.page.getByRole('heading', { name: `1. ${newTitle} 第1条 ・ 新しく追加` })).toBeVisible();
	await expect(a.page.getByRole('heading', { name: `2. ${newTitle} 第2条 ・ 新しく追加` })).toBeVisible();
	await expect(a.page.getByRole('heading', { name: `3. ${LAW_TITLE} 第1条 ・ 書きかえ` })).toBeVisible();
});

test('基準3：廃止の法案で足した法令を廃止か改正で選べ、正式名は廃止が1本なら「を廃止する」、2本なら「等を廃止する」', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 2);
	const a = await s.person(null);
	const { ids } = await issueWithSolutions(a.page, `廃止と関連法 ${s.label}`, [`廃止の解決策 ${s.label}`]);

	await a.page.goto(`/houan/kaku?kaiketsu=${ids[0]}`);
	await hydrated(a.page);
	await a.page.getByRole('radio', { name: '廃止' }).check();
	await a.page.getByLabel('題名').fill(`廃止と改正の法案 ${s.label}`);
	await a.page.getByLabel('対象の法令').selectOption({ label: LAW_TITLE });
	await a.page.getByRole('button', { name: 'ほかの法令も変える' }).click();
	const related = a.page.getByRole('group', { name: '関連する法令 1' });
	await related.getByLabel('法令', { exact: true }).selectOption({ label: TOKUSHO_TITLE });
	// 廃止を選ぶと変える条の欄はなく、改正を選ぶと出る
	await related.getByRole('radio', { name: '廃止する' }).check();
	await expect(related.getByLabel('変える条')).toHaveCount(0);
	await related.getByRole('radio', { name: '一部を改正する' }).check();
	await row(a.page, 1).getByLabel('変える条').selectOption('1');
	await expect(row(a.page, 1).getByLabel('変更後の条文')).not.toHaveValue('');
	await row(a.page, 1).getByLabel('変更後の条文').fill(`廃止に合わせた書きかえ ${s.label}`);
	await a.page.getByLabel('誰が困っているか').fill('困っている人');
	await a.page.getByLabel('副作用').fill('副作用');
	await a.page.getByRole('button', { name: '下書きを保存する' }).click();
	await expect(formal(a.page, `${LAW_TITLE}を廃止する法律案`)).toBeVisible();
	await changesTab(a.page).click();
	await expect(a.page.getByText(new RegExp(`${LAW_TITLE}.*廃止`)).first()).toBeVisible();
	await expect(a.page.getByRole('heading', { name: `1. ${TOKUSHO_TITLE} 第1条 ・ 書きかえ` })).toBeVisible();

	// 2本とも廃止
	const res = await billRequest(a.page, '/houan/kaku', {
		kind: 'repeal',
		...common(`2本を廃止する法案 ${s.label}`, ids[0]),
		law: LAW,
		base: await baseOf(a.page, LAW),
		'law.1': TOKUSHO,
		'base.1': await baseOf(a.page, TOKUSHO),
		'action.1': 'repeal'
	});
	await a.page.goto(billPath(res));
	await expect(formal(a.page, `${LAW_TITLE}等を廃止する法律案`)).toBeVisible();
});

test('基準4：2本の下書きを開くと両方の中身が入り、法令を外す・足す・直して保存できる。古い版の法令があれば開き直すよう案内する', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 3);
	const a = await s.person(null);
	const { ids } = await issueWithSolutions(a.page, `直す ${s.label}`, [`直す解決策 ${s.label}`]);
	const title = `直す法案 ${s.label}`;
	const path = billPath(await billRequest(a.page, '/houan/kaku', await twoLawForm(a.page, title, ids[0])));

	await a.page.goto(`${path}/kaku`);
	await hydrated(a.page);
	await expect(a.page.getByLabel('対象の法令')).toHaveValue(LAW);
	await expect(row(a.page, 1).getByLabel('変更後の条文')).toHaveValue(`消費者契約法の書きかえ ${title}`);
	const other = a.page.getByRole('group', { name: 'ほかの法令 1' });
	await expect(other.getByLabel('法令', { exact: true })).toHaveValue(TOKUSHO);
	await expect(row(a.page, 2).getByLabel('変える条')).toHaveValue('1');
	await expect(row(a.page, 2).getByLabel('変更後の条文')).toHaveValue(`特定商取引法の書きかえ ${title}`);

	// 外して、景品表示法を足す
	await other.getByRole('button', { name: 'この法令を外す' }).click();
	await expect(a.page.getByRole('group', { name: 'ほかの法令 1' })).toHaveCount(0);
	await a.page.getByRole('button', { name: 'ほかの法令も変える' }).click();
	await a.page.getByRole('group', { name: 'ほかの法令 1' }).getByLabel('法令', { exact: true }).selectOption({ label: KEIHYO_TITLE });
	await row(a.page, 2).getByLabel('変える条').selectOption('3');
	await expect(row(a.page, 2).getByLabel('変更後の条文')).not.toHaveValue('');
	await row(a.page, 2).getByLabel('変更後の条文').fill(`足し直した書きかえ ${s.label}`);
	await a.page.getByRole('button', { name: '下書きを保存する' }).click();
	await expect(a.page).toHaveURL(new RegExp(`${path}$`));
	await changesTab(a.page).click();
	await expect(a.page.getByRole('heading', { name: `2. ${KEIHYO_TITLE} 第3条 ・ 書きかえ` })).toBeVisible();
	await expect(a.page.getByText(TOKUSHO_TITLE)).toHaveCount(0);

	// 足した法令の基にした版が古ければ、保存せずに開き直すよう案内する
	const html = await (await a.page.request.get(`${path}/kaku`)).text();
	const rev = /name="rev" value="(\d+)"/.exec(html)?.[1] as string;
	const stale = await billRequest(a.page, `${path}/kaku`, { ...(await twoLawForm(a.page, title, ids[0], { law: TOKUSHO, 'law.1': LAW, 'base.1': OLD_BASE })), base: await baseOf(a.page, TOKUSHO), rev });
	expect(stale.status()).toBe(409);
	expect(await stale.text()).toContain('条文が新しくなりました。開き直してください。');
});

test('基準5：法令を選んでいない枠と変える条のない枠はそのそばに誤りを出し、入力を残す。50条までは法案全体で数える', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 4);
	const a = await s.person(null);
	const { ids } = await issueWithSolutions(a.page, `誤り ${s.label}`, [`誤りの解決策 ${s.label}`]);
	const title = `誤りの法案 ${s.label}`;

	await a.page.goto(`/houan/kaku?kaiketsu=${ids[0]}`);
	await hydrated(a.page);
	await a.page.getByRole('radio', { name: '改正' }).check();
	await a.page.getByLabel('題名').fill(title);
	await a.page.getByLabel('対象の法令').selectOption({ label: LAW_TITLE });
	await row(a.page, 1).getByLabel('変える条').selectOption('1');
	await expect(row(a.page, 1).getByLabel('変更後の条文')).not.toHaveValue('');
	await row(a.page, 1).getByLabel('変更後の条文').fill(`誤りのある法案の本文 ${s.label}`);
	await a.page.getByLabel('誰が困っているか').fill('困っている人');
	await a.page.getByLabel('副作用').fill('副作用');

	// 法令を選んでいない枠
	await a.page.getByRole('button', { name: 'ほかの法令も変える' }).click();
	const other = a.page.getByRole('group', { name: 'ほかの法令 1' });
	await a.page.getByRole('button', { name: '下書きを保存する' }).click();
	await expect(other.getByText('対象の法令を選んでください。')).toBeVisible();
	await expect(a.page.getByLabel('題名')).toHaveValue(title);

	// 変える条のない枠
	await other.getByLabel('法令', { exact: true }).selectOption({ label: TOKUSHO_TITLE });
	await row(a.page, 2).getByRole('button', { name: 'この変更を外す' }).click();
	await a.page.getByRole('button', { name: '下書きを保存する' }).click();
	await expect(other.getByText('変える条を1つ以上選んでください。')).toBeVisible();
	await expect(row(a.page, 1).getByLabel('変更後の条文')).toHaveValue(`誤りのある法案の本文 ${s.label}`);

	// 2本で51条
	const rows = (from: number, n: number, seq: string) =>
		Object.fromEntries(
			Array.from({ length: n }, (_, i) => [
				[`op.${from + i}`, 'add'],
				[`seq.${from + i}`, seq],
				[`num.${from + i}`, `第1条の${i + 2}`],
				[`body.${from + i}`, '足す条']
			]).flat()
		);
	const form = await twoLawForm(a.page, `51条 ${s.label}`, ids[0]);
	for (const k of Object.keys(form)) if (/^(op|seq|target|caption|body)\.\d+$/.test(k)) delete form[k];
	const res = await billRequest(a.page, '/houan/kaku', { ...form, ...rows(0, 26, '0'), ...rows(26, 25, '1') });
	expect(res.status()).toBe(400);
	expect(await res.text()).toContain('変える条は、法案全体で50条までにしてください。');
});

test('基準6：ほかの課題の解決策を探して選んで保存でき、法案のページに元の課題のリンクが出る。5つまで。非表示は出ない。直す画面でも出る', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 5);
	const a = await s.person(null);
	const word = `zq${s.label}`;
	const start = await issueWithSolutions(a.page, `書き始め ${s.label}`, [`書き始めの解決策 ${s.label}`]);
	const others = await issueWithSolutions(a.page, `ほかの課題 ${s.label}`, [1, 2, 3, 4, 5].map((n) => `ほかの課題の解決策${n} ${word}`));
	const hidden = await issueWithSolutions(a.page, `隠す課題 ${s.label}`, [`隠した解決策 ${word}`]);
	const mod = await s.person(null, { role: 'moderator' });
	expect((await solutionStaffRequest(mod.page, 'hideSolution', { solution: hidden.ids[0], reason: 'spam', note: '探さない' })).status()).toBeLessThan(400);

	await a.page.goto(`/houan/kaku?kaiketsu=${start.ids[0]}`);
	await hydrated(a.page);
	const cited = a.page.getByRole('group', { name: '元になった解決策' });
	await cited.getByLabel('ほかの課題の解決策を探す').fill(word);
	// Enter でもフォームを送らずに探す
	await cited.getByLabel('ほかの課題の解決策を探す').press('Enter');
	const results = cited.getByRole('list', { name: '探した結果' });
	await expect(results.getByRole('listitem')).toHaveCount(5);
	await expect(results.getByText('隠した解決策')).toHaveCount(0);
	await expect(results.getByRole('listitem').first()).toContainText(`法案の元の課題 ほかの課題 ${s.label}`);
	for (const n of [1, 2, 3, 4]) await results.getByRole('listitem').filter({ hasText: `ほかの課題の解決策${n} ` }).getByRole('button', { name: '選ぶ' }).click();
	// 書き始めの1つと4つで5つ
	await expect(results.getByRole('listitem').filter({ hasText: 'ほかの課題の解決策5 ' }).getByRole('button', { name: '選ぶ' })).toBeDisabled();
	await expect(cited.getByRole('checkbox', { name: `ほかの課題の解決策1 ${word}` })).toBeChecked();
	await expect(cited.getByRole('heading', { name: `法案の元の課題 ほかの課題 ${s.label}` })).toBeVisible();
	// 1つ外して保存する
	await cited.getByRole('checkbox', { name: `ほかの課題の解決策4 ${word}` }).uncheck();

	await a.page.getByRole('radio', { name: '改正' }).check();
	await a.page.getByLabel('題名').fill(`ほかの課題の法案 ${s.label}`);
	await a.page.getByLabel('対象の法令').selectOption({ label: LAW_TITLE });
	await row(a.page, 1).getByLabel('変える条').selectOption('1');
	await expect(row(a.page, 1).getByLabel('変更後の条文')).not.toHaveValue('');
	await row(a.page, 1).getByLabel('変更後の条文').fill(`ほかの課題の法案の本文 ${s.label}`);
	await a.page.getByLabel('誰が困っているか').fill('困っている人');
	await a.page.getByLabel('副作用').fill('副作用');
	await a.page.getByRole('button', { name: '下書きを保存する' }).click();
	await expect(a.page).toHaveURL(/\/houan\/\d+$/);
	const path = new URL(a.page.url()).pathname;

	const section = a.page.locator('section').filter({ has: a.page.getByRole('heading', { name: '元になった解決策' }) });
	await expect(section.getByText(`ほかの課題の解決策1 ${word}`)).toBeVisible();
	await expect(section.getByText(`ほかの課題の解決策4 ${word}`)).toHaveCount(0);
	await expect(section.getByRole('link', { name: `法案の元の課題 ほかの課題 ${s.label}` }).first()).toHaveAttribute('href', `/kadai/${others.issueId}`);

	await a.page.goto(`${path}/kaku`);
	await hydrated(a.page);
	await expect(a.page.getByRole('group', { name: '元になった解決策' }).getByRole('checkbox', { name: `ほかの課題の解決策2 ${word}` })).toBeChecked();
});

test('基準7・8：制定と関連法の法案が可決すると両方が IF世界に入り、結果のページに法令ごとのリンクが出る。新法のページには新法の条だけが出る', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 6);
	const proposeAt = at(s.month, 5);
	const a = await s.person(proposeAt);
	const target = await ifTarget(a.page, slot(w));
	const newTitle = `可決する新法 ${s.label} 法`;
	const relatedBody = `関連法として可決した本文 ${s.label}`;
	const { ids } = await issueWithSolutions(a.page, `可決 ${s.label}`, [`可決の解決策 ${s.label}`]);
	const res = await billRequest(a.page, '/houan/kaku', {
		kind: 'enact',
		...common(`制定と関連法の可決 ${s.label}`, ids[0]),
		newTitle,
		'op.0': 'add',
		'num.0': '1',
		'caption.0': '（目的）',
		'body.0': `この法律は、${s.label}を守ることを目的とする。`,
		'law.1': IF_LAW,
		'base.1': await baseOf(a.page, IF_LAW),
		'op.1': 'amend',
		'seq.1': '1',
		'target.1': target.num,
		'caption.1': target.caption,
		'body.1': relatedBody
	});
	const path = billPath(res);
	const id = path.replace('/houan/', '');
	for (let i = 0; i < 3; i++) {
		const b = await s.person(proposeAt);
		expect((await billSupportRequest(b.page, path, { op: 'add', rev: '1' })).status()).toBe(200);
	}
	expect((await proposeRequest(a.page, path)).status()).toBe(200);
	for (let i = 0; i < 10; i++) {
		const u = await s.person(at(shift(s.month, -1), 10));
		await postIssue(u.page, { title: `前の月の課題 ${s.label} ${i}` });
		await u.setNow(at(s.month, 22));
		const vote = await billRequest(u.page, `/saiketsu/${id}?/vote`, { choice: 'yes', 'cf-turnstile-response': 'test-pass' });
		expect(vote.status(), await vote.text()).toBe(200);
	}

	const v = await s.person(`${shift(s.month, 1)}-01T09:00:00+09:00`);
	await v.page.goto(`/saiketsu/${id}/kekka`);
	const toNew = v.page.getByRole('link', { name: `IF世界の条文を見る（${newTitle}）` });
	const toRelated = v.page.getByRole('link', { name: `IF世界の条文を見る（${KEIHYO_TITLE}）` });
	await expect(toNew).toHaveAttribute('href', `/if/hourei/if-${id}`);
	await expect(toRelated).toHaveAttribute('href', `/if/hourei/${IF_LAW}`);

	await toNew.click();
	await expect(v.page.getByRole('heading', { level: 1, name: newTitle })).toBeVisible();
	await expect(v.page.getByRole('article', { name: '第1条', exact: true })).toContainText(`${s.label}を守る`);
	await expect(v.page.getByText(relatedBody)).toHaveCount(0);

	await v.page.goto(`/if/hourei/${IF_LAW}`);
	await expect(v.page.getByRole('article', { name: target.label, exact: true })).toContainText(relatedBody);
});

test('基準9：2本の法令の法案の修正案は、タブ、非表示の修正案の欄、運営の画面で「第1条」に法令名が付く', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 7);
	const now = at(s.month, 5);
	const day15 = at(s.month, 15);
	const a = await s.person(now);
	const { ids } = await issueWithSolutions(a.page, `修正案 ${s.label}`, [`修正案の解決策 ${s.label}`]);
	const path = billPath(await billRequest(a.page, '/houan/kaku', await twoLawForm(a.page, `修正案のある法案 ${s.label}`, ids[0])));
	for (let i = 0; i < 3; i++) {
		const b = await s.person(now);
		expect((await billSupportRequest(b.page, path, { op: 'add', rev: '1' })).status()).toBe(200);
	}
	expect((await proposeRequest(a.page, path)).status()).toBe(200);

	const writer = await s.person(day15);
	const body = `2本目の法令への修正案 ${s.label}`;
	const res = await billRequest(writer.page, `${path}/shusei/kaku`, { rev: '1', reason: '', article: '1:1', body, 'cf-turnstile-response': 'test-pass' });
	expect(res.status(), await res.text()).toBe(303);
	await writer.page.goto(`${path}/shusei`);
	const card = writer.page.locator('article').filter({ hasText: body });
	await expect(card.getByRole('heading', { name: `${TOKUSHO_TITLE} 第1条` })).toBeVisible();
	const id = ((await card.getAttribute('id')) as string).replace('shusei-', '');

	const staff = await s.person(day15, { role: 'operator' });
	const hide = await staff.page.request.post('/kanri?/hideAmendment', { form: { amendment: id, reason: 'spam', note: '隠す' }, headers: { origin: ORIGIN, accept: 'text/html' }, maxRedirects: 0 });
	expect(hide.status()).toBeLessThan(400);
	await staff.page.goto(`/kanri?amendment=${id}`);
	await expect(staff.page.getByText(`の修正案（${TOKUSHO_TITLE} 第1条）`)).toBeVisible();

	await writer.page.goto(`${path}/shusei`);
	const hiddenSection = writer.page.getByRole('region', { name: '非表示の修正案' });
	await expect(hiddenSection.getByRole('heading', { name: `${TOKUSHO_TITLE} 第1条` })).toBeVisible();
});

test('信頼の境界：フォームの law.N、base.N、action.N、seq.i の作り変えは 400 で、保存しない', async ({ browser }, info) => {
	const w = info.project.name;
	const s = setup(browser, w, 8);
	const a = await s.person(null);
	const { ids } = await issueWithSolutions(a.page, `境界 ${s.label}`, [`境界の解決策 ${s.label}`]);
	const form = (extra: BillForm) => twoLawForm(a.page, `作り変え ${s.label}`, ids[0], extra);
	/** 送らない欄を除く */
	const without = (f: BillForm, keys: string[]) => Object.fromEntries(Object.entries(f).filter(([k]) => !keys.includes(k)));
	const secondRow = ['op.1', 'seq.1', 'target.1', 'caption.1', 'body.1'];
	const cases: [string, BillForm][] = [
		['委員会の対象でない法令', await form({ 'law.1': '129AC0000000089' })],
		['同じ法令を2つ', await form({ 'law.1': LAW, 'base.1': await baseOf(a.page, LAW) })],
		['番号の飛び', without(await form({ 'law.2': TOKUSHO, 'base.2': await baseOf(a.page, TOKUSHO) }), ['law.1', 'base.1', ...secondRow])],
		['形の違う版の印', await form({ 'base.1': 'abc' })],
		['ほかの法令の版の印', await form({ 'base.1': await baseOf(a.page, LAW) })],
		['改正の法案に廃止', without(await form({ 'action.1': 'repeal' }), secondRow)],
		['ない扱い', await form({ 'action.1': 'enact' })],
		['範囲外の seq', await form({ 'seq.1': '2' })],
		['形の違う seq', await form({ 'seq.1': '1.0' })],
		[
			'6本',
			await form({ 'law.2': '337AC0000000134', 'base.2': await baseOf(a.page, IF_LAW), 'law.3': LAW, 'base.3': await baseOf(a.page, LAW), 'law.4': TOKUSHO, 'base.4': await baseOf(a.page, TOKUSHO), 'law.5': IF_LAW, 'base.5': await baseOf(a.page, IF_LAW) })
		]
	];
	for (const [label, f] of cases) {
		const res = await billRequest(a.page, '/houan/kaku', f);
		expect(res.status(), label).toBe(400);
	}
	// どれも保存していない（作れる3件の上限に1件も数えていない）
	for (let i = 0; i < 3; i++) billPath(await billRequest(a.page, '/houan/kaku', await form({ title: `通る ${i} ${s.label}` })));
});

test('信頼の境界：/houan/kaku/kaiketsu の q は、短い・長い・制御文字なら 200 で理由を返し、ないときは結果なし', async ({ request }) => {
	const get = async (q: string | null) => {
		const res = await request.get(q === null ? '/houan/kaku/kaiketsu' : `/houan/kaku/kaiketsu?q=${encodeURIComponent(q)}`);
		expect(res.status(), String(q)).toBe(200);
		return (await res.json()) as { error?: string; rows?: unknown[] };
	};
	expect((await get('あ')).error).toBe('short');
	expect((await get('あ'.repeat(61))).error).toBe('long');
	expect((await get('ab\u0007cd')).error).toBe('control');
	expect(await get(null)).toEqual({ rows: [], more: false });
	expect(await get('   ')).toEqual({ rows: [], more: false });
});
