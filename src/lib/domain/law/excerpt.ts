// 変わったところの前後だけを残す（投票の画面の変更点。Issue #123）。
// 仕様書「割り当て分は3行要約と変更点の一覧だけで判断できるように」：変わらないところは短く、変わったところは全部出す
import type { DiffPart } from './compare.ts';

const ELLIPSIS = '…';

/**
 * 変わっていないところは、変わったところの前後 context 文字ずつだけを残し、省いたところを「…」にする。
 * 変わったところ（added・removed）は全部残す。改行は空白にして1つの段落にする
 */
export function excerptDiff(parts: DiffPart[], context = 10): DiffPart[] {
	const changed = parts.map((p) => Boolean(p.added || p.removed));
	const first = changed.indexOf(true);
	const last = changed.lastIndexOf(true);
	return parts.map((part, i) => {
		const value = part.value.replace(/\r?\n/g, ' ');
		if (changed[i] || first === -1) return { ...part, value };
		// 文字（サロゲートペアを含む）で数える
		const chars = Array.from(value);
		const before = i < first; // 最初の変わったところより前：うしろを残す
		const after = i > last; // 最後の変わったところよりあと：前を残す
		if (before) return { ...part, value: chars.length > context ? ELLIPSIS + chars.slice(-context).join('') : value };
		if (after) return { ...part, value: chars.length > context ? chars.slice(0, context).join('') + ELLIPSIS : value };
		// 変わったところにはさまれている：前後を残す
		return {
			...part,
			value: chars.length > context * 2 ? chars.slice(0, context).join('') + ELLIPSIS + chars.slice(-context).join('') : value
		};
	});
}
