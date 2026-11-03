// Issue #28 信頼の境界：通報の入力と、運営の操作の入力（設計書 docs/spec/28.md 決めたこと2・5）
import { expect, test } from 'vitest';
import { validateReport, validateSolutionAction, validateSolutionReport, validateStaffAction } from './reports';

test('通報：理由は4つか空（none）。説明は「その他」のときだけ受け取り、200字まで・制御文字なし', () => {
	expect(validateReport({ reason: 'attack', note: null })).toEqual({ ok: true, value: { reason: 'attack', note: null } });
	expect(validateReport({ reason: '', note: null })).toEqual({ ok: true, value: { reason: 'none', note: null } });
	expect(validateReport({ reason: null, note: null })).toEqual({ ok: true, value: { reason: 'none', note: null } });
	expect(validateReport({ reason: 'other', note: '  同じ人が\r\n何度も  ' })).toEqual({
		ok: true,
		value: { reason: 'other', note: '同じ人が\n何度も' }
	});
	expect(validateReport({ reason: 'other', note: '   ' })).toEqual({ ok: true, value: { reason: 'other', note: null } });
	expect(validateReport({ reason: 'other', note: 'あ'.repeat(200) }).ok).toBe(true);
	// その他以外の説明は捨てる
	expect(validateReport({ reason: 'spam', note: '説明' })).toEqual({ ok: true, value: { reason: 'spam', note: null } });

	for (const reason of ['none', 'ATTACK', 'hide', ' attack']) {
		expect(validateReport({ reason, note: null }), reason).toEqual({ ok: false });
	}
	for (const note of ['あ'.repeat(201), 'a\u0000b', 'a‮b']) {
		expect(validateReport({ reason: 'other', note }), note.slice(0, 5)).toEqual({ ok: false });
	}
});

test('運営の操作：課題の番号、非表示の理由（3つ）、メモ（1〜200字・制御文字なし）', () => {
	expect(validateStaffAction({ issue: '12', reason: 'spam', note: ' 宣伝のみ ' }, 'hide')).toEqual({
		ok: true,
		value: { issueId: 12, reason: 'spam', note: '宣伝のみ' }
	});
	expect(validateStaffAction({ issue: '12', reason: null, note: '問題なし\n確認済み' }, 'restore')).toEqual({
		ok: true,
		value: { issueId: 12, reason: null, note: '問題なし\n確認済み' }
	});

	const bad: [Parameters<typeof validateStaffAction>[0], 'hide' | 'restore'][] = [
		[{ issue: 'abc', reason: 'spam', note: 'メモ' }, 'hide'],
		[{ issue: '01', reason: 'spam', note: 'メモ' }, 'hide'],
		[{ issue: null, reason: 'spam', note: 'メモ' }, 'hide'],
		[{ issue: '1', reason: 'duplicate', note: 'メモ' }, 'hide'],
		[{ issue: '1', reason: '', note: 'メモ' }, 'hide'],
		[{ issue: '1', reason: null, note: 'メモ' }, 'hide'],
		[{ issue: '1', reason: 'spam', note: '' }, 'hide'],
		[{ issue: '1', reason: 'spam', note: 'あ'.repeat(201) }, 'hide'],
		[{ issue: '1', reason: 'spam', note: 'a\u0007b' }, 'hide'],
		[{ issue: '1', reason: null, note: '  ' }, 'restore'],
		[{ issue: '1', reason: null, note: 'a⁧b' }, 'restore']
	];
	for (const [raw, action] of bad) {
		expect(validateStaffAction(raw, action), JSON.stringify(raw)).toEqual({ ok: false });
	}
});

test('信頼の境界（Issue #30）：統合の操作は、課題の番号・統合先の番号・メモ', () => {
	expect(validateStaffAction({ issue: '3', target: '7', note: '同じ困りごと' }, 'merge')).toEqual({
		ok: true,
		value: { issueId: 3, targetId: 7, reason: null, note: '同じ困りごと' }
	});
	for (const target of [null, '', 'abc', '07', '0', '-1']) {
		expect(validateStaffAction({ issue: '3', target, note: 'メモ' }, 'merge'), String(target)).toEqual({ ok: false });
	}
	expect(validateStaffAction({ issue: '3', target: '7', note: '' }, 'merge')).toEqual({ ok: false });
	expect(validateStaffAction({ issue: 'x', target: '7', note: 'メモ' }, 'merge')).toEqual({ ok: false });
});

test('信頼の境界（Issue #36）：解決策の通報は、理由が3つか空（「同じ課題がほかにある」はない）', () => {
	expect(validateSolutionReport({ reason: 'spam', note: null })).toEqual({ ok: true, value: { reason: 'spam', note: null } });
	expect(validateSolutionReport({ reason: '', note: null })).toEqual({ ok: true, value: { reason: 'none', note: null } });
	expect(validateSolutionReport({ reason: 'other', note: ' 説明 ' })).toEqual({ ok: true, value: { reason: 'other', note: '説明' } });
	for (const reason of ['duplicate', 'none', 'ATTACK']) {
		expect(validateSolutionReport({ reason, note: null }), reason).toEqual({ ok: false });
	}
	expect(validateSolutionReport({ reason: 'other', note: 'あ'.repeat(201) })).toEqual({ ok: false });
});

test('信頼の境界（Issue #36）：解決策への運営の操作は、解決策の番号・理由（非表示のみ）・メモ', () => {
	expect(validateSolutionAction({ solution: '12', reason: 'attack', note: 'メモ' }, 'hide')).toEqual({
		ok: true,
		value: { solutionId: 12, reason: 'attack', note: 'メモ' }
	});
	expect(validateSolutionAction({ solution: '12', reason: null, note: '問題なし' }, 'restore')).toEqual({
		ok: true,
		value: { solutionId: 12, reason: null, note: '問題なし' }
	});
	for (const raw of [
		{ solution: 'abc', reason: 'spam', note: 'メモ' },
		{ solution: '012', reason: 'spam', note: 'メモ' },
		{ solution: null, reason: 'spam', note: 'メモ' },
		{ solution: '1', reason: 'duplicate', note: 'メモ' },
		{ solution: '1', reason: 'spam', note: '' },
		{ solution: '1', reason: 'spam', note: 'a\u0007b' }
	]) {
		expect(validateSolutionAction(raw, 'hide'), JSON.stringify(raw)).toEqual({ ok: false });
	}
});
