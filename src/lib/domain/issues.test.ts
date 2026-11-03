// Issue #25 信頼の境界：課題の入力の判定（設計書 docs/spec/25.md 決めたこと2）
import { expect, test } from 'vitest';
import { validateIssue } from './issues';

const TOPIC = 1;
const ok = { title: '定期購入の解約ができない', affected: '通販で申し込んだ人', example: '1回だけのつもりが\n毎月届く', topic: '1' };

test('形の正しい入力は、前後の空白を除き、改行を \\n にそろえて受け付ける', () => {
	expect(validateIssue({ ...ok, title: '  ' + ok.title + '　', example: 'a\r\nb\rc' }, TOPIC)).toEqual({
		ok: true,
		value: { title: ok.title, affected: ok.affected, example: 'a\nb\nc', topicId: 1 }
	});
	expect(validateIssue({ ...ok, topic: 'none' }, TOPIC)).toMatchObject({ ok: true, value: { topicId: null } });
	// 文字数はコードポイントで数える（絵文字1つで1字）
	expect(validateIssue({ ...ok, title: '😀'.repeat(60) }, TOPIC).ok).toBe(true);
	// ゼロ幅接合子（絵文字の組み合わせ）は許す
	expect(validateIssue({ ...ok, title: '👨‍👩‍👧' }, TOPIC).ok).toBe(true);
});

test.each([
	['title', '', 'required'],
	['title', '   ', 'required'],
	['title', null, 'required'],
	['title', 'あ'.repeat(61), 'tooLong'],
	['title', 'a\nb', 'newline'],
	['title', 'a\u0007b', 'control'],
	['title', 'a‮b', 'control'],
	['title', 'a⁦b', 'control'],
	['affected', '', 'required'],
	['affected', 'あ'.repeat(61), 'tooLong'],
	['affected', 'a\r\nb', 'newline'],
	['affected', 'a\u0000b', 'control'],
	['example', '', 'required'],
	['example', 'あ'.repeat(401), 'tooLong'],
	['example', 'a\u0008b', 'control'],
	['example', 'a‭b', 'control'],
	['topic', '', 'invalid'],
	['topic', null, 'invalid'],
	['topic', '2', 'invalid'],
	['topic', '01', 'invalid'],
	['topic', 'current', 'invalid']
] as const)('%s=%j は %s', (field, value, error) => {
	const result = validateIssue({ ...ok, [field]: value }, TOPIC);
	expect(result).toEqual({ ok: false, errors: { [field]: error } });
});

test('お題がないとき（今回のお題が決まっていない）は、ほかの話題だけを受け付ける', () => {
	expect(validateIssue({ ...ok, topic: '1' }, null)).toEqual({ ok: false, errors: { topic: 'invalid' } });
	expect(validateIssue({ ...ok, topic: 'none' }, null).ok).toBe(true);
});
