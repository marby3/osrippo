// Issue #151：選挙期間のルール（基準1・2）
import { expect, test } from 'vitest';
import { electionPeriod, parseElection } from './election';

const jst = (s: string) => Date.parse(`${s}+09:00`);

test('基準2：公示日の 0時から投票日の終わりまで（日本時間）', () => {
	expect(electionPeriod('2045-05-10', '2045-05-20')).toEqual({ startsAt: jst('2045-05-10T00:00:00'), endsAt: jst('2045-05-21T00:00:00') });
	// 公示日と投票日が同じ日でも1日
	expect(electionPeriod('2045-05-10', '2045-05-10')).toEqual({ startsAt: jst('2045-05-10T00:00:00'), endsAt: jst('2045-05-11T00:00:00') });
});

test('基準1：名前と日付を確かめる。投票日が公示日より前、名前が空、ない日付は断る', () => {
	expect(parseElection({ name: ' 第99回衆議院議員総選挙 ', notice: '2045-05-10', vote: '2045-05-20' })).toEqual({
		ok: true,
		value: { name: '第99回衆議院議員総選挙', notice: '2045-05-10', vote: '2045-05-20' }
	});
	expect(parseElection({ name: '', notice: '2045-05-10', vote: '2045-05-20' })).toEqual({ ok: false, error: 'nameRequired' });
	expect(parseElection({ name: '選挙', notice: '2045-05-20', vote: '2045-05-10' })).toEqual({ ok: false, error: 'order' });
	for (const bad of ['2045-02-30', '2045/05/10', '', '20450510']) expect(parseElection({ name: '選挙', notice: bad, vote: '2045-05-20' }), bad).toEqual({ ok: false, error: 'date' });
});
