// ホーム（Issue #44：今の会期）
import { nowOf, sessionsAt } from '#lib/server/client.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => ({ session: sessionsAt(nowOf(event)).session });
