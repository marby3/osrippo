// 議員・有識者の認証のルール（設計書 docs/spec/157.md）。DB にも画面にも触れない
import { checkText } from './issues';
import { tokyoDate } from './law/display';

export const VERIFICATION_KINDS = ['legislator', 'expert'] as const;
export type VerificationKind = (typeof VERIFICATION_KINDS)[number];
export const VERIFICATION_ACTIONS = ['grant', 'renew', 'revoke'] as const;
export type VerificationAction = (typeof VERIFICATION_ACTIONS)[number];
/** 画面に出す認証（表示する名前と種類と専門分野）。user_id は入れない */
/** hidden は選挙期間中の議員（名前の代わりに「議員（選挙期間中のため名前を出していません）」。Issue #151） */
export type Verified = { kind: VerificationKind; name: string; field: string | null; hidden?: true };
/** 名前を出すところに渡すもの。認証があれば表示する名前とバッジ、なければ表示名 */
export type Person = { name: string; verified: Verified | null };

/** 表示する名前と専門分野の長さの上限 */
export const VERIFICATION_NAME_MAX = 40;

const DAY = 24 * 60 * 60 * 1000;
const JST = 9 * 60 * 60 * 1000;

/** YYYY-MM-DD の日本時間の 0時 */
const tokyoMidnight = (date: string) => Date.parse(`${date}T00:00:00+09:00`);

/**
 * 期限：操作した日（日本時間）の1年後の同じ日付の終わりまで有効。返すのはその翌日の 0時（日本時間）。
 * 2月29日は、翌年の2月28日まで
 */
export function verificationExpiry(ms: number): number {
	const [y, m, d] = tokyoDate(ms).split('-').map(Number);
	// 1年後の同じ日付（ない日は月の終わりに寄せる）の翌日
	const lastDayOfMonth = new Date(Date.UTC(y + 1, m, 0)).getUTCDate();
	const day = Math.min(d, lastDayOfMonth);
	const last = `${y + 1}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
	return tokyoMidnight(last) + DAY;
}

/** 有効な最後の日（YYYY-MM-DD、日本時間）。「〜まで」に出す */
export function verificationLastDay(expiresAt: number): string {
	return new Date(expiresAt - 1 + JST).toISOString().slice(0, 10);
}

/** 議員か（有効な認証の種類から。Issue #158）。有識者と認証のない人は一般の参加者と同じ */
export function isLegislator(kind: VerificationKind | null | undefined): boolean {
	return kind === 'legislator';
}

/** 認証を付け・延ばし・取り消せる役職（運営だけ）。欄を出すか、一覧を返すか、操作を受けるかを、すべてこれで決める */
export function canVerify(role: string | null | undefined): boolean {
	return role === 'operator';
}

export type VerificationInput = { kind: VerificationKind; name: string; field: string | null };
export type VerificationError = 'kind' | 'nameRequired' | 'nameTooLong' | 'nameInvalid' | 'fieldRequired' | 'fieldTooLong' | 'fieldInvalid';

/** 付けるフォームの値を確かめる。議員は専門分野を見ずに null にする */
export function parseVerification(raw: {
	kind: string | null | undefined;
	name: string | null | undefined;
	field: string | null | undefined;
}): { ok: true; value: VerificationInput } | { ok: false; error: VerificationError } {
	if (!VERIFICATION_KINDS.includes(raw.kind as VerificationKind)) return { ok: false, error: 'kind' };
	const kind = raw.kind as VerificationKind;
	const [name, nameError] = checkText(raw.name, VERIFICATION_NAME_MAX, false);
	if (nameError === 'required') return { ok: false, error: 'nameRequired' };
	if (nameError === 'tooLong') return { ok: false, error: 'nameTooLong' };
	if (nameError) return { ok: false, error: 'nameInvalid' };
	if (kind === 'legislator') return { ok: true, value: { kind, name, field: null } };
	const [field, fieldError] = checkText(raw.field, VERIFICATION_NAME_MAX, false);
	if (fieldError === 'required') return { ok: false, error: 'fieldRequired' };
	if (fieldError === 'tooLong') return { ok: false, error: 'fieldTooLong' };
	if (fieldError) return { ok: false, error: 'fieldInvalid' };
	return { ok: true, value: { kind, name, field } };
}
