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
			/** 表示の設定（Cookie から。Issue #129） */
			display: import('#lib/domain/display.ts').Display;
			/** この要求の登録で使い切った招待コード（user.create の before が入れ、after が読む。docs/spec/199.md 決めたこと3） */
			invite?: string;
			/** この要求の登録で同意を確かめたお約束の版（user.create の before が入れ、after が記録する。Issue #200） */
			agreement?: string;
		}
		interface PageData {
			/** IF世界の帯を出すページ。帯はメニューより上に出すので、ページの load が返し、全体の枠が出す（Issue #85） */
			ifBand?: true;
			/** スマホで画面の下に留める帯があるページ（タブの上の「＋課題を書く」#120、タブを隠した書く画面の段のボタン #121）。全体の枠がその分を空ける */
			spBottomBar?: true;
			/** 本文の「特商法9条」を条へのリンクにする表（Issue #165）。課題・解決策・質疑などの本文を出すページの load が返し、LawRefText が使う */
			lawRefs?: import('#lib/domain/law/refs.ts').LawRefIndex;
		}
		// interface PageState {}
		// interface Platform {}
	}

	// 秘密の値の型は wrangler.jsonc の secrets.required から wrangler types が作る。
	// 本番の vars にない値（TEST_LOGIN は画面のテストのサーバーが --var で、NOINDEX はステージングの vars で渡す）は、ここで足す
	namespace Cloudflare {
		interface Env {
			/** 画面のテストのサーバーだけで "1"。テスト用のログインを有効にする（設計書 docs/spec/23.md） */
			TEST_LOGIN?: string;
			/** pnpm dev のときだけ使う、開発用の短い会期の分数（1〜1440。Issue #44）。ビルドしたサーバーでは使わない */
			SESSION_MINUTES?: string;
			/** ステージングだけで "1"。Worker の入口で、すべての応答に X-Robots-Tag: noindex, nofollow を付ける（Issue #156。src/worker/fetch.ts） */
			NOINDEX?: string;
			/**
			 * 公開ミラーの書き出しの入口（/mirror）のトークン（Issue #155。docs/mirror.md）。wrangler secret put で入れる。
			 * 書き出しを使わない環境では入れなくてよいので、secrets.required に入れない（ないときは入口が 401 だけを返す）
			 */
			MIRROR_TOKEN?: string;
		}
	}
}

export {};
