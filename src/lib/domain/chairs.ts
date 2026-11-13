// 委員長選挙と理事、解任動議のルール（Issue #77。設計書 docs/spec/77.md 決めたこと1）
import { DAY, LIMITS } from './limits';
import type { Session } from './session';

/** 次点から理事にする人数（仕様の「次点の2〜3人」の上限） */
export const DIRECTOR_MAX = 3;
/** 委員長の最後の操作からこの時間たつと、理事が代行できる（決定16） */
export const ACTING_AFTER = 7 * DAY;
/** 同じ選挙の票と同じ動議の署名を、1回線から出せるアカウントの数（課題の「わかる」と同じ） */
export const CHAIR_ACCOUNTS_PER_IP = LIMITS.supportAccountsPerIp;

/** 立候補の締切：4週目の真ん中。最後に立候補した人にも票が入る時間を残す */
export const candidacyEnd = (session: Session) => session.voteAt + Math.floor((session.endsAt - session.voteAt) / 2);
export const candidacyOpen = (session: Session, now: number) => session.voteAt <= now && now < candidacyEnd(session);
export const electionOpen = (session: Session, now: number) => session.voteAt <= now && now < session.endsAt;

/** 立候補の条件の判定（わたしの記録。Issue #171）。運営か、この会期にこの委員会の法案へ質疑か答弁を書いたか、委員長を2会期続けているか */
export type CandidacyChecks = { staff: boolean; posted: boolean; chairedTwice: boolean };
export type CandidacyStep = { key: 'post' | 'consecutive' | 'period'; done: boolean };

/** 「委員長に立候補できるまで」の条件ごとの済んだ・まだ。全部済んだときだけ立候補できる（運営は別に出す） */
export const candidacySteps = (checks: CandidacyChecks, session: Session, now: number): CandidacyStep[] => [
	{ key: 'post', done: checks.posted },
	{ key: 'consecutive', done: !checks.chairedTwice },
	{ key: 'period', done: candidacyOpen(session, now) }
];

/** 連続は2会期まで：いまの会期と前の会期の両方で委員長（解任された任期も数える）なら立候補できない */
export const consecutiveLimit = (chairNow: boolean, chairBefore: boolean) => chairNow && chairBefore;

/** 解任に要る署名：今月の参加者の 20%。最低10人（定足数と同じ） */
export const recallRequirement = (participants: number) => Math.max(10, Math.ceil(participants * 0.2));

export type ElectedRow = { userId: string; votes: number; rank: number; role: 'chair' | 'director' };

/** 結果：1票以上の候補を得票の多い順に、同数はくじで。最多が委員長、次の3人までが理事 */
export function electionResult(rows: readonly { userId: string; votes: number }[], random: () => number): ElectedRow[] {
	return rows
		.filter((r) => r.votes > 0)
		.map((r) => ({ ...r, draw: random() }))
		.sort((a, b) => b.votes - a.votes || a.draw - b.draw)
		.slice(0, 1 + DIRECTOR_MAX)
		.map((r, rank) => ({ userId: r.userId, votes: r.votes, rank, role: rank === 0 ? 'chair' : 'director' }));
}
