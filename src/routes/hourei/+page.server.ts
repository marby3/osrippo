// 法律の一覧（Issue #85 決めたこと A）：委員会で扱う法令へのリンクだけを並べる
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { committeeLawList } from '#lib/server/law.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => ({ laws: await committeeLawList(drizzle(env.DB)) });
