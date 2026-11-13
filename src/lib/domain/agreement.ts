// β版のお約束（Issue #200。受入基準と決めたことは Issue #198 の「β版のお約束と同意」の節）。文は copy/ja.ts の yakusoku

/** いまのお約束の版。文を変えたら版を上げる（上げると、同意のない人として、書き込みの前にもう一度同意してもらう） */
export const AGREEMENT_VERSION = 'beta-1';

/** 送られた版が、いまの版そのものか（前後の空白や大文字小文字の違いも断る） */
export const isCurrentAgreement = (version: unknown): boolean => version === AGREEMENT_VERSION;
