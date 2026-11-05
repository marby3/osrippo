// Issue #73 基準2：票の偏りの判定（設計書 docs/spec/73.md の A・B2）
import { expect, test } from 'vitest';
import { voteAnomalies, type AnomalyVote } from './anomalies';

const DAY = 86_400_000;
const START = 1000 * DAY;
const OLD = START - 100 * DAY;
const NEW = START - 29 * DAY;
let n = 0;
const vote = (over: Partial<AnomalyVote> = {}): AnomalyVote => ({ userId: `u${(n += 1)}`, registeredAt: OLD, line: `line${n}`, choice: 'yes', at: START + n * 3 * 60_000, ...over });
const many = (count: number, over: Partial<AnomalyVote> = {}) => Array.from({ length: count }, () => vote(over));
/** 判定の土台：3分おきで、賛成と反対が交互（連続にならない） */
const mixed = (count: number, over: Partial<AnomalyVote> = {}) => Array.from({ length: count }, (_, i) => vote({ choice: i % 2 ? 'no' : 'yes', ...over }));
const NO_BASE = { newVotes: 0, total: 0 };
const check = (votes: AnomalyVote[], previous = NO_BASE, quorum = 10) => voteAnomalies(votes, previous, START, quorum, votes.filter((v) => v.choice === 'yes').length > votes.filter((v) => v.choice === 'no').length ? 'passed' : 'rejected');

test('新しいアカウント：10票以上で、前の会期の割合より30ポイント以上高い。前の会期の票が30票未満なら判定しない', () => {
	const base = { newVotes: 10, total: 100 };
	// 40票のうち16票（40%）は基準の10%より30ポイント高い
	const votes = [...mixed(16, { registeredAt: NEW }), ...mixed(24)];
	expect(check(votes, base).signals).toEqual(['new_accounts']);
	// 40票のうち新しいアカウント15票（37.5%）は 27.5 ポイントで届かない
	expect(check([...mixed(15, { registeredAt: NEW }), ...mixed(25)], base).signals).toEqual([]);
	// 9票は割合が高くても数に届かない
	expect(check(mixed(9, { registeredAt: NEW }), base).signals).toEqual([]);
	// 前の会期の票が30票未満は判定しない。30票なら判定する
	expect(check(votes, { newVotes: 0, total: 29 }).signals).toEqual([]);
	expect(check(votes, { newVotes: 0, total: 30 }).signals).toEqual(['new_accounts']);
	// 基準が70%を超えると働かない
	expect(check(mixed(30, { registeredAt: NEW }), { newVotes: 71, total: 100 }).signals).toEqual([]);
	// 30日より前の登録は新しくない
	expect(check(mixed(40, { registeredAt: START - 31 * DAY }), base).signals).toEqual([]);
});

test('同じ回線：1回線から5アカウント以上で、数えた票の20%以上。回線の記録がない票は分母に残す', () => {
	expect(check([...mixed(5, { line: 'same' }), ...mixed(20)]).signals).toEqual(['same_line']);
	expect(check([...mixed(4, { line: 'same' }), ...mixed(16)]).signals).toEqual([]);
	// 5アカウントでも 20% に届かない
	expect(check([...mixed(5, { line: 'same' }), ...mixed(21)]).signals).toEqual([]);
	// 回線なしは同じ回線に数えない
	expect(check(mixed(10, { line: null })).signals).toEqual([]);
	expect(check([...mixed(5, { line: 'same' }), ...mixed(21, { line: null })]).signals).toEqual([]);
});

test('同じ票の連続：20票以上で、どの票の間も2分以内。同じ時刻でも順が決まる', () => {
	const at = START;
	const run = (length: number, gap: number) => Array.from({ length }, (_, i) => vote({ choice: 'yes', at: at + i * gap }));
	expect(check(run(20, 120_000)).signals).toEqual(['same_run']);
	expect(check(run(19, 120_000)).signals).toEqual([]);
	expect(check(run(20, 120_001)).signals).toEqual([]);
	// 途中に別の票が入ると切れる
	const broken = [...run(10, 1000), vote({ choice: 'no', at: at + 10_500 }), ...Array.from({ length: 10 }, (_, i) => vote({ choice: 'yes', at: at + 11_000 + i }))];
	expect(check(broken).signals).toEqual([]);
	// 同じ時刻の票はアカウントの順で並べるので、渡す順で結果が変わらない
	const same = Array.from({ length: 20 }, (_, i) => vote({ choice: 'yes', at, userId: `s${String(i).padStart(2, '0')}` }));
	const reversed = [...same].reverse();
	expect(check(same).detail).toEqual(check(reversed).detail);
});

test('除いたときの可否：可決が絡んで変わるときだけ保留する。否決から廃案への変化と、変わらないときは保留しない', () => {
	// 可決から廃案：5票を除くと定足数に届かない
	const toLapsed = [...many(5, { line: 'same', choice: 'yes' }), ...mixed(4), vote({ choice: 'yes' })];
	expect(check(toLapsed)).toMatchObject({ signals: ['same_line'], hold: true, detail: { flagged: 5, without: 'lapsed', maxLine: 5 } });
	// 可決から否決：偏りの賛成を除くと反対が多い
	const toRejected = [...many(6, { line: 'same', choice: 'yes' }), ...many(5, { choice: 'no' }), ...many(4, { choice: 'abstain' }), ...many(1, { choice: 'abstain' })];
	expect(voteAnomalies(toRejected, NO_BASE, START, 10, 'passed')).toMatchObject({ hold: true, detail: { without: 'rejected' } });
	// 否決から可決：偏りの反対を除くと賛成が多い
	const toPassed = [...many(7, { line: 'same', choice: 'no' }), ...many(6, { choice: 'yes' }), ...many(5, { choice: 'abstain' })];
	expect(voteAnomalies(toPassed, NO_BASE, START, 10, 'rejected')).toMatchObject({ hold: true, detail: { without: 'passed' } });
	// 否決から廃案は保留しない
	const rejectedToLapsed = [...many(5, { line: 'same', choice: 'no' }), ...many(5, { choice: 'no' })];
	expect(voteAnomalies(rejectedToLapsed, NO_BASE, START, 10, 'rejected')).toMatchObject({ signals: ['same_line'], hold: false, detail: { without: 'lapsed' } });
	// 除いても可決のままなら保留しない
	const stays = [...many(5, { line: 'same', choice: 'no' }), ...many(19, { choice: 'yes' })].map((v, i) => ({ ...v, at: START + i * 300_000 }));
	expect(voteAnomalies(stays, NO_BASE, START, 10, 'passed')).toMatchObject({ signals: ['same_line'], hold: false, detail: { without: 'passed' } });
	// 見つからなければ何も出ない
	expect(check(mixed(30))).toMatchObject({ signals: [], hold: false });
});
