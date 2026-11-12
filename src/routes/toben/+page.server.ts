// 答弁イベントの一覧（Issue #153）。だれでも見られる
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { nowOf } from '#lib/server/client.ts';
import { tobenList } from '#lib/server/toben.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => ({ list: await tobenList(drizzle(env.DB), nowOf(event)) });
