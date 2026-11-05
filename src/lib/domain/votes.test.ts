// Issue #65 基準3・4：定足数と可決の判定（設計書 docs/spec/65.md 決めたこと3・4）
import { expect, test } from 'vitest';
import { billOutcome, billStage, quorumRequirement, referenceComparison } from './votes';

test('基準3：定足数は今月の参加者の 20% を切り上げ、最低10人', () => {
	for (const [n, required] of [
		[0, 10],
		[50, 10],
		[51, 11],
		[100, 20],
		[101, 21]
	]) {
		expect(quorumRequirement(n), String(n)).toBe(required);
	}
});

test('基準4：有効票が定足数に届かなければ廃案。届いていて賛成が多ければ可決。同数は否決。棄権は賛否の比べに入れない', () => {
	const cases: [{ yes: number; no: number; abstain: number }, string][] = [
		[{ yes: 9, no: 0, abstain: 0 }, 'lapsed'],
		[{ yes: 10, no: 0, abstain: 0 }, 'passed'],
		// 棄権は定足数に数える
		[{ yes: 1, no: 0, abstain: 9 }, 'passed'],
		[{ yes: 1, no: 0, abstain: 8 }, 'lapsed'],
		// 棄権は賛否の比べに入れない（賛成が有効票の半分より少なくても可決）
		[{ yes: 3, no: 2, abstain: 5 }, 'passed'],
		[{ yes: 5, no: 5, abstain: 0 }, 'rejected'],
		[{ yes: 2, no: 8, abstain: 0 }, 'rejected'],
		[{ yes: 0, no: 0, abstain: 10 }, 'rejected']
	];
	for (const [votes, outcome] of cases) expect(billOutcome(votes, 10), JSON.stringify(votes)).toBe(outcome);
});

test('Issue #71 基準7：参考の票と比べるのは、どちらにも可否があるときだけ。参考の票が定足数に届かないときと、本案が廃案のときは比べない', () => {
	const votes = (yes: number, no: number, abstain = 0) => ({ yes, no, abstain });
	expect(referenceComparison('passed', votes(6, 4), 10)).toBe('same');
	expect(referenceComparison('rejected', votes(4, 6), 10)).toBe('same');
	expect(referenceComparison('passed', votes(4, 6), 10)).toBe('reversed');
	expect(referenceComparison('rejected', votes(6, 4), 10)).toBe('reversed');
	// 参考の票の同数は否決と同じ扱い
	expect(referenceComparison('passed', votes(5, 5), 10)).toBe('reversed');
	expect(referenceComparison('passed', votes(0, 9), 10)).toBeNull();
	expect(referenceComparison('lapsed', votes(10, 0), 10)).toBeNull();
});

test('Issue #71 基準8：段階は時刻を先に見る。会期が終わった法案だけ結果を使い、結果がなければ集計中', () => {
	expect(billStage('lapsed', 'passed')).toBe('passed');
	expect(billStage('lapsed', 'rejected')).toBe('rejected');
	expect(billStage('lapsed', 'lapsed')).toBe('lapsed');
	expect(billStage('lapsed', null)).toBe('counting');
	// 会期が終わる前に結果の行があっても可決と出さない
	for (const progress of ['draft', 'proposed', 'deliberation', 'vote'] as const) expect(billStage(progress, 'passed')).toBe(progress);
});
