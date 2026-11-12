// 採決の結果の立場別の分布と「会期中の考えの動き」のルール（Issue #87、設計書 docs/spec/87.md）。DB にも画面にも触れない
import { roundRatio } from './bridge';
import type { Stance } from './posts';
import type { Session } from './session';
import type { VoteChoice } from './votes';

/** 匿名化の基準：この人数に満たない区分は出さない（仕様の「10人未満の区分は表示しない」） */
export const STATS_MIN = 10;

const ORDER = ['for', 'undecided', 'against'] as const satisfies readonly Stance[];

export type ChoiceCounts = Record<VoteChoice, number>;
export type StanceCounts = Record<Stance, number>;
/** 残す丸める前の人数（stance_stats.data）。画面には渡さない */
export type StanceStatsData = { votes: Record<Stance, ChoiceCounts>; weeks: [StanceCounts, StanceCounts, StanceCounts, StanceCounts] };
export type StanceLog = { userId: string; stance: Stance; createdAt: number };

/** 1〜4週目の終わり（設計書 E）。カレンダーの月は8日・15日・22日・翌月1日の0時。分の会期は4つに等しく分ける */
export function weekEnds(session: Session): [number, number, number, number] {
	const first = session.month === null ? (session.startsAt + session.deliberationAt) / 2 : session.startsAt + 7 * 24 * 60 * 60 * 1000;
	return [first, session.deliberationAt, session.voteAt, session.endsAt];
}

/**
 * その人の、at より前の最後の立場。行がなければ未定（設計書 D）。
 * logs は id の順（同じ時刻なら後の行を採る）。tallyStanceStats は人ごとにまとめた行を渡す
 */
export function stanceAt(logs: readonly StanceLog[], userId: string, at: number): Stance {
	let found: StanceLog | null = null;
	for (const log of logs) {
		if (log.userId !== userId || log.createdAt >= at) continue;
		if (found === null || log.createdAt >= found.createdAt) found = log;
	}
	return found?.stance ?? 'undecided';
}

const emptyChoices = (): ChoiceCounts => ({ yes: 0, no: 0, abstain: 0 });
const emptyStances = (): StanceCounts => ({ for: 0, undecided: 0, against: 0 });

/**
 * 丸める前の人数を作る。votes は数えた票だけ（呼ぶ側で絞る）。
 * 分布は会期の終わりの時点の立場で、動きは logs に出てくる人（一度でも選んだ人）を各週の終わりの時点の立場で数える
 */
export function tallyStanceStats(votes: readonly { userId: string; choice: VoteChoice }[], logs: readonly StanceLog[], session: Session): StanceStatsData {
	const ends = weekEnds(session);
	// 人ごとにまとめておき、1人を数えるたびに全部の行を見ないようにする（行の順は保つ）
	const byUser = new Map<string, StanceLog[]>();
	for (const log of logs) {
		const list = byUser.get(log.userId);
		if (list) list.push(log);
		else byUser.set(log.userId, [log]);
	}
	const of = (userId: string, at: number) => stanceAt(byUser.get(userId) ?? [], userId, at);
	const byVote = { for: emptyChoices(), undecided: emptyChoices(), against: emptyChoices() };
	for (const v of votes) byVote[of(v.userId, session.endsAt)][v.choice] += 1;
	const weeks = ends.map((end) => {
		const counts = emptyStances();
		for (const id of byUser.keys()) counts[of(id, end)] += 1;
		return counts;
	}) as StanceStatsData['weeks'];
	return { votes: byVote, weeks };
}

const ratio = (n: number, total: number) => roundRatio(n / total) as number;

export type DistributionRow = { stance: Stance } & ChoiceCounts;

/** 結果のページの立場別の分布：STATS_MIN 人以上の区分だけを5%刻みの割合で。omitted は区分を1つでも除いたか（設計書 G・H） */
export function distributionView(votes: StanceStatsData['votes']): { rows: DistributionRow[]; omitted: boolean } {
	const rows: DistributionRow[] = [];
	for (const stance of ORDER) {
		const c = votes[stance];
		const total = c.yes + c.no + c.abstain;
		if (total < STATS_MIN) continue;
		rows.push({ stance, yes: ratio(c.yes, total), no: ratio(c.no, total), abstain: ratio(c.abstain, total) });
	}
	return { rows, omitted: rows.length < ORDER.length };
}

export type MotionRow = { week: 1 | 2 | 3 | 4 } & StanceCounts;

/** 考えの動き：数える人が STATS_MIN 人に満たなければ null。tallyStanceStats はどの週も同じ人（一度でも選んだ人）を数えるので、1週目の合計が人数 */
export function motionView(weeks: StanceStatsData['weeks']): MotionRow[] | null {
	const total = weeks[0].for + weeks[0].undecided + weeks[0].against;
	if (total < STATS_MIN) return null;
	return weeks.map((w, i) => ({ week: (i + 1) as MotionRow['week'], for: ratio(w.for, total), undecided: ratio(w.undecided, total), against: ratio(w.against, total) }));
}
