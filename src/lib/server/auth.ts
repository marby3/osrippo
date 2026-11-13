// ログイン（設計書 docs/spec/23.md）。Workers では D1 が要求ごとに渡されるので、auth も要求ごとに作る
import { getRequestEvent } from '$app/server';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { APIError } from 'better-auth/api';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../db/schema';
import { pickDisplayName, profileToUser, withoutTokens } from '../domain/auth';
import { INVITE_REQUIRED, normalizeInviteCode } from '../domain/invites';
import { recordInviteUser, useInvite } from './invites';

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

/** 招待コードの Cookie の名前（ログインの画面で入れ、登録の hook で読む。設計書 docs/spec/199.md 決めたこと2・3） */
export const INVITE_COOKIE = 'invite';

/** 新規登録を断る（ログインの画面は error=invite_required で理由を出し分ける） */
const inviteRequired = () => new APIError('FORBIDDEN', { code: 'invite_required', message: 'invite required' });

/** 要求の外（getRequestEvent が投げる）なら null */
function currentEvent() {
	try {
		return getRequestEvent();
	} catch {
		return null;
	}
}

export function authOptions(env: AuthEnv) {
	const db = drizzle(env.DB, { schema });
	// 招待コードの読み書き（server/invites.ts は schema なしの Db を受け取る）
	const plain = drizzle(env.DB);
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
					before: async (data) => {
						// 招待コードを確かめて使い切る（docs/spec/199.md 決めたこと3）。新規登録のときだけ動く
						if (INVITE_REQUIRED) {
							const event = currentEvent();
							// 要求の外では登録しない。Cookie がない・空なら、更新の文を流さずに断る
							if (!event) throw inviteRequired();
							const code = normalizeInviteCode(event.cookies.get(INVITE_COOKIE) ?? '');
							if (!code || !(await useInvite(plain, code, Date.now()))) throw inviteRequired();
							// after は Cookie を読み直さず、ここで使い切ったコードに書く
							event.locals.invite = code;
						}
						return {
							data: {
								...data,
								// 提供元の画像は保存しない（mapProfileToUser でも外しているが、念のためここでも）
								image: null,
								// 表示名は「参加者」＋6桁。重なったら振り直す（docs/spec/23.md 決めたこと1）
								name: await pickDisplayName(async (name) =>
									Boolean(await db.query.user.findFirst({ where: eq(schema.user.name, name) }))
								)
							}
						};
					},
					after: async (created, ctx) => {
						const event = currentEvent();
						const code = event?.locals.invite;
						if (!event || !code) return;
						await recordInviteUser(plain, code, created.id);
						event.locals.invite = undefined;
						// 使ったコードの Cookie を消す。提供元から戻る経路の応答は Better Auth が作るので、そちらにも載せる
						event.cookies.delete(INVITE_COOKIE, { path: '/' });
						ctx?.setCookie(INVITE_COOKIE, '', { path: '/', maxAge: 0, httpOnly: true, secure: true, sameSite: 'lax' });
					}
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
