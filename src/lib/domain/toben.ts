// 答弁イベントのルール（Issue #153。#147 の決めること13）。DB にも画面にも触れない
import { checkText, parseIssueId } from './issues';

export const TOBEN_TITLE_MAX = 60;
const HOUR = 60 * 60 * 1000;
/** 開催の長さの上限 */
export const TOBEN_MAX_LENGTH = 2 * HOUR;
/** 告知から開始までの最短 */
export const TOBEN_NOTICE = 3 * 24 * HOUR;

export type TobenTargetKind = 'issue' | 'bill';
export type TobenError = 'kind' | 'target' | 'titleRequired' | 'titleTooLong' | 'titleInvalid' | 'time' | 'length' | 'notice';

/** 画面の日時（datetime-local の "YYYY-MM-DDTHH:MM"）を日本時間として読む。形が違えば null */
export function parseLocalTime(raw: string | null | undefined): number | null {
	const v = (raw ?? '').trim();
	const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(v);
	if (!m) return null;
	const [y, mo, d, h, mi] = m.slice(1).map(Number);
	// 実在しない日時（2月30日、24時など）を別の日に読み替えない
	const utc = Date.UTC(y, mo - 1, d, h, mi);
	const back = new Date(utc);
	if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d || back.getUTCHours() !== h || back.getUTCMinutes() !== mi) return null;
	return utc - 9 * 60 * 60 * 1000;
}

/** 告知のフォームの値を確かめる。now は告知する時刻 */
export function parseToben(
	raw: { kind: string | null | undefined; target: string | null | undefined; title: string | null | undefined; starts: string | null | undefined; ends: string | null | undefined },
	now: number
): { ok: true; value: { kind: TobenTargetKind; targetId: number; title: string; startsAt: number; endsAt: number } } | { ok: false; error: TobenError } {
	if (raw.kind !== 'issue' && raw.kind !== 'bill') return { ok: false, error: 'kind' };
	const targetId = parseIssueId((raw.target ?? '').trim());
	if (targetId === null) return { ok: false, error: 'target' };
	const [title, titleError] = checkText(raw.title, TOBEN_TITLE_MAX, false);
	if (titleError === 'required') return { ok: false, error: 'titleRequired' };
	if (titleError === 'tooLong') return { ok: false, error: 'titleTooLong' };
	if (titleError) return { ok: false, error: 'titleInvalid' };
	const startsAt = parseLocalTime(raw.starts);
	const endsAt = parseLocalTime(raw.ends);
	if (startsAt === null || endsAt === null || endsAt <= startsAt) return { ok: false, error: 'time' };
	if (endsAt - startsAt > TOBEN_MAX_LENGTH) return { ok: false, error: 'length' };
	if (startsAt - now < TOBEN_NOTICE) return { ok: false, error: 'notice' };
	return { ok: true, value: { kind: raw.kind, targetId, title, startsAt, endsAt } };
}

export type TobenState = 'cancelled' | 'stopped' | 'upcoming' | 'live' | 'ended';

/** いまの状態。取り消し → 選挙で中止 → 時刻の順に決める */
export function tobenState(e: { startsAt: number; endsAt: number; cancelledAt: number | null; stopped: boolean }, now: number): TobenState {
	if (e.cancelledAt !== null) return 'cancelled';
	if (e.stopped) return 'stopped';
	if (now < e.startsAt) return 'upcoming';
	if (now < e.endsAt) return 'live';
	return 'ended';
}
