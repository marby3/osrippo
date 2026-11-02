// Issue #23 ログイン：戻り先の判定、プロフィールから作る利用者、トークンを残さない
import { describe, expect, test } from 'vitest';
import { pickDisplayName, profileToUser, safeNext, withoutTokens } from './auth';

const ORIGIN = 'http://localhost:4173';

describe('基準4：safeNext は自サイトの中だけに戻す', () => {
	test.each([
		['/watashi', '/watashi'],
		['/kadai/new?step=2#top', '/kadai/new?step=2#top'],
		[null, '/'],
		['', '/'],
		['watashi', '/'],
		['//evil.example', '/'],
		['/\\evil.example', '/'],
		['https://evil.example', '/'],
		['/\t/evil.example', '/'],
		['/a\nb', '/'],
		['http://localhost:4173.evil.example/', '/'],
		// 解決すると . や .. が消えて // が現れるもの
		['/.//evil.example', '/'],
		['/a/..//evil.example', '/'],
		['/./\\evil.example', '/']
	])('%j → %j', (next, expected) => {
		expect(safeNext(next, ORIGIN)).toBe(expected);
	});
});

test('基準5：プロフィールの名前・メール・画像は使わず、表示名は「参加者」＋6桁で、重なったら振り直す', async () => {
	const google = profileToUser('google', {
		sub: '1234567890',
		name: '山田太郎',
		email: 'taro@example.com',
		picture: 'https://example.com/me.jpg'
	});
	expect(google.email).toBe('google-1234567890@users.invalid');
	// Better Auth は提供元の画像のあとにこの値を重ねるので、キーを持って undefined にすれば画像は残らない
	expect('image' in google && google.image === undefined).toBe(true);
	expect(JSON.stringify(google)).not.toContain('山田');
	expect(profileToUser('line', { sub: 'U4af4980629' }).email).toBe('line-U4af4980629@users.invalid');

	// 最初の2回は既にある表示名と重なったことにする
	const checked: string[] = [];
	const draws = [0.1, 0.5, 0.9];
	const name = await pickDisplayName(
		async (n) => (checked.push(n), checked.length <= 2),
		() => draws.shift()!
	);
	expect(checked).toHaveLength(3);
	expect(name).toBe(checked[2]);
	for (const n of checked) expect(n).toMatch(/^参加者[1-9]\d{5}$/);
	expect(new Set(checked).size).toBe(3);
});

test('基準6：提供元のトークン類を保存しない', () => {
	const account = withoutTokens({
		providerId: 'google',
		accountId: '1234567890',
		accessToken: 'at',
		refreshToken: 'rt',
		idToken: 'eyJ...',
		accessTokenExpiresAt: new Date(),
		refreshTokenExpiresAt: new Date(),
		scope: 'openid'
	});
	expect(account).toMatchObject({
		providerId: 'google',
		accountId: '1234567890',
		accessToken: null,
		refreshToken: null,
		idToken: null,
		accessTokenExpiresAt: null,
		refreshTokenExpiresAt: null
	});
});
