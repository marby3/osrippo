// 画面のテストで使う手順（Issue #25）
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

export const ORIGIN = 'http://localhost:4173';

/**
 * Turnstile の api.js を差し替える（テストから外部の API を呼ばない。設計書 docs/spec/25.md 決めたこと8）。
 * 本物と同じく、render した場所に cf-turnstile-response を入れ、callback にトークンを渡す
 */
export async function stubTurnstile(page: Page, token = 'test-pass') {
	await page.route(/^https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js/, (route) =>
		route.fulfill({
			contentType: 'text/javascript',
			body: `(() => {
				const token = ${JSON.stringify(token)};
				let issue = () => {};
				window.turnstile = {
					render(el, opts) {
						const input = document.createElement('input');
						input.type = 'hidden';
						input.name = 'cf-turnstile-response';
						el.appendChild(input);
						issue = () => setTimeout(() => {
							input.value = token;
							opts.callback && opts.callback(token);
						});
						issue();
						return 'stub';
					},
					// 本物と同じく、作り直すと新しいトークンを callback に渡す
					reset() {
						issue();
					},
					remove() {}
				};
			})();`
		})
	);
}

/** 回線（IP）と国を決めた、新しいブラウザのコンテキスト（レート制限の数えがテストどうしで混ざらないように） */
export async function newUser(
	browser: Browser,
	{
		name,
		ip,
		days = 2,
		country,
		token,
		role
	}: { name?: string; ip: string; days?: number; country?: string; token?: string; role?: 'moderator' | 'operator' }
): Promise<{ context: BrowserContext; page: Page }> {
	const context = await browser.newContext({
		baseURL: ORIGIN,
		extraHTTPHeaders: { 'x-test-ip': ip, ...(country ? { 'x-test-country': country } : {}) }
	});
	const page = await context.newPage();
	await stubTurnstile(page, token);
	if (name) await loginAs(page, name, days, role);
	return { context, page };
}

/** テスト用のログイン。days は登録した日を何日前にするか（新しいアカウントの制限を避ける）。role は運営・運営協力者 */
export async function loginAs(page: Page, name: string, days = 2, role?: 'moderator' | 'operator') {
	await page.goto(`/test-login?name=${encodeURIComponent(name)}&days=${days}${role ? `&role=${role}` : ''}`);
	await expect(page.getByText(`テスト用のログイン：${name}`)).toBeVisible();
}

export type IssueFields = { title: string; affected?: string; example?: string; topic?: string; token?: string };

/** 課題を書くフォームと同じ POST を送る（リダイレクトは追わない） */
export function postIssueRequest(page: Page, f: IssueFields) {
	return page.request.post('/kadai/kaku', {
		form: {
			title: f.title,
			affected: f.affected ?? '困っている人',
			example: f.example ?? '具体例',
			topic: f.topic ?? '1',
			'cf-turnstile-response': f.token ?? 'test-pass'
		},
		headers: { origin: ORIGIN, accept: 'text/html' },
		maxRedirects: 0
	});
}

/** 課題を書いて、その id を返す */
export async function postIssue(page: Page, f: IssueFields): Promise<number> {
	const res = await postIssueRequest(page, f);
	expect(res.status(), await res.text()).toBe(303);
	const id = Number(/^\/kadai\/(\d+)$/.exec(res.headers()['location'] ?? '')?.[1]);
	expect(id).toBeGreaterThan(0);
	return id;
}

/** 「わかる」のフォームと同じ POST */
export function supportRequest(page: Page, id: number | string, op: string | undefined) {
	return page.request.post(`/kadai/${id}?/support`, {
		form: op === undefined ? {} : { op },
		headers: { origin: ORIGIN, accept: 'text/html' },
		maxRedirects: 0
	});
}

/** 通報のフォームと同じ POST */
export function reportRequest(page: Page, id: number | string, form: Record<string, string> = {}) {
	return page.request.post(`/kadai/${id}?/report`, {
		form,
		headers: { origin: ORIGIN, accept: 'text/html' },
		maxRedirects: 0
	});
}

/** 運営の画面の操作と同じ POST */
export function staffRequest(page: Page, action: 'hide' | 'restore' | 'merge', form: Record<string, string>) {
	return page.request.post(`/kanri?/${action}`, {
		form,
		headers: { origin: ORIGIN, accept: 'text/html' },
		maxRedirects: 0
	});
}

/** 似た課題を探す（課題を書く画面と同じ POST） */
export function similarRequest(page: Page, body: unknown, raw = false) {
	return page.request.post('/kadai/nita', {
		data: raw ? (body as string) : JSON.stringify(body),
		headers: { origin: ORIGIN, 'content-type': 'application/json' }
	});
}

/** 解決策を書くフォームと同じ POST（リダイレクトは追わない） */
export function solutionRequest(page: Page, issueId: number | string, body: string, token = 'test-pass') {
	return page.request.post(`/kadai/${issueId}/kaiketsu/kaku`, {
		form: { body, 'cf-turnstile-response': token },
		headers: { origin: ORIGIN, accept: 'text/html' },
		maxRedirects: 0
	});
}

/** 解決策の「わかる」「考えが変わった」のフォームと同じ POST */
export function reactRequest(page: Page, issueId: number | string, form: Record<string, string>) {
	return page.request.post(`/kadai/${issueId}?/react`, {
		form,
		headers: { origin: ORIGIN, accept: 'text/html' },
		maxRedirects: 0
	});
}

/** 解決策の通報のフォームと同じ POST */
export function reportSolutionRequest(page: Page, issueId: number | string, form: Record<string, string>) {
	return page.request.post(`/kadai/${issueId}?/reportSolution`, {
		form,
		headers: { origin: ORIGIN, accept: 'text/html' },
		maxRedirects: 0
	});
}

/** 運営の画面の、解決策の操作と同じ POST */
export function solutionStaffRequest(page: Page, action: 'hideSolution' | 'restoreSolution', form: Record<string, string>) {
	return page.request.post(`/kanri?/${action}`, {
		form,
		headers: { origin: ORIGIN, accept: 'text/html' },
		maxRedirects: 0
	});
}

/** 全体を探すページ */
export const searchUrl = (q: string, extra = '') => `/kensaku?q=${encodeURIComponent(q)}${extra}`;

/** 課題と解決策を書き、課題と解決策の番号を返す */
export async function issueWithSolutions(page: Page, label: string, bodies: string[]) {
	const issueId = await postIssue(page, { title: `法案の元の課題 ${label}` });
	for (const body of bodies) {
		const res = await solutionRequest(page, issueId, body);
		expect(res.status(), await res.text()).toBe(303);
	}
	await page.goto(`/kadai/${issueId}/kaiketsu`);
	const ids: string[] = [];
	for (const body of bodies) {
		const id = await page.locator('article').filter({ hasText: body }).getAttribute('id');
		expect(id).toMatch(/^kaiketsu-\d+$/);
		ids.push((id as string).replace('kaiketsu-', ''));
	}
	return { issueId, ids };
}

export type BillForm = Record<string, string | string[]>;

/** 法案を書くフォームと同じ POST（リダイレクトは追わない）。配列の値は同じ名前で並べる */
export function billRequest(page: Page, path: string, form: BillForm) {
	const body = new URLSearchParams();
	for (const [k, v] of Object.entries(form)) for (const x of Array.isArray(v) ? v : [v]) body.append(k, x);
	return page.request.post(path, {
		data: body.toString(),
		headers: { origin: ORIGIN, accept: 'text/html', 'content-type': 'application/x-www-form-urlencoded' },
		maxRedirects: 0
	});
}

/** 法案のページのパス（作ったときのリダイレクト先） */
export function billPath(res: { status(): number; headers(): Record<string, string> }) {
	expect(res.status()).toBe(303);
	const path = res.headers()['location'] ?? '';
	expect(path).toMatch(/^\/houan\/\d+$/);
	return path;
}

/**
 * 可決するテストが使う法令（景品表示法）。IF世界はテストのあいだで共有するので、ほかのテストの条文を変えないように、
 * 可決するテストはこの法令の、テストと幅ごとに別の条を使う（ifTarget）
 */
export const IF_LAW = '337AC0000000134';
export type IfTarget = { law: string; num: string; caption: string; label: string };

/** IF_LAW の n 番目の条（削除された条を除く）。条を足すテストがないので、順は変わらない */
export async function ifTarget(page: Page, n: number): Promise<IfTarget> {
	const { articles } = (await (await page.request.get(`/houan/kaku/joubun?law=${IF_LAW}`)).json()) as { articles: { num: string; label: string; caption: string; body: string }[] };
	const usable = articles.filter((a) => a.body !== '削除');
	expect(usable.length, 'IF_LAW の条の数').toBeGreaterThan(n);
	const a = usable[n];
	return { law: IF_LAW, num: a.num, caption: a.caption, label: a.label };
}

/**
 * 改正の下書きを作り、法案のページのパスを返す。target を省くと消費者契約法の第1条を書きかえる。
 * IF世界が変わると印が古くなるので、断られたら読み直す（ほかのテストの可決と重なったとき）
 */
export async function createAmendBill(page: Page, title: string, solution: string, extra: BillForm = {}, target?: IfTarget) {
	const law = target?.law ?? '412AC0000000061';
	const post = async () => {
		const { revisionId } = (await (await page.request.get(`/houan/kaku/joubun?law=${law}`)).json()) as { revisionId: string };
		return billRequest(page, '/houan/kaku', {
			kind: 'amend',
			title,
			law,
			base: revisionId,
			'op.0': 'amend',
			'target.0': target?.num ?? '1',
			'caption.0': target?.caption ?? '（目的）',
			'body.0': 'この法律は、消費者がいつでも契約をやめられるようにすることを目的とする。',
			affected: '解約できずに困っている人',
			sideEffects: '事業者の負担が増える',
			solution,
			'cf-turnstile-response': 'test-pass',
			...extra
		});
	};
	const first = await post();
	return billPath(first.status() === 409 ? await post() : first);
}

/** 賛同のフォームと同じ POST */
export const billSupportRequest = (page: Page, bill: string, form: BillForm) => billRequest(page, `${bill}?/support`, form);

/** 「発議する」のフォームと同じ POST */
export const proposeRequest = (page: Page, bill: string) => billRequest(page, `${bill}?/propose`, {});
