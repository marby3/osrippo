// 本文の「特商法9条」を条へのリンクにする（Issue #165。決めたことは Issue #198 の「#165」の節）。DB にも画面にも触れない。
// 本文は利用者の入力（信頼の境界）なので、HTML は組まず、文字とリンクの並びを返す。画面は並びを区切って描く（{@html} は使わない）。
//
// 流れ：
// 1. lawRefNames：本文から「〇〇第N条」の形を探し、条の番号の直前の文字の並び（句読点・空白・括弧で区切る）の末尾を、名前の候補にする
// 2. サーバーは候補の名前だけを DB で引き（正式名と e-Gov の略称）、引けた法律の条があるかを確かめる
// 3. lawRefIndex：引けた名前に aliases.ts の通称を足し、ほかの法律とぶつかる名前を外す
// 4. linkLawRefs：本文を文字とリンクの並びにする。名前は長い順に試し、最初に当たった名前だけを使う（ぶつかる・条がないならリンクにしない）
import { LAW_ALIASES } from './aliases';

/** 文字の並び。href があればリンク（条だけのページ /hourei/[lawId]/[num]） */
export type LawRefPart = { text: string; href?: string };

/** 名前で引けた法律。正式名・略称・通称のどれか */
export type LawNameHit = { name: string; lawId: string };

/**
 * ページに渡す引き当ての表（JSON にできる形）。
 * names：名前 → 法令ID。2つ以上の法律に当たる名前は null（リンクにしない）。
 * articles：ある条（`法令ID/条の番号`）
 */
export type LawRefIndex = { names: Record<string, string | null>; articles: string[] };

/**
 * 名前の候補にする長さ。区切りの文字も「N条」も含まない法令名と略称のうち、いちばん長いもの（94字。2026-11-13 に全件を取り込んだ D1 で測った）。
 * これより長い題名は、区切りか「第N条」を含むので、もともと当たらない
 */
const NAME_MAX = 94;
/** 1つの本文で見る「N条」の数。これより後ろはリンクにしない（引く名前の数を抑える） */
const PLACES_MAX = 20;

const KANJI = '〇一二三四五六七八九十百千';
const NUMBER = `[0-9０-９]+|[${KANJI}]+`;
// 「第」は省いてよい。「条の2」「条の二の三」「条の二第1項」を受ける。
// 枝番号にしないもの：「9条の二つ」、すぐあとに漢字が続く漢数字（「9条の一部」「の三要件」。続く漢字が 第・及・又・並 なら枝番号のまま）。
// 数字は途中で切らない（「の12つ」を「の1」にしない）
const BRANCH_NUMBER = `[0-9０-９]+(?![0-9０-９つ])|[${KANJI}]+(?!つ|〇|(?![第及又並])[一-鿿々])`;
const ARTICLE = new RegExp(`(第)?(${NUMBER})条((?:の(?:${BRANCH_NUMBER}))*)`, 'g');
const BRANCH = new RegExp(`の(${NUMBER})`, 'g');
/** 名前の並びを区切る文字：句読点・空白・括弧・引用符。読点を含む略称（「訪販、通販、マルチ等法」など）は、このため当たらない */
const BOUNDARY = /[\s、。，．,.!?！？「」『』（）()［］[\]【】〔〕｛｝{}〈〉《》<>＜＞"'“”‘’]/;

/** 算用数字（全角も）と漢数字（十百千のある書き方と、一〇五 のような並べ方）を数にする。読めなければ null */
function toNumber(s: string): number | null {
	if (/^[0-9０-９]+$/.test(s)) return Number(s.replace(/[０-９]/g, (c) => String(c.charCodeAt(0) - 0xff10)));
	const digit = (c: string) => '〇一二三四五六七八九'.indexOf(c);
	if (!/[十百千]/.test(s)) return [...s].reduce((n, c) => n * 10 + digit(c), 0);
	let total = 0;
	let current = 0;
	for (const c of s) {
		const unit = { 十: 10, 百: 100, 千: 1000 }[c as '十'];
		if (unit) {
			total += (current || 1) * unit;
			current = 0;
		} else {
			if (current) return null;
			current = digit(c);
		}
	}
	return total + current;
}

type Candidate = {
	/** 名前の並びの始まり（前の候補の終わりか、区切りの次） */
	runStart: number;
	/** 「第」か条の番号の始まり */
	start: number;
	/** 「条」と枝番号の終わり */
	end: number;
	/** e-Gov の形の条の番号（"9_2"） */
	num: string;
};

/** 本文の中の「N条」の形。条の番号が読めないものは入れない */
function candidates(text: string): Candidate[] {
	const found: Candidate[] = [];
	let previousEnd = 0;
	for (const m of text.matchAll(ARTICLE)) {
		if (found.length >= PLACES_MAX) break;
		const start = m.index;
		const end = start + m[0].length;
		const head = toNumber(m[2]);
		const branches = [...m[3].matchAll(BRANCH)].map((b) => toNumber(b[1]));
		if (head && branches.every((b) => b)) {
			let runStart = start;
			while (runStart > previousEnd && start - runStart < NAME_MAX && !BOUNDARY.test(text[runStart - 1])) runStart--;
			found.push({ runStart, start, end, num: [head, ...branches].join('_') });
		}
		previousEnd = end;
	}
	return found;
}

/** 名前の候補：並びの末尾から、長い順 */
function namesOf(text: string, c: Candidate): string[] {
	const run = text.slice(c.runStart, c.start);
	return Array.from({ length: run.length }, (_, i) => run.slice(i));
}

/** 本文から、DB で引く名前の候補（重なりなし）。候補がなければ空 */
export function lawRefNames(texts: string[]): string[] {
	const names = new Set<string>();
	for (const text of texts) for (const c of candidates(text)) for (const n of namesOf(text, c)) names.add(n);
	return [...names];
}

/** 本文から、DB で引く法令ID と条の番号の組。names は名前の表（lawNameTable） */
export function lawRefTargets(texts: string[], names: Record<string, string | null>): { lawId: string; num: string }[] {
	const seen = new Map<string, { lawId: string; num: string }>();
	for (const text of texts)
		for (const c of candidates(text)) {
			const lawId = pick(namesOf(text, c), names)?.lawId;
			if (lawId) seen.set(`${lawId}/${c.num}`, { lawId, num: c.num });
		}
	return [...seen.values()];
}

/** 名前 → 法令ID の表。DB で引けた名前に aliases.ts の通称を足し、2つ以上の法律に当たる名前は null にする */
export function lawNameTable(hits: LawNameHit[]): Record<string, string | null> {
	const nicknames = LAW_ALIASES.flatMap((a) => a.nicknames.map((name) => ({ name, lawId: a.lawId })));
	const ids = new Map<string, Set<string>>();
	for (const h of [...hits, ...nicknames]) {
		const set = ids.get(h.name) ?? new Set();
		set.add(h.lawId);
		ids.set(h.name, set);
	}
	return Object.fromEntries([...ids].map(([name, set]) => [name, set.size === 1 ? [...set][0] : null]));
}

/** ページに渡す表。hits は DB で引けた名前、articles はあると確かめた条 */
export function lawRefIndex(hits: LawNameHit[], articles: { lawId: string; num: string }[]): LawRefIndex {
	return { names: lawNameTable(hits), articles: articles.map((a) => `${a.lawId}/${a.num}`) };
}

/** 長い順に試して最初に当たった名前と法令ID。ぶつかる名前に当たったら、短い名前は試さずに null */
function pick(names: string[], table: Record<string, string | null>): { name: string; lawId: string } | null {
	for (const name of names) {
		if (!Object.hasOwn(table, name)) continue;
		const lawId = table[name];
		return lawId ? { name, lawId } : null;
	}
	return null;
}

/** 本文を、文字とリンクの並びにする。リンクは「名前 +（第）N条（の M）」まで。項・号はリンクの外 */
export function linkLawRefs(text: string, index: LawRefIndex): LawRefPart[] {
	const parts: LawRefPart[] = [];
	const articles = new Set(index.articles);
	let at = 0;
	for (const c of candidates(text)) {
		const hit = pick(namesOf(text, c), index.names);
		if (!hit || !articles.has(`${hit.lawId}/${c.num}`)) continue;
		const start = c.start - hit.name.length;
		if (start > at) parts.push({ text: text.slice(at, start) });
		parts.push({ text: text.slice(start, c.end), href: `/hourei/${hit.lawId}/${c.num}` });
		at = c.end;
	}
	if (at < text.length || parts.length === 0) parts.push({ text: text.slice(at) });
	return parts;
}
