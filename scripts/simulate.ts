// 会期のシミュレーションの入口（Issue #194。#190 の決めたこと4・5）。テスト用ログインのあるサーバー（pnpm preview:test）に対して動かす。
//   pnpm simulate --origin http://localhost:4173 --month 2037-04 --label sp-1 --participants 60
// 進み具合は標準エラーに書き、標準出力の最後の1行に結果の JSON を1つだけ書く。5xx が1件でも返ったか、途中で断られたら終了コード1
import { parseArgs } from 'node:util';
import { createRecorder } from '../src/lib/simulate/http';
import { simulate } from '../src/lib/simulate/run';

const { values } = parseArgs({
	options: { origin: { type: 'string' }, month: { type: 'string' }, label: { type: 'string' }, participants: { type: 'string', default: '60' } }
});
const participants = Number(values.participants);
const origin = (() => {
	try {
		return new URL(values.origin ?? '').origin;
	} catch {
		return null;
	}
})();
const month = values.month ?? '';
const label = values.label ?? '';
// 役の割り当てが収まり、どの立場も10人以上になる範囲（src/lib/simulate/run.ts）
const valid = origin !== null && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && /^[A-Za-z0-9-]{1,20}$/.test(label) && Number.isInteger(participants) && participants >= 60 && participants <= 100;
if (!valid) {
	console.error('使い方：pnpm simulate --origin <preview:test の URL> --month YYYY-MM --label <英数字とハイフン20字まで> [--participants 60〜100]');
	process.exit(2);
}
// 登録日は実時間から数えるので、会期の月が十分先でないと「登録から7日」や新しいアカウントの判定（会期の30日前より後の登録）に当たる
if (Date.parse(`${month}-01T00:00:00+09:00`) < Date.now() + 90 * 24 * 60 * 60 * 1000) {
	console.error('--month は、いまより3か月以上先の月にしてください（bot の登録日は実時間から数えるため）');
	process.exit(2);
}

const http = createRecorder(fetch);
try {
	const result = await simulate(http, { origin, month, label, participants, log: (line) => console.error(line) });
	if (result.http5xx > 0) console.error(`5xx が ${result.http5xx} 件返りました`);
	console.log(JSON.stringify(result));
	process.exitCode = http.exitCode();
} catch (e) {
	console.error(e);
	if (http.http5xx() > 0) console.error(`5xx が ${http.http5xx()} 件返りました`);
	process.exitCode = 1;
}
