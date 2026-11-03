// 似た課題の判定（設計書 docs/spec/30.md「似ている度合い」）。タイトルの2文字ずつの組の重なり（Dice 係数）
// 判定を差し替えるとき（Jev など。Issue #31）は rankSimilar を入れ替える

/** NFKC にそろえ、英字を小文字にし、空白・句読点・記号を除く */
const normalize = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]/gu, '');

/** となり合う2文字の組。平仮名だけの組は数えない（言い回しが同じだけで似ていると出ないように） */
function bigrams(s: string): Set<string> {
	const chars = [...normalize(s)];
	const set = new Set<string>();
	for (let i = 0; i + 1 < chars.length; i++) {
		const pair = chars[i] + chars[i + 1];
		if (!/^\p{Script=Hiragana}{2}$/u.test(pair)) set.add(pair);
	}
	return set;
}

export function similarity(a: string, b: string): { common: number; score: number } {
	const x = bigrams(a);
	const y = bigrams(b);
	if (x.size === 0 || y.size === 0) return { common: 0, score: 0 };
	let common = 0;
	for (const g of x) if (y.has(g)) common++;
	return { common, score: (2 * common) / (x.size + y.size) };
}

export const SIMILAR_MIN_COMMON = 2;
export const SIMILAR_MIN_SCORE = 0.2;
export const SIMILAR_LIMIT = 3;

/** 共通の組が2つ以上・度合い0.2以上を、度合い → わかるの数 → 新しい順に3件まで */
export function rankSimilar<T extends { id: number; title: string; supports: number }>(query: string, candidates: T[]): T[] {
	return candidates
		.map((c) => ({ c, ...similarity(query, c.title) }))
		.filter((r) => r.common >= SIMILAR_MIN_COMMON && r.score >= SIMILAR_MIN_SCORE)
		.sort((a, b) => b.score - a.score || b.c.supports - a.c.supports || b.c.id - a.c.id)
		.slice(0, SIMILAR_LIMIT)
		.map((r) => r.c);
}
