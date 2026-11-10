// はじめての方へ：遊び方（Issue #131）。3画面（/asobikata・/asobikata/2・/asobikata/3）。ログインも DB も要らない。
// 日付は会期の決まりの値から作る（法案の書き方と同じ。決まりを変えても食い違わない）
import { error } from '@sveltejs/kit';
import { sessionDays } from '#lib/domain/session.ts';
import type { PageLoad } from './$types';

/** URL の段 → 何番目か（画面の href の逆。/asobikata・/asobikata/2・/asobikata/3） */
const STEP_OF: Record<string, 1 | 2 | 3> = { '': 1, '2': 2, '3': 3 };

export const load: PageLoad = ({ params }) => {
	// 1つめの画面の URL は /asobikata だけ（/asobikata/1 は 404）
	const step = STEP_OF[params.step ?? ''];
	if (step === undefined) error(404);
	return { step, ...sessionDays() };
};
