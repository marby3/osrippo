// 前後の版の条・項・号を、番号ではなく本文の似ている度合いで対応付ける（仕様「条文の構造」）
import type { Article, Item, Paragraph } from './parse';

/** これ未満は同じ条・項・号とみなさない（2026-11-02 決定） */
export const SIMILARITY_THRESHOLD = 0.5;

/**
 * unchanged：本文が同じ / amended：似ている度合いが基準以上で本文が違う
 * unconfirmed：相手がなく、前の版に同じ番号があった（運営が確定するまで別の条として扱う）
 * added / removed：相手がない
 */
export type Kind = 'unchanged' | 'amended' | 'unconfirmed' | 'added' | 'removed';
export type Match<T> = { kind: Kind; before?: T; after?: T; similarity?: number };
export type ParagraphMatch = Match<Paragraph> & { items: Match<Item>[] };
/** 項と号は、結び付いた条・項の中でだけ対応付ける。結び付かなかったものは空 */
export type ArticleMatch = Match<Article> & { paragraphs: ParagraphMatch[] };

/** 共通する文字の並びの長さ（最長共通部分列）。b の文字をビットに並べて数える（Hyyrö のビット並列法） */
function commonLength(a: string, b: string): number {
	const words = (b.length + 31) >>> 5;
	const masks = new Map<string, Uint32Array>();
	for (let j = 0; j < b.length; j++) {
		let mask = masks.get(b[j]);
		if (!mask) masks.set(b[j], (mask = new Uint32Array(words)));
		mask[j >>> 5] |= 1 << (j & 31);
	}
	const none = new Uint32Array(words);
	const v = new Uint32Array(words).fill(0xffffffff);
	for (let i = 0; i < a.length; i++) {
		const m = masks.get(a[i]) ?? none;
		let carry = 0;
		for (let k = 0; k < words; k++) {
			const sum = v[k] + (v[k] & m[k]) + carry;
			carry = sum > 0xffffffff ? 1 : 0;
			v[k] = (sum >>> 0) | (v[k] & ~m[k]);
		}
	}
	let zeros = 0;
	for (let j = 0; j < b.length; j++) if (!(v[j >>> 5] & (1 << (j & 31)))) zeros++;
	return zeros;
}

/** 文字単位の似ている度合い（0〜1）。共通する文字数×2 ÷ 両方の文字数 */
export function similarity(a: string, b: string): number {
	if (a === b) return 1;
	return (2 * commonLength(a, b)) / (a.length + b.length);
}

function align<T extends { num: string }>(before: T[], after: T[], text: (t: T) => string): Match<T>[] {
	const beforeText = before.map(text);
	const afterText = after.map(text);
	const partnerOfAfter = new Map<number, { b: number; sim: number }>();
	const usedBefore = new Set<number>();
	const link = (pairs: { b: number; a: number; sim: number }[]) => {
		const sameNum = (p: { b: number; a: number }) => (before[p.b].num === after[p.a].num ? 0 : 1);
		pairs.sort((p, q) => q.sim - p.sim || sameNum(p) - sameNum(q) || p.b - q.b || p.a - q.a);
		for (const p of pairs) {
			if (usedBefore.has(p.b) || partnerOfAfter.has(p.a)) continue;
			usedBefore.add(p.b);
			partnerOfAfter.set(p.a, p);
		}
	};

	// 本文が同じ組（似ている度合い 1）を先に結び付け、残りの組だけ差分を取る
	const afterByText = new Map<string, number[]>();
	afterText.forEach((t, a) => afterByText.set(t, [...(afterByText.get(t) ?? []), a]));
	link(beforeText.flatMap((t, b) => (afterByText.get(t) ?? []).map((a) => ({ b, a, sim: 1 }))));

	const pairs: { b: number; a: number; sim: number }[] = [];
	before.forEach((_, b) => {
		if (usedBefore.has(b)) return;
		after.forEach((_, a) => {
			if (partnerOfAfter.has(a)) return;
			const [x, y] = [beforeText[b], afterText[a]];
			// 長さの差だけで基準に届かない組は、差分を取らずに外す
			if ((2 * Math.min(x.length, y.length)) / (x.length + y.length || 1) < SIMILARITY_THRESHOLD) return;
			const sim = similarity(x, y);
			if (sim >= SIMILARITY_THRESHOLD) pairs.push({ b, a, sim });
		});
	});
	link(pairs);

	const beforeNums = new Set(before.map((t) => t.num));
	const matches: Match<T>[] = after.map((t, a) => {
		const p = partnerOfAfter.get(a);
		if (!p) return { kind: beforeNums.has(t.num) ? 'unconfirmed' : 'added', after: t };
		const kind = beforeText[p.b] === afterText[a] ? 'unchanged' : 'amended';
		return { kind, before: before[p.b], after: t, similarity: p.sim };
	});
	before.forEach((t, b) => usedBefore.has(b) || matches.push({ kind: 'removed', before: t }));
	return matches;
}

const itemText = (i: Item) => i.text;
const paragraphText = (p: Paragraph) => p.text + p.items.map(itemText).join('');
const articleText = (a: Article) => a.caption + a.paragraphs.map(paragraphText).join('');

export function alignArticles(before: Article[], after: Article[]): ArticleMatch[] {
	return align(before, after, articleText).map((m) => ({
		...m,
		paragraphs:
			m.before && m.after
				? align(m.before.paragraphs, m.after.paragraphs, paragraphText).map((pm) => ({
						...pm,
						items: pm.before && pm.after ? align(pm.before.items, pm.after.items, itemText) : []
					}))
				: []
	}));
}
