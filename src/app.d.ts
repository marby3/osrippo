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
		interface PageData {
			/** IF世界の帯を出すページ。帯はメニューより上に出すので、ページの load が返し、全体の枠が出す（Issue #85） */
			ifBand?: true;
			/** スマホで画面の下に留める帯があるページ（タブの上の「＋課題を書く」#120、タブを隠した書く画面の段のボタン #121）。全体の枠がその分を空ける */
			spBottomBar?: true;
		}
		// interface PageState {}
		// interface Platform {}
	}

	// 秘密の値の型は wrangler.jsonc の secrets.required から wrangler types が作る。
	// TEST_LOGIN はどこにも宣言しない（画面のテストのサーバーだけが --var で渡す）ので、ここで足す
	namespace Cloudflare {
		interface Env {
			/** 画面のテストのサーバーだけで "1"。テスト用のログインを有効にする（設計書 docs/spec/23.md） */
			TEST_LOGIN?: string;
			/** pnpm dev のときだけ使う、開発用の短い会期の分数（1〜1440。Issue #44）。ビルドしたサーバーでは使わない */
			SESSION_MINUTES?: string;
		}
	}
}

export {};
