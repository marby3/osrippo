// 条文を画面に出すための小さな決まり。DB にも画面にも触れない

/** 時点を指定した条文が取れるのはこの日から。これ以前（当日を含む）で最新の版を起点にする（設計書 docs/spec/8.md 決定5） */
export const BASELINE_DATE = '2017-04-01';

/** e-Gov の Num の並び順：`_` で区切り、左から数値で比べ、同じなら短いほうが先（設計書「num と並び順」） */
export function compareNum(a: string, b: string): number {
	const x = a.split('_').map(Number);
	const y = b.split('_').map(Number);
	for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
	return x.length - y.length;
}

const DIGITS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

function kanji(n: number): string {
	if (n >= 1000) return String(n);
	const h = Math.floor(n / 100);
	const t = Math.floor((n % 100) / 10);
	const o = n % 10;
	return (h ? (h > 1 ? DIGITS[h] : '') + '百' : '') + (t ? (t > 1 ? DIGITS[t] : '') + '十' : '') + DIGITS[o];
}

/** 号の番号 "12_2" → "十二の二" */
export function itemLabel(num: string): string {
	return num.split('_').map((n) => kanji(Number(n))).join('の');
}

/** from（YYYY-MM-DD）から today（YYYY-MM-DD）までの満年数 */
export function fullYears(from: string, today: string): number {
	const years = Number(today.slice(0, 4)) - Number(from.slice(0, 4));
	return today.slice(5) < from.slice(5) ? years - 1 : years;
}
