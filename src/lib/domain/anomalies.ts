// 票の偏りの判定（Issue #73。設計書 docs/spec/73.md の A・B2）。DB にも画面にも触れない。数えた票だけを渡す
import { billOutcome, type BillOutcome, type VoteChoice } from './votes';

/** 閾値。数字に根拠はまだなく、β の結果で調整する */
export const ANOMALY = {
	/** 会期が始まる前のこの日数以内に登録した人を新しいアカウントとする */
	newAccountDays: 30,
	newAccountVotes: 10,
	/** 前の会期の割合より、このポイント以上高い */
	newAccountPoints: 30,
	/** 前の会期の数えた票がこれ未満なら判定しない */
	baselineVotes: 30,
	lineAccounts: 5,
	linePercent: 20,
	runVotes: 20,
	runGapMs: 2 * 60_000
} as const;

/** 無効にする理由の長さ */
export const REVIEW_NOTE_MAX = 400;

export const ANOMALY_SIGNALS = ['new_accounts', 'same_line', 'same_run'] as const;
export type AnomalySignal = (typeof ANOMALY_SIGNALS)[number];

export type AnomalyVote = { userId: string; registeredAt: number; line: string | null; choice: VoteChoice; at: number };
/** 運営の画面に出す集計。回線の値とアカウントは入れない */
export type AnomalyDetail = { flagged: number; maxLine: number; longestRun: number; runSeconds: number; without: BillOutcome };

export const newAccountSince = (sessionStart: number) => sessionStart - ANOMALY.newAccountDays * 86_400_000;

/**
 * 判定する。previous は前の会期の新しいアカウントの票数と全票数。quorum は定足数、outcome は数えた結果。
 * hold は、見つかった票をすべて除くと可決が絡んで変わるとき（docs/spec/73.md の B2）
 */
export function voteAnomalies(votes: AnomalyVote[], previous: { newVotes: number; total: number }, sessionStart: number, quorum: number, outcome: BillOutcome) {
	const flagged = new Set<string>();
	const signals: AnomalySignal[] = [];

	const since = newAccountSince(sessionStart);
	const fresh = votes.filter((v) => v.registeredAt >= since);
	// 割合は小数を使わず、分母を払って比べる
	if (
		previous.total >= ANOMALY.baselineVotes &&
		fresh.length >= ANOMALY.newAccountVotes &&
		100 * fresh.length * previous.total - 100 * previous.newVotes * votes.length >= ANOMALY.newAccountPoints * votes.length * previous.total
	) {
		signals.push('new_accounts');
		for (const v of fresh) flagged.add(v.userId);
	}

	const lines = new Map<string, AnomalyVote[]>();
	for (const v of votes) if (v.line !== null) lines.set(v.line, [...(lines.get(v.line) ?? []), v]);
	let maxLine = 0;
	let lineFound = false;
	for (const group of lines.values()) {
		maxLine = Math.max(maxLine, group.length);
		if (group.length >= ANOMALY.lineAccounts && group.length * 100 >= ANOMALY.linePercent * votes.length) {
			lineFound = true;
			for (const v of group) flagged.add(v.userId);
		}
	}
	if (lineFound) signals.push('same_line');

	// 時刻が同じなら userId の順にして、渡す順で結果が変わらないようにする
	const ordered = [...votes].sort((a, b) => a.at - b.at || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
	let longestRun = 0;
	let runSeconds = 0;
	let runFound = false;
	for (let start = 0; start < ordered.length; ) {
		let end = start;
		while (end + 1 < ordered.length && ordered[end + 1].choice === ordered[start].choice && ordered[end + 1].at - ordered[end].at <= ANOMALY.runGapMs) end += 1;
		const length = end - start + 1;
		if (length > longestRun) {
			longestRun = length;
			runSeconds = Math.round((ordered[end].at - ordered[start].at) / 1000);
		}
		if (length >= ANOMALY.runVotes) {
			runFound = true;
			for (let i = start; i <= end; i += 1) flagged.add(ordered[i].userId);
		}
		start = end + 1;
	}
	if (runFound) signals.push('same_run');

	const counts = { yes: 0, no: 0, abstain: 0 };
	for (const v of votes) if (!flagged.has(v.userId)) counts[v.choice] += 1;
	const without = billOutcome(counts, quorum);
	const hold = signals.length > 0 && ((outcome === 'passed' && without !== 'passed') || (outcome === 'rejected' && without === 'passed'));
	const detail: AnomalyDetail = { flagged: flagged.size, maxLine, longestRun, runSeconds, without };
	return { signals, hold, detail };
}
