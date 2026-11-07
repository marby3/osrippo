// 通報と運営の操作の判定（設計書 docs/spec/28.md 決めたこと2・3・5）
import { checkText, parseIssueId } from './issues';
import { DAY } from './limits';

export const REPORT_REASONS = ['attack', 'spam', 'duplicate', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number] | 'none';
export const HIDE_REASONS = ['attack', 'spam', 'other'] as const;
export type HideReason = (typeof HIDE_REASONS)[number];

export const NOTE_MAX = 200;
/** 自動で非表示にする通報の数（数に入るものだけ） */
export const HIDE_THRESHOLD = 3;

/** 通報の理由と説明。理由は任意（空は none）。説明は「その他」のときだけ受け取る */
export function validateReport(
	raw: { reason: string | null; note: string | null },
	allowed: readonly string[] = REPORT_REASONS
): { ok: true; value: { reason: ReportReason; note: string | null } } | { ok: false } {
	// none は保存の値。フォームからは空で送る
	if (raw.reason !== null && raw.reason !== '' && !allowed.includes(raw.reason)) {
		return { ok: false };
	}
	const reason = raw.reason || 'none';
	if (reason !== 'other') return { ok: true, value: { reason: reason as ReportReason, note: null } };
	const [note, error] = checkText(raw.note, NOTE_MAX, true);
	if (error === 'required') return { ok: true, value: { reason, note: null } };
	if (error) return { ok: false };
	return { ok: true, value: { reason, note } };
}

/** 解決策の通報の理由（「同じ課題がほかにある」は課題の統合のための理由なので出さない。設計書 docs/spec/36.md） */
export const SOLUTION_REPORT_REASONS = ['attack', 'spam', 'other'] as const;
export type SolutionReportReason = (typeof SOLUTION_REPORT_REASONS)[number] | 'none';

export function validateSolutionReport(raw: {
	reason: string | null;
	note: string | null;
}): { ok: true; value: { reason: SolutionReportReason; note: string | null } } | { ok: false } {
	return validateReport(raw, SOLUTION_REPORT_REASONS) as
		| { ok: true; value: { reason: SolutionReportReason; note: string | null } }
		| { ok: false };
}

/** 解決策への運営の操作：解決策の番号、非表示の理由（非表示にするときだけ）、メモ */
export function validateSolutionAction(
	raw: { solution: string | null; reason?: string | null; note: string | null },
	action: 'hide' | 'restore'
): { ok: true; value: { solutionId: number; reason: HideReason | null; note: string } } | { ok: false } {
	const checked = validateStaffAction({ issue: raw.solution, reason: raw.reason, note: raw.note }, action);
	if (!checked.ok) return { ok: false };
	const { issueId: solutionId, reason, note } = checked.value;
	return { ok: true, value: { solutionId, reason, note } };
}

/** 自動非表示の数に入れるか：同じ課題がほかにある、と、登録から24時間たっていない人の通報は入れない */
export const countsTowardHide = (reason: ReportReason, registeredAt: number, now: number) =>
	reason !== 'duplicate' && now - registeredAt >= DAY;

/** 運営の操作：課題の番号、非表示の理由（非表示にするときだけ）、統合先の番号（統合するときだけ）、メモ（1〜200字。公開する） */
export function validateStaffAction(
	raw: { issue: string | null; reason?: string | null; target?: string | null; note: string | null },
	action: 'hide' | 'restore' | 'merge'
): { ok: true; value: { issueId: number; targetId?: number; reason: HideReason | null; note: string } } | { ok: false } {
	const issueId = parseIssueId(raw.issue ?? '');
	if (issueId === null) return { ok: false };
	let reason: HideReason | null = null;
	if (action === 'hide') {
		if (!(HIDE_REASONS as readonly string[]).includes(raw.reason ?? '')) return { ok: false };
		reason = raw.reason as HideReason;
	}
	let targetId: number | null = null;
	if (action === 'merge') {
		targetId = parseIssueId(raw.target ?? '');
		if (targetId === null) return { ok: false };
	}
	const [note, error] = checkText(raw.note, NOTE_MAX, true);
	if (error) return { ok: false };
	return { ok: true, value: { issueId, ...(targetId === null ? {} : { targetId }), reason, note } };
}

export type IssueStatus = 'visible' | 'auto_hidden' | 'hidden' | 'restored' | 'merged';
export const isHidden = (status: IssueStatus) => status === 'auto_hidden' || status === 'hidden';
/** 非表示にできる状態、表示に戻せる状態（設計書 決めたこと5の表） */
export const HIDEABLE: IssueStatus[] = ['visible', 'auto_hidden', 'restored'];
export const RESTORABLE: IssueStatus[] = ['auto_hidden', 'hidden'];
/** 一覧に出る状態。統合の元と統合先になれるのもこの状態だけ（設計書 docs/spec/30.md 決めたこと5） */
export const LISTED: IssueStatus[] = ['visible', 'restored'];
/** 表示中の解決策の状態（解決策には merged がない） */
export const SOLUTION_SHOWN = ['visible', 'restored'] as const;

/** 表示中の投稿の状態（設計書 docs/spec/80.md） */
export const POST_SHOWN = ['visible', 'restored'] as const;
export const POST_HIDDEN = ['auto_hidden', 'hidden'] as const;
/** 立候補の資格に数える投稿の状態（決定J） */
export const POST_CANDIDACY = [...POST_SHOWN, 'auto_hidden'] as const;
/** hidden でもこの役職の操作なら資格に数える（選挙の相手になりうる人の操作で立候補を止められないように。決定J） */
export const POST_CANDIDACY_ACTORS = ['chair', 'director'] as const;

/** 投稿への運営の操作：投稿の番号、非表示の理由（非表示にするときだけ）、メモ */
export function validatePostAction(
	raw: { post: string | null; reason?: string | null; note: string | null },
	action: 'hide' | 'restore'
): { ok: true; value: { postId: number; reason: HideReason | null; note: string } } | { ok: false } {
	const checked = validateStaffAction({ issue: raw.post, reason: raw.reason, note: raw.note }, action);
	if (!checked.ok) return { ok: false };
	const { issueId: postId, reason, note } = checked.value;
	return { ok: true, value: { postId, reason, note } };
}
