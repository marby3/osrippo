// ホーム（Issue #44：今の会期）
import { sessionsOf } from '#lib/server/client.ts';
import type { PageServerLoad } from './$types';

// 開発用の短い会期は pnpm dev のときだけ（ビルドしたサーバーでは import.meta.env.DEV が false）
export const load: PageServerLoad = async (event) => ({ session: sessionsOf(event).session });
