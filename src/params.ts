// URL の区切りの形（SvelteKit の params matcher）
import { defineParams } from '@sveltejs/kit/params';
import { isArticleNum } from './lib/domain/law/display.ts';

export const params = defineParams({
	/** 条の番号（`9`、`3_2`）。`/hourei/[lawId]/kiroku`・`hikaku` とぶつからず、形の違う番号は 404 にする（Issue #164） */
	articleNum: (param) => (isArticleNum(param) ? param : undefined)
});
