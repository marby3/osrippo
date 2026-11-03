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
export function validateReport(raw: {
	reason: string | null;
	note: string | null;
}): { ok: true; value: { reason: ReportReason; note: string | null } } | { ok: false } {
	// none は保存の値。フォームからは空で送る
	if (raw.reason !== null && raw.reason !== '' && !(REPORT_REASONS as readonly string[]).includes(raw.reason)) {
		return { ok: false };
	}
	const reason = raw.reason || 'none';
	if (reason !== 'other') return { ok: true, value: { reason: reason as ReportReason, note: null } };
	const [note, error] = checkText(raw.note, NOTE_MAX, true);
	if (error === 'required') return { ok: true, value: { reason, note: null } };
	if (error) return { ok: false };
	return { ok: true, value: { reason, note } };
}

/** 自動非表示の数に入れるか：同じ課題がほかにある、と、登録から24時間たっていない人の通報は入れない */
export const countsTowardHide = (reason: ReportReason, registeredAt: number, now: number) =>
	reason !== 'duplicate' && now - registeredAt >= DAY;

/** 運営の操作：課題の番号、非表示の理由（非表示にするときだけ）、メモ（1〜200字。公開する） */
export function validateStaffAction(
	raw: { issue: string | null; reason?: string | null; note: string | null },
	action: 'hide' | 'restore'
): { ok: true; value: { issueId: number; reason: HideReason | null; note: string } } | { ok: false } {
	const issueId = parseIssueId(raw.issue ?? '');
	if (issueId === null) return { ok: false };
	let reason: HideReason | null = null;
	if (action === 'hide') {
		if (!(HIDE_REASONS as readonly string[]).includes(raw.reason ?? '')) return { ok: false };
		reason = raw.reason as HideReason;
	}
	const [note, error] = checkText(raw.note, NOTE_MAX, true);
	if (error) return { ok: false };
	return { ok: true, value: { issueId, reason, note } };
}

export type IssueStatus = 'visible' | 'auto_hidden' | 'hidden' | 'restored';
export const isHidden = (status: IssueStatus) => status === 'auto_hidden' || status === 'hidden';
/** 非表示にできる状態、表示に戻せる状態（設計書 決めたこと5の表） */
export const HIDEABLE: IssueStatus[] = ['visible', 'auto_hidden', 'restored'];
export const RESTORABLE: IssueStatus[] = ['auto_hidden', 'hidden'];
