// テスト用のログイン（設計書 docs/spec/23.md 決めたこと10）。画面のテストだけで使う
import { error, redirect } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { betterAuth } from 'better-auth';
import { testUtils } from 'better-auth/plugins';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '#lib/db/schema.ts';
import { safeNext } from '#lib/domain/auth.ts';
import { authOptions } from '#lib/server/auth.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, cookies }) => {
	// 動く条件は2つとも：TEST_LOGIN が "1"、要求のホストが localhost か 127.0.0.1
	if (env.TEST_LOGIN !== '1' || !['localhost', '127.0.0.1'].includes(url.hostname)) error(404);
	const name = url.searchParams.get('name') ?? '';
	if (!/^[A-Za-z0-9-]{1,32}$/.test(name)) error(400);
	// 登録した日を何日前にするか（0〜365。新しいアカウントの制限を避ける。docs/spec/25.md 決めたこと15）
	const days = url.searchParams.get('days') ?? '0';
	if (!/^(?:0|[1-9]\d{0,2})$/.test(days) || Number(days) > 365) error(400);
	// 運営・運営協力者にする（省略すると役職なし。docs/spec/28.md 決めたこと7）
	const role = url.searchParams.get('role');
	if (role !== null && role !== 'moderator' && role !== 'operator') error(400);
	// 新規登録の経路（docs/spec/199.md 決めたこと6）。Better Auth の user.create の hook を通す。役職は付けない
	const signup = url.searchParams.get('signup');
	if (signup !== null && (signup !== '1' || role !== null)) error(400);

	// testUtils は本番の auth には入れず、ここでだけ作る
	const options = authOptions(env);
	const auth = betterAuth({ ...options, plugins: [...options.plugins, testUtils()] });
	const { test } = await auth.$context;
	const db = drizzle(env.DB, { schema });
	const email = `test-${name}@test.invalid`;
	const found = await db.query.user.findFirst({ where: eq(schema.user.email, email) });
	const createdAt = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000);
	let userId = found?.id;
	if (!userId && signup) {
		// hook が招待コードを確かめて使い切る。断ったら、本物の提供元から戻ったときと同じ画面へ
		try {
			userId = (await test.saveUser({ id: crypto.randomUUID(), email, name, emailVerified: false, createdAt, updatedAt: createdAt })).id;
		} catch (e) {
			const code = (e as { body?: { code?: unknown } } | null)?.body?.code;
			if (code === 'invite_required') redirect(303, '/login?error=invite_required');
			throw e;
		}
	} else if (!userId) {
		// 表示名は名前そのまま（ふつうの登録の hook を通さない）
		[{ id: userId }] = await db
			.insert(schema.user)
			.values({ id: crypto.randomUUID(), name, email, role, createdAt, updatedAt: createdAt })
			.returning({ id: schema.user.id });
	}
	const login = await test.login({ userId });
	for (const c of login.cookies) {
		cookies.set(c.name, c.value, {
			path: c.path,
			httpOnly: c.httpOnly,
			secure: c.secure,
			sameSite: c.sameSite ? (c.sameSite.toLowerCase() as 'lax' | 'strict' | 'none') : 'lax',
			// testUtils の expires は秒（Playwright の Cookie と同じ形式）
			expires: c.expires ? new Date(c.expires * 1000) : undefined,
			// Better Auth の署名付きの値をそのまま書く（既定の URL エンコードで値が変わらないように）
			encode: (v) => v
		});
	}
	return { name, next: safeNext(url.searchParams.get('next'), url.origin) };
};
