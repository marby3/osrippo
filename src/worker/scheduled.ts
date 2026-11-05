// Cron の入口（設計書 docs/spec/71.md 決めたこと3・4）。Vite を通らず wrangler が束ねるので、
// ここから読むものは cloudflare:workers、import.meta.env、#lib に頼らない
import { drizzle } from 'drizzle-orm/d1';
import type { BatchDb } from '../lib/server/law';
import { runSessionEnd } from '../lib/server/results';

export async function scheduled(controller: ScheduledController, env: Env): Promise<void> {
	await runSessionEnd(drizzle(env.DB) as unknown as BatchDb, controller.scheduledTime);
}
