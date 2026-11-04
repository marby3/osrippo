// 採決のルール（Issue #65。設計書 docs/spec/65.md 決めたこと3・4・7）。DB にも画面にも触れない

export const VOTE_CHOICES = ['yes', 'no', 'abstain'] as const;
export type VoteChoice = (typeof VOTE_CHOICES)[number];
export type VoteCounts = Record<VoteChoice, number>;
export type BillOutcome = 'passed' | 'rejected' | 'lapsed';

/** 1人に割り当てる法案の数（仕様の初期値。4本以上にするときは vote_assignments の CHECK も直す） */
export const ASSIGNMENT_COUNT = 3;

/** 定足数：今月の参加者の 20% を切り上げ、最低10人。割合は小数を使わず整数で計算する */
export const quorumRequirement = (participants: number) => Math.max(10, Math.ceil((participants * 20) / 100));

/** 可決の判定。votes は有効票の数。棄権は定足数に数え、賛否の比べには入れない */
export function billOutcome({ yes, no, abstain }: VoteCounts, required: number): BillOutcome {
	if (yes + no + abstain < required) return 'lapsed';
	return yes > no ? 'passed' : 'rejected';
}

/** くじ：候補を Fisher-Yates で混ぜて先頭から count 本。random は 0 以上 1 未満を返す関数 */
export function drawAssignments<T>(candidates: readonly T[], count: number, random: () => number): T[] {
	const pool = [...candidates];
	const picks = Math.min(count, pool.length);
	for (let i = 0; i < picks; i++) {
		const j = i + Math.floor(random() * (pool.length - i));
		[pool[i], pool[j]] = [pool[j], pool[i]];
	}
	return pool.slice(0, picks);
}
