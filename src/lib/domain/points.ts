// 質疑の論点と「いまの場面」（Issue #168）。DB にも画面にも触れない純粋な関数
import type { BillProgress } from './bills';
import { checkText, parseIssueId, type IssueError } from './issues';
import type { Session } from './session';

/** 論点の見出しの字数の上限 */
export const POINT_TITLE_MAX = 60;

/** 見出しを確かめる：空、改行、制御文字、長すぎる */
export function checkPointTitle(raw: string | null | undefined): { ok: true; title: string } | { ok: false; error: IssueError } {
	const [title, error] = checkText(raw, POINT_TITLE_MAX, false);
	return error ? { ok: false, error } : { ok: true, title };
}

/** 法案の中の論点の番号（論点1、論点2）。1から始まる整数だけ */
export const parsePointNo = (raw: string | null | undefined) => parseIssueId(raw ?? '');

/** 論点を立てて閉じられる時期：発議から採決の締切まで */
export const pointWindowOpen = (progress: BillProgress) => progress === 'proposed' || progress === 'deliberation' || progress === 'vote';

export type Scene = { week: 1 | 2 | 3 | 4 | null; stage: Session['stage'] } | null;

/**
 * 法案のいまの場面。質疑と修正は3週目、採決は4週目。発議の段は、付託先の会期に入っていればその週（1週目か2週目）を出し、
 * 締切のあとの発議で次の会期を待っているあいだは週を出さない。採決の締切のあと（廃案・撤回）は null（画面は法案の段を出す）
 */
export function sceneOf(progress: BillProgress, referral: Session, now: Session): Scene {
	if (progress === 'deliberation') return { week: 3, stage: 'deliberation' };
	if (progress === 'vote') return { week: 4, stage: 'vote' };
	if (progress === 'proposed') return { week: now.key === referral.key ? now.week : null, stage: 'proposal' };
	return null;
}
