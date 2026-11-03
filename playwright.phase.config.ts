import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// 締めのテストは1つずつ回す。phase3 は時刻を進めて会期を切り替えるので、2つの幅が同時に走ると混ざる（Issue #41）
export default defineConfig({ ...base, testIgnore: undefined, testMatch: '**/phase*.spec.ts', workers: 1 });
