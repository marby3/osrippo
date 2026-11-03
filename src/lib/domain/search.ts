// 全文検索のそろえ方と言葉の判定（設計書 docs/spec/38.md 決めたこと1・2・6）。本文と検索の言葉で同じ規則を使う
import { CONTROL } from './issues';

/** NFKC にそろえ、英字を小文字にし、句読点・記号と空白（改行を含む）を除く */
export const normalizeText = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]/gu, '');

/** となり合う2文字の組（そろえたあとの文字列から作る。重なってもそのまま並べる） */
export function bigrams(normalized: string): string[] {
	const chars = [...normalized];
	const pairs: string[] = [];
	for (let i = 0; i + 1 < chars.length; i++) pairs.push(chars[i] + chars[i + 1]);
	return pairs;
}

/** 検索の表の行の text：trigram はそろえた文字列、bigram はそろえた文字列の組を空白でつないだもの */
export function searchTexts(source: string): { trigram: string; bigram: string } | null {
	const normalized = normalizeText(source);
	if (!normalized) return null;
	return { trigram: normalized, bigram: bigrams(normalized).join(' ') };
}

export const QUERY_MAX = 60;
export const WORDS_MAX = 5;

export type Word = { raw: string; norm: string };
export type QueryResult = { ok: true; words: Word[] } | { ok: false; error: 'short' | 'long' | 'control' };

/** 検索の言葉（信頼の境界）。空なら探さない。空白（全角を含む）で言葉に分ける */
export function parseQuery(raw: string | null): QueryResult {
	const q = (raw ?? '').trim();
	if (!q) return { ok: true, words: [] };
	if (CONTROL.test(q)) return { ok: false, error: 'control' };
	const parts = q.split(/\s+/u);
	if ([...q].length > QUERY_MAX || parts.length > WORDS_MAX) return { ok: false, error: 'long' };
	const words = parts.map((w) => ({ raw: w, norm: normalizeText(w) }));
	if (words.some((w) => [...w.norm].length < 2)) return { ok: false, error: 'short' };
	// NFKC で長くなる文字があるので、そろえたあとの全体にも同じ上限をかける
	if (words.reduce((n, w) => n + [...w.norm].length, 0) > QUERY_MAX) return { ok: false, error: 'long' };
	return { ok: true, words };
}

/** MATCH に渡す言葉：" で囲み、中の " は2つ重ねる（値はバインド変数で渡す） */
export const matchPhrase = (s: string) => `"${s.replaceAll('"', '""')}"`;

export type Part = { text: string; mark: boolean };

const BEFORE = 20;
const AFTER = 60;
const HEAD = 80;

/**
 * 該当部分：元の文から、最初の言葉が最初に出るところ（英字の大文字・小文字は区別しない）の前後を切り出す。
 * 見つからなければ頭から80字。切り出した中で、どの言葉でも当たる部分に印を付ける
 */
export function snippet(text: string, words: Word[]): Part[] {
	const chars = [...text];
	const lower = (s: string) => s.toLowerCase();
	const find = (needle: string, from = 0) => {
		const haystack = lower(chars.slice(from).join(''));
		const at = haystack.indexOf(lower(needle));
		return at < 0 ? -1 : from + [...haystack.slice(0, at)].length;
	};
	const first = words.length ? find(words[0].raw) : -1;
	let start = 0;
	let end = Math.min(chars.length, HEAD);
	if (first >= 0) {
		start = Math.max(0, first - BEFORE);
		end = Math.min(chars.length, first + [...words[0].raw].length + AFTER);
	}
	const cut = chars.slice(start, end);
	// 当たる部分を探して印を付ける
	const marks = new Array<boolean>(cut.length).fill(false);
	const cutLower = cut.map(lower);
	for (const w of words) {
		const needle = [...lower(w.raw)];
		if (!needle.length) continue;
		for (let i = 0; i + needle.length <= cutLower.length; i++) {
			if (needle.every((c, j) => cutLower[i + j] === c)) for (let j = 0; j < needle.length; j++) marks[i + j] = true;
		}
	}
	const parts: Part[] = [];
	if (start > 0) parts.push({ text: '…', mark: false });
	for (let i = 0; i < cut.length; i++) {
		const last = parts[parts.length - 1];
		if (last && last.mark === marks[i] && !(i === 0 && start > 0)) last.text += cut[i];
		else parts.push({ text: cut[i], mark: marks[i] });
	}
	if (end < chars.length) parts.push({ text: '…', mark: false });
	return parts;
}
