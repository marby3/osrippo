// Issue #157：議員・有識者の認証のルール（設計書 docs/spec/157.md の 2・3）
import { describe, expect, test } from 'vitest';
import { canVerify, isLegislator, parseVerification, verificationExpiry, verificationLastDay } from './verification';

const jst = (iso: string) => Date.parse(`${iso}+09:00`);

describe('基準3：期限は、付けた日・延ばした日の1年後の同じ日付の終わりまで（日本時間）', () => {
	test('2036年4月3日の朝に付けても夜に付けても、2037年4月4日 0時（日本時間）に切れ、「4月3日まで」', () => {
		for (const at of ['2036-04-03T00:00:00', '2036-04-03T09:00:00', '2036-04-03T23:59:59']) {
			expect(verificationExpiry(jst(at)), at).toBe(jst('2037-04-04T00:00:00'));
		}
		expect(verificationLastDay(jst('2037-04-04T00:00:00'))).toBe('2037-04-03');
	});

	test('UTC ではまだ前の日でも、日本時間の日付で数える', () => {
		// 2036-04-03 08:30 JST は UTC では 4月2日
		expect(verificationExpiry(jst('2036-04-03T08:30:00'))).toBe(jst('2037-04-04T00:00:00'));
	});

	test('2月29日に付けたら、翌年の2月28日まで', () => {
		expect(verificationExpiry(jst('2036-02-29T12:00:00'))).toBe(jst('2037-03-01T00:00:00'));
		expect(verificationLastDay(jst('2037-03-01T00:00:00'))).toBe('2037-02-28');
	});

	test('延ばすときは、延ばした日から1年（同じ式に延ばした時刻を入れる）', () => {
		expect(verificationExpiry(jst('2036-10-03T09:00:00'))).toBe(jst('2037-10-04T00:00:00'));
	});
});

describe('基準2：付けられるのは運営だけ', () => {
	test('運営だけ真。運営協力者、委員長、理事、役職なしは偽', () => {
		expect(canVerify('operator')).toBe(true);
		for (const role of ['moderator', 'chair', 'director', null] as const) expect(canVerify(role), String(role)).toBe(false);
	});
});

describe('基準1：入力の確かめ', () => {
	test('議員：表示する名前だけを使い、専門分野は入れても NULL', () => {
		expect(parseVerification({ kind: 'legislator', name: ' 試験 太郎 ', field: '民法' })).toEqual({ ok: true, value: { kind: 'legislator', name: '試験 太郎', field: null } });
	});

	test('有識者：専門分野が要る', () => {
		expect(parseVerification({ kind: 'expert', name: '大学教授', field: '消費者法' })).toEqual({ ok: true, value: { kind: 'expert', name: '大学教授', field: '消費者法' } });
		expect(parseVerification({ kind: 'expert', name: '大学教授', field: '' })).toEqual({ ok: false, error: 'fieldRequired' });
	});

	test('空の名前、41字の名前、改行、ほかの種類は断る', () => {
		expect(parseVerification({ kind: 'legislator', name: ' ', field: null })).toEqual({ ok: false, error: 'nameRequired' });
		expect(parseVerification({ kind: 'legislator', name: 'あ'.repeat(41), field: null })).toEqual({ ok: false, error: 'nameTooLong' });
		expect(parseVerification({ kind: 'legislator', name: 'あ'.repeat(40), field: null }).ok).toBe(true);
		expect(parseVerification({ kind: 'legislator', name: '試験\n太郎', field: null })).toEqual({ ok: false, error: 'nameInvalid' });
		expect(parseVerification({ kind: 'admin', name: '試験 太郎', field: null })).toEqual({ ok: false, error: 'kind' });
	});
});

describe('Issue #158：議員かどうか', () => {
	test('有効な認証の種類が議員のときだけ真。有識者と認証のない人は偽', () => {
		expect(isLegislator('legislator')).toBe(true);
		expect(isLegislator('expert')).toBe(false);
		expect(isLegislator(null)).toBe(false);
	});
});
