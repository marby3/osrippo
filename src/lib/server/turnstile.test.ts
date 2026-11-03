// Issue #25 信頼の境界：Turnstile のトークン（設計書 docs/spec/25.md 決めたこと8）
import { expect, test } from 'vitest';
import { verifyTurnstile } from './turnstile';

const respond = (body: object) => async () => new Response(JSON.stringify(body));

test('success が真で、hostname が自分のホストのときだけ通す。返らない・壊れた応答・空のトークンは通さない', async () => {
	const sent: FormData[] = [];
	const ok = async (_url: RequestInfo | URL, init?: RequestInit) => {
		sent.push(init?.body as FormData);
		return new Response(JSON.stringify({ success: true, hostname: 'osrippo.jp' }));
	};
	expect(await verifyTurnstile('token', 'secret', '203.0.113.7', 'osrippo.jp', ok)).toBe(true);
	expect(sent[0].get('secret')).toBe('secret');
	expect(sent[0].get('response')).toBe('token');
	expect(sent[0].get('remoteip')).toBe('203.0.113.7');

	expect(await verifyTurnstile('token', 'secret', 'ip', 'osrippo.jp', respond({ success: false }))).toBe(false);
	expect(await verifyTurnstile('token', 'secret', 'ip', 'osrippo.jp', respond({ success: true, hostname: 'evil.example' }))).toBe(false);
	expect(await verifyTurnstile('token', 'secret', 'ip', 'osrippo.jp', async () => new Response('not json'))).toBe(false);
	expect(await verifyTurnstile('token', 'secret', 'ip', 'osrippo.jp', async () => new Response('', { status: 500 }))).toBe(false);
	expect(await verifyTurnstile('token', 'secret', 'ip', 'osrippo.jp', () => Promise.reject(new Error('timeout')))).toBe(false);
	// 空・長すぎるトークンは問い合わせずに断る
	let called = false;
	const spy = async () => ((called = true), new Response('{"success":true,"hostname":"osrippo.jp"}'));
	expect(await verifyTurnstile('', 'secret', 'ip', 'osrippo.jp', spy)).toBe(false);
	expect(await verifyTurnstile('x'.repeat(2049), 'secret', 'ip', 'osrippo.jp', spy)).toBe(false);
	expect(called).toBe(false);
});
