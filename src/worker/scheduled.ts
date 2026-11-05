// Cron の入口（設計書 docs/spec/71.md 決めたこと3・4）。Vite を通らず wrangler が束ねるので、
// ここから読むものは cloudflare:workers、import.meta.env、#lib に頼らない
import { drizzle } from 'drizzle-orm/d1';
import { sessionAt } from '../lib/domain/session';
import type { BatchDb } from '../lib/server/law';
import { settleSession } from '../lib/server/results';

export async function scheduled(controller: ScheduledController, env: Env): Promise<void> {
	const now = controller.scheduledTime;
	// 分の会期は pnpm dev だけの機能で、Cron がない
	const session = sessionAt(now, null);
	const previous = sessionAt(session.startsAt - 1, null);
	await settleSession(drizzle(env.DB) as unknown as BatchDb, previous, sessionAt(previous.startsAt - 1, null), now, null);
}
