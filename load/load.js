// 負荷試験（Issue #201。#190 決めたこと6、#198 の「負荷試験」）。k6 で、ログインしないで見る7つの画面を読む。
// 直接は流さず、pnpm test:load（scripts/load-test.ts）から Docker の grafana/k6 で流す。手順と結果は docs/load-test.md
//   BASE_URL     向ける先（例：https://osrippo-staging.….workers.dev）
//   VUS          同時に読む人の数（既定 100）。1人ずつ、1〜5秒の間をあけて画面を1つずつ読む
//   DURATION     流す時間（既定 5m）
//   PAGE         1つの画面だけを読む（画面ごとの D1 の読んだ行数を測るとき）。名前は pages.json
//   SUMMARY_FILE 要約の JSON を書く先
// 合否は thresholds で決める（k6 は満たさないと終了コード 99）：5xx 0件、p95 1秒以内、CPU の制限で落ちた応答 0件。
// 応答のなかったもの（つながらない）と、200 でも 5xx でもない応答（404・403 など）も 0件を条件にする
// （向ける先が落ちていたり、画面がなかったり断られたりしても合格にならないように）
import http from 'k6/http';
import { sleep } from 'k6';
import { Counter } from 'k6/metrics';

const BASE = (__ENV.BASE_URL || '').replace(/\/+$/, '');
if (!/^https?:\/\//.test(BASE)) throw new Error('BASE_URL がありません');
const VUS = Number(__ENV.VUS || 100);
const DURATION = __ENV.DURATION || '5m';
const SUMMARY_FILE = __ENV.SUMMARY_FILE || '/scripts/out/summary.json';

/** @type {{ name: string; path: string; weight?: number }[]} */
const ALL = JSON.parse(open('./pages.json'));
const PAGES = __ENV.PAGE ? ALL.filter((p) => p.name === __ENV.PAGE) : ALL;
if (PAGES.length === 0) throw new Error(`知らない画面です：${__ENV.PAGE}`);
const TOTAL_WEIGHT = PAGES.reduce((n, p) => n + (p.weight ?? 1), 0);

/** 5xx の応答 */
const server5xx = new Counter('server_5xx');
/** Workers の CPU などの制限で落ちた応答（Error 1102「Worker exceeded resource limits」）。確定は試験のあとで GraphQL の exceededResources を見る */
const cpuExceeded = new Counter('cpu_exceeded');
/** 応答がなかったもの（つながらない、時間切れ） */
const noResponse = new Counter('no_response');
/** 200 でも 5xx でもない応答（404・403 やリダイレクトの先が 200 でないもの） */
const otherStatus = new Counter('other_status');

const thresholds = {
	server_5xx: ['count<1'],
	http_req_duration: ['p(95)<1000'],
	cpu_exceeded: ['count<1'],
	no_response: ['count<1'],
	other_status: ['count<1']
};
// 画面ごとの値を要約に出すため（いつも満たす条件で、合否には効かない）
for (const p of PAGES) {
	thresholds[`http_req_duration{page:${p.name}}`] = ['max>=0'];
	thresholds[`http_reqs{page:${p.name}}`] = ['count>=0'];
}

export const options = {
	scenarios: { readers: { executor: 'constant-vus', vus: VUS, duration: DURATION } },
	thresholds,
	summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
	userAgent: 'osrippo-load-test (k6)'
};

function pick() {
	let r = Math.random() * TOTAL_WEIGHT;
	for (const p of PAGES) {
		r -= p.weight ?? 1;
		if (r < 0) return p;
	}
	return PAGES[PAGES.length - 1];
}

export default function () {
	const page = pick();
	const tags = { page: page.name };
	const res = http.get(`${BASE}${page.path}`, { tags });
	if (res.status === 0) noResponse.add(1, tags);
	else if (res.status >= 500) server5xx.add(1, tags);
	else if (res.status !== 200) otherStatus.add(1, tags);
	const body = typeof res.body === 'string' ? res.body : '';
	if (body.includes('Error 1102') || body.includes('exceeded resource limits')) cpuExceeded.add(1, tags);
	sleep(1 + Math.random() * 4);
}

const ms = (v) => (v === undefined ? '-' : `${Math.round(v)}ms`);
const count = (data, name) => data.metrics[name]?.values.count ?? 0;

/** 要約：JSON をファイルに書き、標準出力に合否と画面ごとの数を出す */
export function handleSummary(data) {
	const lines = [];
	let passed = true;
	for (const name of ['server_5xx', 'http_req_duration', 'cpu_exceeded', 'no_response', 'other_status']) {
		const m = data.metrics[name];
		const ok = Object.values(m?.thresholds ?? {}).every((t) => t.ok);
		passed &&= ok;
		const value = name === 'http_req_duration' ? `p95 ${ms(m?.values['p(95)'])}` : `${count(data, name)}件`;
		lines.push(`${ok ? '合格' : '不合格'}  ${name}: ${value}（${Object.keys(m?.thresholds ?? { 'count<1': 0 }).join(', ')}）`);
	}
	lines.push(`読んだ回数 ${count(data, 'http_reqs')}`);
	lines.push('画面ごと：');
	for (const p of PAGES) {
		const d = data.metrics[`http_req_duration{page:${p.name}}`]?.values ?? {};
		lines.push(`  ${p.name.padEnd(18)} ${String(count(data, `http_reqs{page:${p.name}}`)).padStart(6)}回  p95 ${ms(d['p(95)']).padStart(7)}  max ${ms(d.max).padStart(7)}`);
	}
	lines.push(passed ? '結果：合格' : '結果：不合格');
	return { [SUMMARY_FILE]: JSON.stringify(data, null, 2), stdout: lines.join('\n') + '\n' };
}
