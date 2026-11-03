// テスト用のログイン（設計書 docs/spec/23.md 決めたこと10）。画面のテストだけで使う
import { error } from '@sveltejs/kit';
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

	// testUtils は本番の auth には入れず、ここでだけ作る
	const options = authOptions(env);
	const auth = betterAuth({ ...options, plugins: [...options.plugins, testUtils()] });
	const { test } = await auth.$context;
	const db = drizzle(env.DB, { schema });
	const email = `test-${name}@test.invalid`;
	let found = await db.query.user.findFirst({ where: eq(schema.user.email, email) });
	if (!found) {
		// 表示名は名前そのまま（ふつうの登録の hook を通さない）
		const createdAt = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000);
		[found] = await db
			.insert(schema.user)
			.values({ id: crypto.randomUUID(), name, email, role, createdAt, updatedAt: createdAt })
			.returning();
	}
	const login = await test.login({ userId: found.id });
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
