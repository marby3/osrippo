// Issue #68 基準1・2・3・5・7・9 のルール（設計書 docs/spec/68.md 決めたこと1〜3・7・11・14）
import { expect, test } from 'vitest';
import { acceptOpen, adoptedAmendments, hasAmendableLaw, parseArticleKey, priorVoteRequirement, validateAmendmentBody, validateAmendmentReason } from './amendments';
import { checkAmendment, checkAmendmentSupport, COUNTS_AS_VIOLATION, DAY, LIMITS } from './limits';

const para = (text: string) => [{ num: '1', text, items: [] }] as never;

test('基準1：変えられる条のない法案（廃止だけの法案）には修正案がない', () => {
	expect(hasAmendableLaw([{ action: 'amend' }])).toBe(true);
	expect(hasAmendableLaw([{ action: 'enact' }])).toBe(true);
	expect(hasAmendableLaw([{ action: 'repeal' }, { action: 'amend' }])).toBe(true);
	expect(hasAmendableLaw([{ action: 'repeal' }])).toBe(false);
});

test('基準2：本文の形が違う、いまの本案と同じ、基にした条文と同じは断る。理由は任意で400字まで。条の値の形を確かめる', () => {
	const article = { current: para('いまの本文'), base: para('もとの本文') };
	expect(validateAmendmentBody('新しい本文', article)).toMatchObject({ ok: true });
	expect(validateAmendmentBody('', article)).toMatchObject({ ok: false, error: 'required' });
	expect(validateAmendmentBody('いまの本文', article)).toMatchObject({ ok: false, error: 'unchanged' });
	expect(validateAmendmentBody('もとの本文', article)).toMatchObject({ ok: false, error: 'sameAsBase' });
	// 制定の法案の条には基にした版がない
	expect(validateAmendmentBody('もとの本文', { current: para('いまの本文'), base: null })).toMatchObject({ ok: true });

	expect(validateAmendmentReason('')).toEqual({ ok: true, reason: null });
	expect(validateAmendmentReason('理由\n2行目')).toEqual({ ok: true, reason: '理由\n2行目' });
	expect(validateAmendmentReason('あ'.repeat(400))).toMatchObject({ ok: true });
	expect(validateAmendmentReason('あ'.repeat(401))).toMatchObject({ ok: false, error: 'tooLong' });

	expect(parseArticleKey('0:1')).toEqual({ lawSeq: 0, num: '1' });
	expect(parseArticleKey('4:3_2')).toEqual({ lawSeq: 4, num: '3_2' });
	for (const bad of ['', '1', 'a:1', '5:1', '0:', '0:a', '0:1:2', '-1:1']) expect(parseArticleKey(bad), bad).toBeNull();
});

test('基準3：取り込めるのは3週目で、採決の24時間前まで', () => {
	const voteAt = 100 * DAY;
	expect(acceptOpen('deliberation', voteAt - DAY - 1, voteAt)).toBe(true);
	expect(acceptOpen('deliberation', voteAt - DAY, voteAt)).toBe(false);
	expect(acceptOpen('proposed', 0, voteAt)).toBe(false);
	expect(acceptOpen('vote', voteAt, voteAt)).toBe(false);
});

test('基準5：要件は発議要件の半分の切り上げ（発議要件3なら2人）', () => {
	expect(priorVoteRequirement(0)).toBe(2);
	expect(priorVoteRequirement(60)).toBe(2);
	// 発議要件 5（100人の5%）→ 3人
	expect(priorVoteRequirement(100)).toBe(3);
	// 発議要件 6 → 3人
	expect(priorVoteRequirement(120)).toBe(3);
});

test('基準7：可決した修正案を古い順に見て、同じ条は先に出したほうを採る。否決と定足数に届かないものは採らない', () => {
	const results = [
		{ id: 1, lawSeq: 0, num: '1', outcome: 'rejected' as const },
		{ id: 2, lawSeq: 0, num: '1', outcome: 'passed' as const },
		{ id: 3, lawSeq: 0, num: '1', outcome: 'passed' as const },
		{ id: 4, lawSeq: 0, num: '2', outcome: 'passed' as const },
		// 同じ条の番号でも法令が違えば衝突しない
		{ id: 5, lawSeq: 1, num: '1', outcome: 'passed' as const },
		{ id: 6, lawSeq: 0, num: '3', outcome: 'lapsed' as const }
	];
	expect(Object.fromEntries(adoptedAmendments(results, []))).toEqual({ 1: 'failed', 2: 'passed', 3: 'superseded', 4: 'passed', 5: 'passed', 6: 'lapsed' });
	// すでに採った修正案の条は衝突する（途中で失敗してやり直したとき）
	expect(adoptedAmendments([{ id: 7, lawSeq: 0, num: '9', outcome: 'passed' }], [{ lawSeq: 0, num: '9' }]).get(7)).toBe('superseded');
});

test('基準9：修正案は24時間に5件、回線で20件。賛同は24時間に30回、5分に10回、同じ修正案に同じ回線から3アカウント。アカウントの上限は違反に数え、回線は数えない', () => {
	const post = { accountDay: 0, ipDay: 0 };
	const kind = (c: Partial<typeof post>) => checkAmendment({ ...post, ...c })?.kind ?? null;
	expect(LIMITS.amendmentPerDay).toBe(5);
	expect(LIMITS.amendmentPerIp).toBe(20);
	expect(kind({ accountDay: 4 })).toBeNull();
	expect(kind({ accountDay: 5 })).toBe('amendment-account');
	expect(kind({ ipDay: 19 })).toBeNull();
	expect(kind({ ipDay: 20 })).toBe('amendment-ip');
	expect(COUNTS_AS_VIOLATION['amendment-account']).toBe(true);
	expect(COUNTS_AS_VIOLATION['amendment-ip']).toBe(false);

	const ok = { op: 'add' as 'add' | 'remove', accountDay: 0, accountBurst: 0, otherAccountsOnIp: 0, selfAddedRecently: false };
	const support = (c: Partial<typeof ok>) => checkAmendmentSupport({ ...ok, ...c })?.kind ?? null;
	expect(support({ accountDay: 29 })).toBeNull();
	expect(support({ accountDay: 30 })).toBe('amendment-support-day');
	expect(support({ accountBurst: 9 })).toBeNull();
	expect(support({ accountBurst: 10 })).toBe('amendment-support-burst');
	expect(support({ otherAccountsOnIp: 2 })).toBeNull();
	expect(support({ otherAccountsOnIp: 3 })).toBe('amendment-support-ip');
	expect(support({ otherAccountsOnIp: 3, op: 'remove' })).toBeNull();
	expect(support({ otherAccountsOnIp: 3, selfAddedRecently: true })).toBeNull();
	expect(COUNTS_AS_VIOLATION['amendment-support-day']).toBe(true);
	expect(COUNTS_AS_VIOLATION['amendment-support-burst']).toBe(true);
	expect(COUNTS_AS_VIOLATION['amendment-support-ip']).toBe(false);
});
