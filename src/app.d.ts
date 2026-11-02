// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { createAuth } from '#lib/server/auth.ts';

type Auth = ReturnType<typeof createAuth>;

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			/** 使うときに初めて作る（ログインの設定がなくても閲覧は動く） */
			auth: () => Auth;
			/** ログインしていなければ null */
			user: Auth['$Infer']['Session']['user'] | null;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	// 秘密の値の型は wrangler.jsonc の secrets.required から wrangler types が作る。
	// TEST_LOGIN はどこにも宣言しない（画面のテストのサーバーだけが --var で渡す）ので、ここで足す
	namespace Cloudflare {
		interface Env {
			/** 画面のテストのサーバーだけで "1"。テスト用のログインを有効にする（設計書 docs/spec/23.md） */
			TEST_LOGIN?: string;
		}
	}
}

export {};
