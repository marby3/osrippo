// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { createAuth } from '#lib/server/auth.ts';

type Auth = ReturnType<typeof createAuth>;

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			auth: Auth;
			/** ログインしていなければ null */
			user: Auth['$Infer']['Session']['user'] | null;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	// 秘密の値は wrangler secret（手元は .dev.vars、画面のテストは --var）なので、
	// wrangler types が作る型には入らない。ここで足す（設計書 docs/spec/23.md）
	namespace Cloudflare {
		interface Env {
			BETTER_AUTH_URL: string;
			BETTER_AUTH_SECRET: string;
			GOOGLE_CLIENT_ID: string;
			GOOGLE_CLIENT_SECRET: string;
			LINE_CLIENT_ID: string;
			LINE_CLIENT_SECRET: string;
			/** 画面のテストのサーバーだけで "1"。テスト用のログインを有効にする */
			TEST_LOGIN?: string;
		}
	}
}

export {};
