// 会期の区切り（Issue #44）。時刻から求める純粋な関数で、DB にも画面にも触れない。
// 会期と法案の状態は時刻から求め、「最後に処理した時刻」に頼らない（Issue #41 レビューで決めたこと）

export type Stage = 'proposal' | 'deliberation' | 'vote';

export type Session = {
	/** カレンダーの月なら "2030-05"、分の会期なら "m8-…" */
	key: string;
	/** カレンダーの月（1〜12）。分の会期は null */
	month: number | null;
	startsAt: number;
	/** 質疑と修正の始まり（3週目） */
	deliberationAt: number;
	/** 採決の始まり（4週目） */
	voteAt: number;
	/** 次の会期の始まり */
	endsAt: number;
	week: 1 | 2 | 3 | 4;
	stage: Stage;
};

const JST = 9 * 60 * 60 * 1000;
/** 日本時間の y 年 m 月（0 始まり。12 は翌年の1月）d 日 0時のミリ秒 */
const jstMidnight = (y: number, m: number, d: number) => Date.UTC(y, m, d) - JST;

const stageOf = (week: 1 | 2 | 3 | 4): Stage => (week <= 2 ? 'proposal' : week === 3 ? 'deliberation' : 'vote');

/**
 * now を含む会期。minutes が null ならカレンダーの月（1〜7日が1週目、8〜14日が2週目、15〜21日が3週目、22日〜末日が4週目）。
 * minutes があれば、その分数の会期を 1970-01-01 から並べ、4つに等しく分ける（2:1:1 の発議・質疑と修正・採決）
 */
export function sessionAt(now: number, minutes: number | null): Session {
	if (minutes !== null) {
		const length = minutes * 60 * 1000;
		const index = Math.floor(now / length);
		const startsAt = index * length;
		const week = (Math.min(3, Math.floor(((now - startsAt) * 4) / length)) + 1) as 1 | 2 | 3 | 4;
		return {
			key: `m${minutes}-${index}`,
			month: null,
			startsAt,
			deliberationAt: startsAt + length / 2,
			voteAt: startsAt + (length * 3) / 4,
			endsAt: startsAt + length,
			week,
			stage: stageOf(week)
		};
	}
	const d = new Date(now + JST);
	const [y, m, day] = [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()];
	const week = (day <= 7 ? 1 : day <= 14 ? 2 : day <= 21 ? 3 : 4) as 1 | 2 | 3 | 4;
	return {
		key: `${y}-${String(m + 1).padStart(2, '0')}`,
		month: m + 1,
		startsAt: jstMidnight(y, m, 1),
		deliberationAt: jstMidnight(y, m, 15),
		voteAt: jstMidnight(y, m, 22),
		endsAt: jstMidnight(y, m + 1, 1),
		week,
		stage: stageOf(week)
	};
}

/**
 * 開発用の短い会期の分数。pnpm dev のとき（dev が true）だけ、SESSION_MINUTES が 1〜1440 の整数なら使う。
 * ビルドしたサーバー（本番と画面のテスト）では、設定があっても null（カレンダーの月）
 */
export function sessionMinutes(dev: boolean, raw: string | undefined): number | null {
	if (!dev || raw === undefined || !/^[1-9]\d{0,3}$/.test(raw)) return null;
	const n = Number(raw);
	return n <= 1440 ? n : null;
}

/**
 * 説明に出す会期の日（日本時間の日）：発議の締切・質疑の始まり・採決の始まり。どの月でも同じなので、ある月の会期から求める。
 * 法案の書き方（Issue #59）と遊び方（Issue #131）で使う。発議の締切は質疑の始まりの0時なので、発議できるのはその前の日まで
 */
export function sessionDays() {
	const JST = 9 * 60 * 60 * 1000;
	const dayOf = (at: number) => new Date(at + JST).getUTCDate();
	const session = sessionAt(Date.UTC(2030, 0, 10), null);
	const deliberation = dayOf(session.deliberationAt);
	return { proposeUntil: deliberation - 1, deliberation, vote: dayOf(session.voteAt) };
}
