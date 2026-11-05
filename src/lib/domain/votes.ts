// 採決のルール（Issue #65。設計書 docs/spec/65.md 決めたこと3・4・7。結果は docs/spec/71.md）。DB にも画面にも触れない
import type { BillProgress } from './bills';

export const VOTE_CHOICES = ['yes', 'no', 'abstain'] as const;
export type VoteChoice = (typeof VOTE_CHOICES)[number];
export type VoteCounts = Record<VoteChoice, number>;
export const BILL_OUTCOMES = ['passed', 'rejected', 'lapsed'] as const;
export type BillOutcome = (typeof BILL_OUTCOMES)[number];

/** 締切からこの時間は結果を数えない。締切の直前に受け付けた票の書き込みが、数えたあとに届かないように（docs/spec/71.md 決めたことA2） */
export const SETTLE_GRACE = 60_000;

/** 1人に割り当てる法案の数（仕様の初期値。4本以上にするときは vote_assignments の CHECK も直す） */
export const ASSIGNMENT_COUNT = 3;

/** 票のフォームの値。決まった値でなければ null */
export const parseVoteChoice = (raw: unknown): VoteChoice | null => ((VOTE_CHOICES as readonly unknown[]).includes(raw) ? (raw as VoteChoice) : null);

/** ほかの法案のページの1ページの件数 */
export const VOTE_PAGE_SIZE = 50;

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

export type BillStage = Exclude<BillProgress, 'lapsed'> | BillOutcome | 'counting';

/**
 * 画面に出す法案の段階。時刻から求めた進みを先に見る。会期が終わった法案だけ結果を使い、結果がなければ集計中。
 * 会期が終わる前に結果の行があっても可決と出さない
 */
export function billStage(progress: BillProgress, outcome: BillOutcome | null): BillStage {
	if (progress !== 'lapsed') return progress;
	return outcome ?? 'counting';
}

/**
 * 数えた票の結果と参考の票を比べる。どちらにも可否があるときだけ比べる。
 * 参考の票が定足数に届かないときは比べない（1票だけの参考の票で「可否が逆」と出さない）。廃案には可否がない
 */
export function referenceComparison(outcome: BillOutcome, reference: VoteCounts, quorum: number): 'same' | 'reversed' | null {
	const other = billOutcome(reference, quorum);
	if (outcome === 'lapsed' || other === 'lapsed') return null;
	return other === outcome ? 'same' : 'reversed';
}
