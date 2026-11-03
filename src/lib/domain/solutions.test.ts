// Issue #34 信頼の境界：解決策の本文（設計書 docs/spec/34.md 決めたこと1）
import { expect, test } from 'vitest';
import { validateSolution } from './solutions';

test('本文は前後の空白を除いて1〜400字、改行は \\n にそろえて使える。制御文字と文字の向きを変える文字は断る', () => {
	expect(validateSolution('  路面に色で示す。\r\n標識も足す。 ')).toEqual({ ok: true, body: '路面に色で示す。\n標識も足す。' });
	expect(validateSolution('あ'.repeat(400)).ok).toBe(true);
	expect(validateSolution('😀'.repeat(400)).ok).toBe(true);
	expect(validateSolution(null)).toEqual({ ok: false, error: 'required' });
	expect(validateSolution(' \n ')).toEqual({ ok: false, error: 'required' });
	expect(validateSolution('あ'.repeat(401))).toEqual({ ok: false, error: 'tooLong' });
	expect(validateSolution('a\u0000b')).toEqual({ ok: false, error: 'control' });
	expect(validateSolution('a\u202eb')).toEqual({ ok: false, error: 'control' });
});
