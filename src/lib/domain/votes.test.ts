// Issue #65 基準3・4：定足数と可決の判定（設計書 docs/spec/65.md 決めたこと3・4）
import { expect, test } from 'vitest';
import { billOutcome, quorumRequirement } from './votes';

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
