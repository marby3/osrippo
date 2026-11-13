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
import { AGREEMENT_VERSION, isCurrentAgreement } from '../domain/agreement';
import { INVITE_REQUIRED, normalizeInviteCode } from '../domain/invites';
import { recordAgreement } from './agreements';
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

/** β版のお約束への同意の Cookie の名前（ログインの画面で入れ、登録の hook で読む。Issue #200）。値は同意した版 */
export const AGREEMENT_COOKIE = 'agree';

/** 新規登録を断る（ログインの画面は error=invite_required で理由を出し分ける） */
const inviteRequired = () => new APIError('FORBIDDEN', { code: 'invite_required', message: 'invite required' });
/** お約束に同意していない新規登録を断る（error=agreement_required） */
const agreementRequired = () => new APIError('FORBIDDEN', { code: 'agreement_required', message: 'agreement required' });

/** 使い終わった Cookie を消す。提供元から戻る経路の応答は Better Auth が作るので、そちらにも載せる */
function clearCookie(
	event: NonNullable<ReturnType<typeof currentEvent>>,
	ctx: { setCookie: (name: string, value: string, options: Record<string, unknown>) => unknown } | null | undefined,
	name: string
) {
	event.cookies.delete(name, { path: '/' });
	ctx?.setCookie(name, '', { path: '/', maxAge: 0, httpOnly: true, secure: true, sameSite: 'lax' });
}

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
						// この hook は新規登録のときだけ動く。要求の外では登録しない
						const event = currentEvent();
						if (!event) throw agreementRequired();
						// β版のお約束への同意（Issue #200）。招待コードより先に確かめる（断ったときにコードを使い切らないように）
						if (!isCurrentAgreement(event.cookies.get(AGREEMENT_COOKIE))) throw agreementRequired();
						event.locals.agreement = AGREEMENT_VERSION;
						// 招待コードを確かめて使い切る（docs/spec/199.md 決めたこと3）
						if (INVITE_REQUIRED) {
							// Cookie がない・空なら、更新の文を流さずに断る
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
						if (!event) return;
						// 同意した版と日時を記録する（Issue #200）。after は Cookie を読み直さず、before で確かめた版を書く
						const version = event.locals.agreement;
						if (version) {
							await recordAgreement(plain, created.id, version, Date.now());
							event.locals.agreement = undefined;
							clearCookie(event, ctx, AGREEMENT_COOKIE);
						}
						const code = event.locals.invite;
						if (!code) return;
						await recordInviteUser(plain, code, created.id);
						event.locals.invite = undefined;
						// 使ったコードの Cookie を消す
						clearCookie(event, ctx, INVITE_COOKIE);
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
