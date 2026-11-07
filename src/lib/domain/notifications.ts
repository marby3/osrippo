// アプリ内通知のルール（Issue #78。設計書 docs/spec/78.md 決めたこと11）。本文は持たず、読むときに種類と題名から作る

/** 行を書く種類 */
export const NOTIFICATION_KINDS = [
	'bill_proposed',
	'bill_passed',
	'bill_rejected',
	'bill_lapsed',
	'bill_reviewing',
	'bill_voided',
	'bill_adjustment',
	'bill_law_repealed',
	'bill_adjusted',
	'bill_conflict',
	'cosponsor_requested',
	'cosponsor_left',
	'cosponsor_accepted',
	'cosponsor_declined',
	'cosponsor_removed',
	'withdraw_requested',
	'bill_withdrawn',
	'merge_requested',
	'merge_proposed',
	'bill_edited',
	'mind_changed_post',
	'mind_changed_solution',
	'issue_hidden',
	'issue_restored',
	'issue_merged',
	'solution_hidden',
	'solution_restored',
	'post_hidden',
	'post_restored',
	'question_merged',
	'amendment_hidden',
	'amendment_restored',
	'chair_elected',
	'director_elected',
	'chair_recalled',
	'chair_vote_removed'
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** 時刻から求める種類（行を書かない） */
export type TimedKind = 'vote_open' | 'election_open' | 'my_bill_deliberation' | 'my_bill_vote' | 'my_bill_expired' | 'acting';

export type NoticeKind = NotificationKind | TimedKind;
export type NoticeTarget = 'bill' | 'issue' | 'solution' | 'post' | 'amendment' | 'committee';

/** target_id が指すもの。投稿と解決策は番号の並びが別なので、種類で分ける */
export function targetOf(kind: NotificationKind): NoticeTarget {
	if (kind === 'mind_changed_post' || kind === 'post_hidden' || kind === 'post_restored' || kind === 'question_merged') return 'post';
	if (kind === 'amendment_hidden' || kind === 'amendment_restored') return 'amendment';
	if (kind.startsWith('issue_')) return 'issue';
	if (kind === 'mind_changed_solution' || kind.startsWith('solution_')) return 'solution';
	if (kind.startsWith('chair_') || kind === 'director_elected') return 'committee';
	return 'bill';
}

/** 結果のページへ。否決と廃案は、出し直しのある法案のページへ */
const RESULT_KINDS: readonly NoticeKind[] = ['bill_passed', 'bill_reviewing', 'bill_voided'];

/** リンク先。billId は法案か投稿の法案、issueId は課題か解決策の課題 */
export function hrefOf(kind: NoticeKind, ids: { billId?: number; issueId?: number }): string {
	if (kind === 'vote_open') return '/saiketsu';
	if (kind === 'election_open' || kind === 'acting' || kind === 'chair_elected' || kind === 'director_elected' || kind === 'chair_recalled' || kind === 'chair_vote_removed') return '/iinkai';
	if (kind === 'mind_changed_post' || kind === 'post_hidden' || kind === 'post_restored' || kind === 'question_merged') return `/houan/${ids.billId}/shitsugi`;
	if (kind === 'amendment_hidden' || kind === 'amendment_restored') return `/houan/${ids.billId}/shusei`;
	if (kind === 'mind_changed_solution' || kind === 'solution_hidden' || kind === 'solution_restored') return `/kadai/${ids.issueId}/kaiketsu`;
	if (kind === 'issue_hidden' || kind === 'issue_restored' || kind === 'issue_merged') return `/kadai/${ids.issueId}`;
	return RESULT_KINDS.includes(kind) ? `/saiketsu/${ids.billId}/kekka` : `/houan/${ids.billId}`;
}
