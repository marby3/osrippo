// Issue #25 基準9：IP はそのまま保存せず、秘密の値を使ったハッシュだけを保存する。IPv6 は /64 でまとめる
import { expect, test } from 'vitest';
import { hashIp, normalizeIp } from './ip';

test.each([
	['203.0.113.7', '203.0.113.7'],
	['2001:db8:1:2:3:4:5:6', '2001:0db8:0001:0002::/64'],
	['2001:DB8:1:2::9', '2001:0db8:0001:0002::/64'],
	['2001:db8::1', '2001:0db8:0000:0000::/64'],
	['::1', '0000:0000:0000:0000::/64'],
	['::ffff:203.0.113.7', '203.0.113.7'],
	['::FFFF:cb00:7107', '203.0.113.7']
])('%s → %s', (ip, expected) => {
	expect(normalizeIp(ip)).toBe(expected);
});

test('基準9：秘密の値を使ったハッシュになり、同じ /64 は同じ値、秘密の値が違えば別の値', async () => {
	const a = await hashIp('secret-a', '2001:db8:1:2:aaaa::1');
	expect(a).toMatch(/^[0-9a-f]{64}$/);
	expect(a).not.toContain('2001');
	expect(await hashIp('secret-a', '2001:db8:1:2:bbbb::2')).toBe(a);
	expect(await hashIp('secret-a', '2001:db8:1:3::1')).not.toBe(a);
	expect(await hashIp('secret-b', '2001:db8:1:2:aaaa::1')).not.toBe(a);
	expect(await hashIp('secret-a', '203.0.113.7')).toBe(await hashIp('secret-a', '::ffff:203.0.113.7'));
});
