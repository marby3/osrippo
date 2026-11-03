// ログイン（設計書 docs/spec/23.md）。Workers では D1 が要求ごとに渡されるので、auth も要求ごとに作る
import { getRequestEvent } from '$app/server';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../db/schema';
import { pickDisplayName, profileToUser, withoutTokens } from '../domain/auth';

/** ログインに要る環境変数（秘密の値は wrangler secret、手元は .dev.vars、画面のテストは --var） */
export type AuthEnv = {
	DB: D1Database;
	BETTER_AUTH_URL: string;
	BETTER_AUTH_SECRET: string;
	GOOGLE_CLIENT_ID: string;
	GOOGLE_CLIENT_SECRET: string;
	LINE_CLIENT_ID: string;
	LINE_CLIENT_SECRET: string;
};

export function authOptions(env: AuthEnv) {
	const db = drizzle(env.DB, { schema });
	return {
		baseURL: env.BETTER_AUTH_URL,
		secret: env.BETTER_AUTH_SECRET,
		trustedOrigins: [env.BETTER_AUTH_URL],
		database: drizzleAdapter(db, {
			provider: 'sqlite',
			schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification }
		}),
		socialProviders: {
			google: {
				clientId: env.GOOGLE_CLIENT_ID,
				clientSecret: env.GOOGLE_CLIENT_SECRET,
				mapProfileToUser: (profile) => profileToUser('google', profile)
			},
			line: {
				clientId: env.LINE_CLIENT_ID,
				clientSecret: env.LINE_CLIENT_SECRET,
				mapProfileToUser: (profile) => profileToUser('line', profile)
			}
		},
		// form action などサーバーから auth.api を呼んだときも、Better Auth の Cookie（OAuth の state、セッション）を応答に載せる
		plugins: [sveltekitCookies(getRequestEvent)],
		// Google と LINE を自動では結び付けない（決めたこと3）
		account: { accountLinking: { enabled: false } },
		// セッションに生の IP を保存しない（docs/spec/25.md 基準9。荒らし対策の数えはハッシュで別に持つ）
		advanced: { ipAddress: { disableIpTracking: true } },
		databaseHooks: {
			user: {
				create: {
					// 表示名は「参加者」＋6桁。重なったら振り直す（決めたこと1）
					before: async (data) => ({
						data: {
							...data,
							// 提供元の画像は保存しない（mapProfileToUser でも外しているが、念のためここでも）
							image: null,
							name: await pickDisplayName(async (name) =>
								Boolean(await db.query.user.findFirst({ where: eq(schema.user.name, name) }))
							)
						}
					})
				}
			},
			account: {
				create: { before: async (data) => ({ data: withoutTokens(data) }) },
				update: { before: async (data) => ({ data: withoutTokens(data) }) }
			}
		}
	} satisfies BetterAuthOptions;
}

export function createAuth(env: AuthEnv) {
	return betterAuth(authOptions(env));
}

/** セッションの Cookie があるか（ないときは D1 を引かない） */
export const hasSessionCookie = (cookieHeader: string | null) =>
	/(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=/.test(cookieHeader ?? '');
