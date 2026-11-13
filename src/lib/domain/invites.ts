// 招待コード（設計書 docs/spec/199.md 決めたこと1・4）。作るのと確かめるのを、この1つの決まりでそろえる

/** 新規登録に招待コードが要るか。β のあいだだけ true。v0.7 の PR で false にする（環境変数にはしない） */
export const INVITE_REQUIRED = true;

/** 使う文字（紛らわしい 0・O・1・I を除いた32文字） */
export const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const INVITE_LENGTH = 12;
/** 1回に作れる数 */
export const INVITE_BATCH_MAX = 20;

const INVITE_PATTERN = /^[A-HJ-NP-Z2-9]{12}$/;

/** 新しいコード。32文字は 256 を割り切るので、バイトを32で割った余りで偏らない */
export function generateInviteCode(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(INVITE_LENGTH));
	return Array.from(bytes, (b) => INVITE_ALPHABET[b % INVITE_ALPHABET.length]).join('');
}

/** 入力をそろえる：NFKC（全角を半角に）→ 前後の空白を落とす → 大文字にする */
export function normalizeInviteCode(raw: string): string {
	return raw.normalize('NFKC').trim().toUpperCase();
}

/** そろえたあとの形が合うか。中の空白、0・O・1・I、ほかの記号、長さの違いは断る（直さない） */
export function isInviteCode(code: string): boolean {
	return INVITE_PATTERN.test(code);
}

/** 作る数（1〜20 の整数）。違えば null */
export function parseInviteCount(raw: string): number | null {
	const t = raw.trim();
	if (!/^[1-9]\d?$/.test(t) || Number(t) > INVITE_BATCH_MAX) return null;
	return Number(t);
}
