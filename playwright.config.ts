import { defineConfig, devices } from '@playwright/test';

// スマホ（390px）とPC（1280px）の2幅で回す
export default defineConfig({
	testDir: 'e2e',
	// フェーズの締めのテストは test:phase で回す（playwright.phase.config.ts）
	testIgnore: '**/phase*.spec.ts',
	webServer: { command: 'pnpm db:reset && pnpm build && pnpm preview', port: 4173, reuseExistingServer: !process.env.CI },
	use: { baseURL: 'http://localhost:4173' },
	projects: [
		{ name: 'sp', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } },
		{ name: 'pc', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } }
	]
});
