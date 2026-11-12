// 統計ページのルール（Issue #154、設計書 docs/spec/154.md）。DB にも画面にも触れない
import { roundRatio } from './bridge';
import { sessionAt, type Session } from './session';
import { STATS_MIN, type StanceStatsData } from './stance-stats';

/** 順位に出す数 */
export const RANK_SIZE = 10;
/** 順位に出す本文のはじめの字数 */
export const EXCERPT_LENGTH = 60;

const JST = 9 * 60 * 60 * 1000;

/** URL の会期（"2050-05"、開発用の短い会期は "m8-123"）から会期を求める。形が違うか、短い会期の分がいまの設定と違えば null */
export function sessionFromKey(key: string, minutes: number | null): Session | null {
	if (minutes === null) {
		// 年は1000年から（Date.UTC が0〜99年を1900年代に読みかえないように）
		const m = /^([1-9]\d{3})-(\d{2})$/.exec(key);
		if (!m) return null;
		const month = Number(m[2]);
		if (month < 1 || month > 12) return null;
		return sessionAt(Date.UTC(Number(m[1]), month - 1, 10) - JST, null);
	}
	const m = /^m(\d+)-(\d+)$/.exec(key);
	if (!m || Number(m[1]) !== minutes) return null;
	return sessionAt(Number(m[2]) * minutes * 60_000, minutes);
}

/**
 * 法案の立場を超えた支持（丸める前）：賛成寄りと反対寄りの、それぞれの数えた票のうち賛成の割合の低いほう。
 * どちらかが STATS_MIN 人に満たなければ null。未定の人は入れない（仕様の2グループ）
 */
export function billBridge(votes: StanceStatsData['votes']): number | null {
	const rate = (g: StanceStatsData['votes']['for']) => {
		const total = g.yes + g.no + g.abstain;
		return total < STATS_MIN ? null : g.yes / total;
	};
	const a = rate(votes.for);
	const b = rate(votes.against);
	return a === null || b === null ? null : Math.min(a, b);
}

/** 立場を超えた支持が多い法案：丸めた値の高い順、同じなら番号の順に RANK_SIZE 本。丸める前の値は返さない（並びにも使わない） */
export function rankBridges<T extends { billId: number; bridge: number | null }>(rows: readonly T[]): (Omit<T, 'bridge'> & { ratio: number })[] {
	return rows
		.filter((r) => r.bridge !== null)
		.map(({ bridge, ...rest }) => ({ ...rest, ratio: roundRatio(bridge) as number }))
		.sort((x, y) => y.ratio - x.ratio || x.billId - y.billId)
		.slice(0, RANK_SIZE);
}

/** 「考えが変わった」が多く付いた投稿：STATS_MIN 人以上を多い順、同じなら番号の順に RANK_SIZE 件の番号だけ */
export function rankChanged(rows: readonly { postId: number; changed: number }[]): number[] {
	return rows
		.filter((r) => r.changed >= STATS_MIN)
		.sort((x, y) => y.changed - x.changed || x.postId - y.postId)
		.slice(0, RANK_SIZE)
		.map((r) => r.postId);
}

/** 本文のはじめ */
export function excerpt(body: string): string {
	const chars = [...body];
	return chars.length <= EXCERPT_LENGTH ? body : `${chars.slice(0, EXCERPT_LENGTH).join('')}…`;
}
