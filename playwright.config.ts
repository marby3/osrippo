import { defineConfig, devices } from '@playwright/test';

// スマホ（390px）とPC（1280px）の2幅で回す
export default defineConfig({
	testDir: 'e2e',
	// フェーズの締めのテストは test:phase で回す（playwright.phase.config.ts）
	testIgnore: '**/phase*.spec.ts',
	// 1つ目：テスト用のログインを有効にしたサーバー。TEST_LOGIN のないサーバーを誤って使わないよう、再利用しない
	// 2つ目：テスト用のログインが無効なサーバー（404 を確かめる）。1つ目のビルドを使い、D1 は別に持つ（Issue #17）
	// Playwright は webServer を順に起動する（1つ目のポートが開いてから2つ目）ので、ビルドは済んでいる
	webServer: [
		{ command: 'pnpm db:reset && pnpm build && pnpm preview:test', port: 4173, reuseExistingServer: false },
		{ command: 'pnpm preview:nologin', port: 4174, reuseExistingServer: false }
	],
	use: { baseURL: 'http://localhost:4173' },
	projects: [
		{ name: 'sp', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } },
		{ name: 'pc', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } }
	]
});
