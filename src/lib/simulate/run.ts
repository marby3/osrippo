// 会期のシミュレーション（Issue #194。#190 の決めたこと4・5、受入基準1・2）。
// bot はテスト用ログインで入り、画面のフォームと同じ送信先を HTTP で呼ぶ。DB には触れない。時刻は x-test-now で進める。
// 筋書き：前の月に課題3件・解決策・「わかる」 → 会期の月に法案2本の起草・賛同・発議 → 質疑と答弁・評価・「考えが変わった」・修正案1本 →
// 採決の週に修正案の票（本案より先に数える）・本案の票・委員長選挙 → 次の月の1日に会期の終わりの処理（Cron の入口）
// 前提：同じサーバーで同じ月を流すのは1回だけ（締めのテストは毎回 db:reset する）。会期の月は実時間より十分先にする
// （テスト用ログインの登録日は実時間から数えるので、近い月だと「登録から7日」や新しいアカウントの判定に当たる）
import { proposalRequirement } from '../domain/bills';
import type { Recorder } from './http';

export type Stance = 'for' | 'undecided' | 'against';

/** 出力の JSON。e2e/phase6.spec.ts の型 Simulated と同じ形 */
export type Simulated = {
	participants: number;
	stances: Record<Stance, number>;
	steps: {
		issues: number;
		solutions: number;
		supports: number;
		billsProposed: number;
		billCosponsors: number;
		questions: number;
		answers: number;
		evaluations: number;
		mindChanged: number;
		amendmentsAdopted: number;
		chairElected: boolean;
		votes: number;
		sessionEnded: boolean;
	};
	http5xx: number;
	passed: { id: string; title: string };
	rejected: { id: string; title: string };
	law: string;
	article: string;
	amended: string;
};

export type SimulateOptions = { origin: string; month: string; label: string; participants: number; log?: (line: string) => void };

/** 法案A（可決させる）が変える条：特定商取引法の第11条。ほかの画面のテストが可決させない法令と条を選ぶ */
const LAW_A = { law: '351AC0000000057', num: '11' };
/** 法案B（否決させる）が変える条：消費者契約法の第3条 */
const LAW_B = { law: '412AC0000000061', num: '3' };
/** 立場の数は決めたこと5（3つに分け、どの区分も10人以上） */
const STANCES: Stance[] = ['for', 'undecided', 'against'];
const MINUTE = 60_000;

const pad = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM を n か月ずらす */
export function shiftMonth(month: string, n: number): string {
	const [y, m] = month.split('-').map(Number);
	const total = y * 12 + (m - 1) + n;
	return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

/** その月の day 日の、日本時間の時刻（ミリ秒）。minutes で分を足す */
const timeOf = (month: string, day: number, minutes = 0) => Date.parse(`${month}-${pad(day)}T09:00:00+09:00`) + minutes * MINUTE;
/** x-test-now の値（日本時間で書く） */
function testNow(ms: number): string {
	const d = new Date(ms + 9 * 60 * MINUTE);
	return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+09:00`;
}

type Reply = { status: number; location: string | null; text: string };

/** 1人の bot。回線（x-test-ip）とログインのクッキーを持ち、「いま」を決めて送る */
class Bot {
	private cookies = new Map<string, string>();
	now = 0;
	constructor(
		private http: Recorder,
		private origin: string,
		readonly index: number,
		readonly name: string,
		readonly ip: string,
		readonly stance: Stance
	) {}

	async send(path: string, form?: Record<string, string>): Promise<Reply> {
		const headers: Record<string, string> = { 'x-test-ip': this.ip, 'x-test-now': testNow(this.now), origin: this.origin, accept: 'text/html' };
		if (this.cookies.size) headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
		if (form) headers['content-type'] = 'application/x-www-form-urlencoded';
		const res = await this.http.request(`${this.origin}${path}`, {
			method: form ? 'POST' : 'GET',
			headers,
			body: form ? new URLSearchParams(form).toString() : undefined,
			redirect: 'manual'
		});
		for (const raw of res.headers.getSetCookie()) {
			const pair = raw.split(';')[0];
			const i = pair.indexOf('=');
			const key = pair.slice(0, i).trim();
			const value = pair.slice(i + 1).trim();
			const expires = /;\s*expires=([^;]+)/i.exec(raw)?.[1];
			if (value === '' || /;\s*max-age=0/i.test(raw) || (expires !== undefined && Date.parse(expires) <= Date.now())) this.cookies.delete(key);
			else this.cookies.set(key, value);
		}
		return { status: res.status, location: res.headers.get('location'), text: await res.text() };
	}

	/**
	 * 送って、受け付けられたことを確かめる。4xx・5xx と、ログインへ送り返されたときは止める（筋書きが崩れたまま進めず、
	 * steps に受け付けていない数を足さない）
	 */
	async ok(what: string, path: string, form?: Record<string, string>): Promise<Reply> {
		const res = await this.send(path, form);
		if (res.status >= 400) throw new Error(`${what}が断られました（${this.name}、${res.status}）：${snippet(res.text)}`);
		if (res.location?.startsWith('/login')) throw new Error(`${what}でログインへ送り返されました（${this.name}）`);
		return res;
	}
}

/** エラーに出す本文の一部（画面のメッセージを拾う） */
function snippet(html: string): string {
	const text = html
		.replace(/<script[\s\S]*?<\/script>/g, '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	return text.slice(0, 300);
}

/** 属性の値。属性の順に頼らない */
const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

/** action がそれになっているフォームごとに、input の name と value を拾う（画面のフォームと同じ値を送るため） */
function formsOf(html: string, action: string): Record<string, string>[] {
	return [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)]
		.filter((m) => attr(/^<form\b[^>]*>/.exec(m[0])?.[0] ?? '', 'action') === action)
		.map((m) => {
			const fields: Record<string, string> = {};
			for (const input of m[0].matchAll(/<input\b[^>]*>/g)) {
				const name = attr(input[0], 'name');
				const value = attr(input[0], 'value');
				if (name !== undefined && value !== undefined) fields[name] = value;
			}
			return fields;
		});
}
const unique = (xs: string[]) => [...new Set(xs)];
/** 名前がタグの中身としてそのまま出ているか（b10-sp-1 と b10-sp-12 を取り違えない） */
const named = (html: string, name: string) => new RegExp(`>\\s*${name}\\s*<`).test(html.replace(/<!--[\s\S]*?-->/g, ''));

const turnstile = { 'cf-turnstile-response': 'test-pass' };

export async function simulate(http: Recorder, opts: SimulateOptions): Promise<Simulated> {
	const log = opts.log ?? (() => {});
	const { origin, month, label } = opts;
	const prev = shiftMonth(month, -1);
	const next = shiftMonth(month, 1);

	// 立場は順に3つへ配る（60人なら20人ずつ）
	const bots = Array.from({ length: opts.participants }, (_, i) => new Bot(http, origin, i, `b${i}-${label}`, `10.150.${Math.floor(i / 250)}.${(i % 250) + 1}`, STANCES[i % 3]));
	const at = (who: Bot[], ms: number) => {
		for (const b of who) b.now = ms;
	};
	/** 時刻をずらしながら1人ずつ送る（同じ票が短い間隔で続くと、票の偏りとして確認に回るため。docs/spec/73.md） */
	const oneByOne = async (who: Bot[], start: number, gapMinutes: number, act: (b: Bot) => Promise<unknown>) => {
		for (const [k, b] of who.entries()) {
			b.now = start + k * gapMinutes * MINUTE;
			await act(b);
		}
	};
	const steps: Simulated['steps'] = {
		issues: 0,
		solutions: 0,
		supports: 0,
		billsProposed: 0,
		billCosponsors: 0,
		questions: 0,
		answers: 0,
		evaluations: 0,
		mindChanged: 0,
		amendmentsAdopted: 0,
		chairElected: false,
		votes: 0,
		sessionEnded: false
	};

	// 0. ログイン（登録は実時間の8日前。会期の月が十分先なので、法案に関わる操作の「登録から7日」を満たす）
	log(`${bots.length}人の bot でログインします`);
	at(bots, timeOf(prev, 10));
	for (const b of bots) await b.ok('テスト用のログイン', `/test-login?name=${b.name}&days=8`);

	// 1. 前の月：課題3件・解決策・「わかる」。全員が何かするので、会期の月の今月の参加者になり、数えた票を入れられる
	log('前の月：課題・解決策・「わかる」');
	const issueIds: string[] = [];
	for (let k = 0; k < 3; k++) {
		const b = bots[k];
		const res = await b.ok('課題', '/kadai/kaku', { title: `シミュレーションの課題${k + 1} ${label}`, affected: '解約できずに困っている人', example: '通信販売の定期購入を解約できない', topic: 'none', ...turnstile });
		const id = /^\/kadai\/(\d+)$/.exec(res.location ?? '')?.[1];
		if (!id) throw new Error(`課題の番号が分かりません：${res.location}`);
		issueIds.push(id);
		steps.issues += 1;
	}
	/** 課題の最初の解決策の番号（法案の元にする） */
	const solutionOf = async (b: Bot, issueId: string, body: string) => {
		await b.ok('解決策', `/kadai/${issueId}/kaiketsu/kaku`, { body, ...turnstile });
		steps.solutions += 1;
		const page = await b.ok('解決策の一覧', `/kadai/${issueId}/kaiketsu`);
		const id = [...page.text.matchAll(/id="kaiketsu-(\d+)"/g)].map((m) => m[1]).at(-1);
		if (!id) throw new Error('解決策の番号が分かりません');
		return id;
	};
	const solutionA = await solutionOf(bots[0], issueIds[0], `通信販売の広告に解約の方法を書かせる ${label}`);
	const solutionB = await solutionOf(bots[1], issueIds[1], `契約の勧誘のときに解約の条件を説明させる ${label}`);
	await solutionOf(bots[2], issueIds[2], `解約の窓口を電話以外にも用意させる ${label}`);
	await oneByOne(bots, timeOf(prev, 11), 1, async (b) => {
		await b.ok('「わかる」', `/kadai/${issueIds[b.index % 3]}?/support`, { op: 'add' });
		steps.supports += 1;
	});

	// 役：前から順に割り当てる。賛同する人は発議要件の数（参加者の5%、最低3人）
	let cursor = 2;
	const take = (n: number) => {
		const picked = bots.slice(cursor, cursor + n);
		cursor += n;
		return picked;
	};
	const [authorA, authorB] = [bots[0], bots[1]];
	const cosponsors = proposalRequirement(bots.length);
	const sideA = [authorA, ...take(cosponsors)];
	const sideB = [authorB, ...take(cosponsors)];
	const askers = take(6);
	const askersB = take(3);
	const evaluators = take(30);
	const [proposer] = take(1);
	const supporters = take(4);
	if (!proposer || supporters.length < 4) throw new Error(`参加者が足りません（${bots.length}人）`);

	// 2. 会期の月の5日：法案2本を起草し、発議要件の数の賛同で発議する
	log('5日：法案2本の起草・賛同・発議');
	at(bots, timeOf(month, 5));
	type Article = { num: string; label: string; caption: string };
	const draft = async (author: Bot, target: { law: string; num: string }, title: string, body: string, solution: string) => {
		const res = await author.ok('条文の読み込み', `/houan/kaku/joubun?law=${target.law}`);
		const { revisionId, articles } = JSON.parse(res.text) as { revisionId: string; articles: Article[] };
		const article = articles.find((a) => a.num === target.num);
		if (!article) throw new Error(`${target.law} に第${target.num}条がありません`);
		const created = await author.ok('法案の下書き', '/houan/kaku', {
			kind: 'amend',
			title,
			law: target.law,
			base: revisionId,
			'op.0': 'amend',
			'target.0': article.num,
			'caption.0': article.caption,
			'body.0': body,
			affected: '解約できずに困っている人',
			sideEffects: '事業者の手間が増える',
			solution,
			...turnstile
		});
		const id = /^\/houan\/(\d+)$/.exec(created.location ?? '')?.[1];
		if (!id) throw new Error(`法案の番号が分かりません：${created.location}`);
		return { id, title, article };
	};
	const billA = await draft(authorA, LAW_A, `シミュレーションの法案A ${label}`, `販売業者は、通信販売の広告に、解約の方法を表示しなければならない（bill-${label}）。`, solutionA);
	const billB = await draft(authorB, LAW_B, `シミュレーションの法案B ${label}`, `事業者は、勧誘のときに、解約の条件を説明しなければならない（bill-${label}）。`, solutionB);
	for (const [bill, side] of [
		[billA, sideA],
		[billB, sideB]
	] as const) {
		for (const b of side.slice(1)) {
			await b.ok('法案の賛同', `/houan/${bill.id}?/support`, { op: 'add', rev: '1' });
			steps.billCosponsors += 1;
		}
		const page = await side[0].ok('法案のページ', `/houan/${bill.id}`);
		const rev = formsOf(page.text, '?/propose')[0]?.rev;
		if (!rev) throw new Error(`発議のフォームがありません（${bill.title}）`);
		await side[0].ok('発議', `/houan/${bill.id}?/propose`, { rev });
		steps.billsProposed += 1;
	}

	// 立場：全員が法案A に自分の立場を付ける（結果の立場別の分布に出る。#87）
	at(bots, timeOf(month, 6));
	for (const b of bots) await b.ok('立場', `/houan/${billA.id}/shitsugi?/stance`, { stance: b.stance });

	// 3. 15日〜：質疑と答弁、評価と「考えが変わった」、修正案
	log('15日〜：質疑・答弁・評価・修正案');
	await oneByOne(askers, timeOf(month, 15), 10, async (b) => {
		await b.ok('質疑', `/houan/${billA.id}/shitsugi/kaku`, { body: `解約の方法は、広告のどこに書けばよいですか（${b.name}）`, ...turnstile });
		steps.questions += 1;
	});
	await oneByOne(askersB, timeOf(month, 15, 120), 10, async (b) => {
		await b.ok('質疑', `/houan/${billB.id}/shitsugi/kaku`, { body: `説明しなかったときはどうなりますか（${b.name}）`, ...turnstile });
		steps.questions += 1;
	});
	for (const [author, bill] of [
		[authorA, billA],
		[authorB, billB]
	] as const) {
		author.now = timeOf(month, 16);
		const page = await author.ok('質疑の一覧', `/houan/${bill.id}/shitsugi`);
		// 答弁の欄はボタンで開くので、質疑の番号はカードの id から読む
		const questions = unique([...page.text.matchAll(/<article id="shitsugi-(\d+)"/g)].map((m) => m[1]));
		if (questions.length === 0) throw new Error('答弁する質疑がありません');
		for (const [k, question] of questions.entries()) {
			author.now = timeOf(month, 16, k * 10);
			await author.ok('答弁', `/houan/${bill.id}/shitsugi?/answer`, { question, body: `広告の申込みの画面の近くに書きます（${k + 1}）`, ...turnstile });
			steps.answers += 1;
		}
	}
	// 答弁を読んだ人が評価する。立場が「未定」の人は「考えが変わった」も付ける
	await oneByOne(evaluators, timeOf(month, 17), 7, async (b) => {
		const page = await b.ok('質疑の一覧', `/houan/${billA.id}/shitsugi`);
		const buttons = formsOf(page.text, '?/evaluate');
		const post = buttons.find((x) => x.kind === 'reasonable')?.post;
		if (!post) throw new Error('評価できる投稿がありません');
		await b.ok('評価', `/houan/${billA.id}/shitsugi?/evaluate`, { post, kind: 'reasonable', op: 'add' });
		steps.evaluations += 1;
		if (b.stance === 'undecided' && buttons.some((x) => x.post === post && x.kind === 'changed')) {
			await b.ok('「考えが変わった」', `/houan/${billA.id}/shitsugi?/evaluate`, { post, kind: 'changed', op: 'add' });
			steps.mindChanged += 1;
		}
	});

	// 修正案：法案A の同じ条を書きかえる。賛同が要件（発議要件の半分）に届くと、本案より先に採決する
	const amended = `amend-${label}`;
	proposer.now = timeOf(month, 18);
	const form = await proposer.ok('修正案の画面', `/houan/${billA.id}/shusei/kaku`);
	const billRev = attr(/<input\b[^>]*name="rev"[^>]*>/.exec(form.text)?.[0] ?? '', 'value');
	if (!billRev) throw new Error('修正案の画面に法案の版がありません');
	await proposer.ok('修正案', `/houan/${billA.id}/shusei/kaku`, {
		article: `0:${billA.article.num}`,
		body: `販売業者は、通信販売の広告に、解約の方法を分かりやすく表示しなければならない（${amended}）。`,
		reason: '「分かりやすく」を足す',
		rev: billRev,
		...turnstile
	});
	// 番号と版は、賛同する人の画面の賛同のフォームから読む（出した本人には賛同のフォームが出ない）
	supporters[0].now = timeOf(month, 18, 10);
	const amendmentPage = await supporters[0].ok('修正案の一覧', `/houan/${billA.id}/shusei`);
	const { amendment, revision } = formsOf(amendmentPage.text, '?/support')[0] ?? {};
	if (!amendment || !revision) throw new Error('修正案の番号が分かりません');
	await oneByOne(supporters, timeOf(month, 18, 30), 10, (b) => b.ok('修正案の賛同', `/houan/${billA.id}/shusei?/support`, { amendment, revision, op: 'add' }));

	// 4. 22日〜：採決の週。委員長選挙の立候補（質疑を書いた人）、修正案の票、本案の票、委員長の票
	log('22日〜：委員長選挙・修正案の票・本案の票');
	const candidate = askers[0];
	candidate.now = timeOf(month, 22);
	await candidate.ok('立候補', '/iinkai?/stand', turnstile);

	const votersA = bots.filter((b) => !sideA.includes(b));
	const votersB = bots.filter((b) => !sideB.includes(b));
	// 修正案：賛成。法案A：賛成寄りと未定は賛成、反対寄りは反対 → 可決。法案B：賛成寄りと未定は反対、反対寄りは賛成 → 否決
	await oneByOne(votersA, timeOf(month, 22, 60), 3, async (b) => {
		await b.ok('修正案の票', `/houan/${billA.id}/shusei?/vote`, { amendment, choice: 'yes', ...turnstile });
	});
	await oneByOne(votersA, timeOf(month, 23), 3, async (b) => {
		await b.ok('本案の票', `/saiketsu/${billA.id}?/vote`, { choice: b.stance === 'against' ? 'no' : 'yes', ...turnstile });
		steps.votes += 1;
	});
	await oneByOne(votersB, timeOf(month, 24), 3, async (b) => {
		await b.ok('本案の票', `/saiketsu/${billB.id}?/vote`, { choice: b.stance === 'against' ? 'yes' : 'no', ...turnstile });
		steps.votes += 1;
	});
	// 候補の順は読むたびに混ぜられるので、立候補した bot の名前の付いた選択肢を選ぶ
	const electors = evaluators.slice(0, 20);
	electors[0].now = timeOf(month, 25);
	const electionPage = await electors[0].ok('委員会のページ', '/iinkai');
	const candidateId = [...electionPage.text.matchAll(/<input\b[^>]*name="candidate"[^>]*>([\s\S]*?)<\/label>/g)].find((m) => named(m[0], candidate.name))?.[0];
	const candidateValue = candidateId ? attr(candidateId, 'value') : undefined;
	if (!candidateValue) throw new Error('委員長選挙の候補に、立候補した bot がいません');
	await oneByOne(electors, timeOf(month, 25), 5, (b) => b.ok('委員長の票', '/iinkai?/vote', { candidate: candidateValue, ...turnstile }));

	// 5. 次の月の1日：会期の終わりの処理（Cron の入口。preview:test だけにある）
	log('次の月の1日：会期の終わりの処理');
	const cron = await http.request(`${origin}/cdn-cgi/handler/scheduled?cron=1+15+*+*+*&time=${timeOf(next, 1) - 9 * 60 * MINUTE + 2 * MINUTE}`);
	await cron.text();
	steps.sessionEnded = cron.status === 200;

	// 結果を読む：修正案が可決して本案に当たったか、委員長が決まったか
	const reader = bots[0];
	reader.now = timeOf(next, 1, 60);
	const settled = await reader.ok('修正案の一覧', `/houan/${billA.id}/shusei`);
	steps.amendmentsAdopted = [...settled.text.matchAll(/<p class="status[^"]*">可決<\/p>/g)].length;
	const committee = await reader.ok('委員会のページ', '/iinkai');
	steps.chairElected = named(committee.text, candidate.name) && !committee.text.includes('今月は委員長がいません');

	return {
		participants: bots.length,
		stances: { for: bots.filter((b) => b.stance === 'for').length, undecided: bots.filter((b) => b.stance === 'undecided').length, against: bots.filter((b) => b.stance === 'against').length },
		steps,
		http5xx: http.http5xx(),
		passed: { id: billA.id, title: billA.title },
		rejected: { id: billB.id, title: billB.title },
		law: LAW_A.law,
		article: billA.article.label,
		amended
	};
}
