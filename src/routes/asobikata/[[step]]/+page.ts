// はじめての方へ：遊び方（Issue #131）。3画面（/asobikata・/asobikata/2・/asobikata/3）。ログインも DB も要らない。
// 日付は会期の決まりの値から作る（法案の書き方と同じ。決まりを変えても食い違わない）
import { error } from '@sveltejs/kit';
import { sessionDays } from '#lib/domain/session.ts';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => {
	// 1つめの画面の URL は /asobikata だけ（/asobikata/1 は 404）
	const step = params.step === undefined ? 1 : params.step === '2' ? 2 : params.step === '3' ? 3 : null;
	if (step === null) error(404);
	return { step, ...sessionDays() };
};
