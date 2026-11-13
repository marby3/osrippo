// 法律の一覧と検索の URL と表示の決まり（Issue #163）。DB にも画面にも触れない
import { CONTROL, parsePage } from './issues';
import { fullYears } from './law/display';

/** 1ページの件数（課題の一覧と同じ） */
export const LAW_LIST_PAGE = 50;

/** 並び。kana（五十音）が既定で、URL に narabi を付けない。kaisei＝最近の改正、nagai＝長く変わっていない */
export const LAW_SORTS = ['kana', 'kaisei', 'nagai'] as const;
export type LawSort = (typeof LAW_SORTS)[number];

/** 五十音の索引。title_kana の先頭の文字が from 以上 to 未満（ひらがなの並び。濁音・半濁音・小書きは同じ行に入る） */
export const KANA_ROWS = [
	{ key: 'a', label: 'あ', from: 'ぁ', to: 'か' },
	{ key: 'ka', label: 'か', from: 'か', to: 'さ' },
	{ key: 'sa', label: 'さ', from: 'さ', to: 'た' },
	{ key: 'ta', label: 'た', from: 'た', to: 'な' },
	{ key: 'na', label: 'な', from: 'な', to: 'は' },
	{ key: 'ha', label: 'は', from: 'は', to: 'ま' },
	{ key: 'ma', label: 'ま', from: 'ま', to: 'ゃ' },
	{ key: 'ya', label: 'や', from: 'ゃ', to: 'ら' },
	{ key: 'ra', label: 'ら', from: 'ら', to: 'ゎ' },
	// わ・を・ん と、ひらがなの外の文字（ゔ など）
	{ key: 'wa', label: 'わ', from: 'ゎ', to: '゠' }
] as const;
export type KanaKey = (typeof KANA_ROWS)[number]['key'];

/** 分野の名前の長さの上限（e-Gov の分類は「外国為替・貿易」などの短い言葉） */
const CATEGORY_MAX = 20;

/** 一覧の検索文字列。bunya は分野の名前（DB にある分野かは読むときに確かめる）。q は言葉のまま（判定は parseQuery） */
export type LawListQuery = { q: string; bunya: string | null; narabi: LawSort; kana: KanaKey | null; page: number };

/** 一覧の検索文字列。形が違えば null（404）。既定の値（五十音、1ページ目）は URL に書かないものだけ */
export function parseLawListQuery(params: URLSearchParams): LawListQuery | null {
	const narabi = params.get('narabi');
	const kana = params.get('kana');
	const bunya = params.get('bunya');
	if (narabi !== null && narabi !== 'kaisei' && narabi !== 'nagai') return null;
	const row = kana === null ? null : KANA_ROWS.find((r) => r.key === kana);
	if (row === undefined) return null;
	if (bunya !== null && (!bunya || [...bunya].length > CATEGORY_MAX || CONTROL.test(bunya))) return null;
	const page = parsePage(params.get('page'));
	if (page === null) return null;
	return { q: params.get('q') ?? '', bunya, narabi: narabi ?? 'kana', kana: row?.key ?? null, page };
}

/** 一覧の URL（既定の値は書かない） */
export function lawListHref({ q, bunya, narabi, kana, page }: LawListQuery): string {
	const params = new URLSearchParams();
	if (q.trim()) params.set('q', q);
	if (bunya) params.set('bunya', bunya);
	if (narabi !== 'kana') params.set('narabi', narabi);
	if (kana) params.set('kana', kana);
	if (page > 1) params.set('page', String(page));
	const search = params.toString();
	return search ? `/hourei?${search}` : '/hourei';
}

const KANJI_DIGITS = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const KANJI_VALUE: Record<string, number> = { 〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const KANJI_UNIT: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };

/** 9999 までの数を、法令番号の書き方の漢数字にする（134 → 百三十四、2000 → 二千） */
export function kanjiNumeral(n: number): string {
	if (n === 0) return '〇';
	let out = '';
	for (const [unit, label] of [
		[1000, '千'],
		[100, '百'],
		[10, '十']
	] as const) {
		const d = Math.floor(n / unit) % 10;
		if (d) out += (d > 1 ? KANJI_DIGITS[d] : '') + label;
	}
	const o = n % 10;
	return o ? out + KANJI_DIGITS[o] : out;
}

/** 漢数字の並び（十・百・千の位取り）を数にする。「八十九」→ 89 */
function kanjiToNumber(s: string): number {
	let total = 0;
	let digit = 0;
	for (const ch of s) {
		if (ch in KANJI_VALUE) digit = KANJI_VALUE[ch];
		else {
			total += (digit || 1) * KANJI_UNIT[ch];
			digit = 0;
		}
	}
	return total + digit;
}

/** 法令番号を算用数字で見せる（「明治二十九年法律第八十九号」→「明治29年法律第89号」。元年はそのまま） */
export const lawNumDisplay = (lawNum: string) => lawNum.replace(/[〇一二三四五六七八九十百千]+/g, (s) => String(kanjiToNumber(s)));

/** 検索の言葉の算用数字を、法令番号の書き方の漢数字にする（そろえたあとの言葉。「明治29年」→「明治二十九年」） */
export const lawNumWord = (norm: string) => norm.replace(/\d{1,4}/g, (s) => kanjiNumeral(Number(s)));

/** カタカナをひらがなにする（読みの検索。e-Gov の読みはひらがな） */
export const toHiragana = (s: string) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

/** 「N年変わっていない」のタグを出す年数（画面の案 SpLaws・PcLaws では、9年の法律に出さず、15年の法律に出している） */
export const UNCHANGED_TAG_YEARS = 10;

/** 最後の改正から today までの満年数。改正日がない（制定から改正なし）か、タグを出す年数に足りなければ null */
export function unchangedYears(lastAmended: string | null, today: string): number | null {
	if (!lastAmended) return null;
	const years = fullYears(lastAmended, today);
	return years >= UNCHANGED_TAG_YEARS ? years : null;
}
