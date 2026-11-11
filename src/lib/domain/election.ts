// 選挙期間のルール（Issue #151。#147 の決めること16〜18）。DB にも画面にも触れない
import { checkText } from './issues';

const DAY = 24 * 60 * 60 * 1000;
export const ELECTION_NAME_MAX = 40;

/** 公示日の 0時から投票日の終わりまで（日本時間）。endsAt は投票日の翌日の 0時（その時刻からは期間の外） */
export function electionPeriod(notice: string, vote: string): { startsAt: number; endsAt: number } {
	return { startsAt: Date.parse(`${notice}T00:00:00+09:00`), endsAt: Date.parse(`${vote}T00:00:00+09:00`) + DAY };
}

/** YYYY-MM-DD で、実在する日か */
function validDate(raw: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
	const d = new Date(`${raw}T00:00:00Z`);
	return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === raw;
}

export type ElectionError = 'nameRequired' | 'nameTooLong' | 'nameInvalid' | 'date' | 'order';

/** 登録のフォームの値を確かめる */
export function parseElection(raw: {
	name: string | null | undefined;
	notice: string | null | undefined;
	vote: string | null | undefined;
}): { ok: true; value: { name: string; notice: string; vote: string } } | { ok: false; error: ElectionError } {
	const [name, nameError] = checkText(raw.name, ELECTION_NAME_MAX, false);
	if (nameError === 'required') return { ok: false, error: 'nameRequired' };
	if (nameError === 'tooLong') return { ok: false, error: 'nameTooLong' };
	if (nameError) return { ok: false, error: 'nameInvalid' };
	const notice = (raw.notice ?? '').trim();
	const vote = (raw.vote ?? '').trim();
	if (!validDate(notice) || !validDate(vote)) return { ok: false, error: 'date' };
	if (vote < notice) return { ok: false, error: 'order' };
	return { ok: true, value: { name, notice, vote } };
}
