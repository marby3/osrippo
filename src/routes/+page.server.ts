// ホーム（Issue #44：今の会期）
import { env } from 'cloudflare:workers';
import { sessionAt, sessionMinutes } from '#lib/domain/session.ts';
import { nowOf } from '#lib/server/client.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	// 開発用の短い会期は pnpm dev のときだけ（ビルドしたサーバーでは import.meta.env.DEV が false）
	const session = sessionAt(nowOf(event), sessionMinutes(import.meta.env.DEV, env.SESSION_MINUTES));
	return { session };
};
