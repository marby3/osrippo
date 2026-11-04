// 質疑・答弁・補足と立場の決まり（Issue #66。設計書 docs/spec/66.md 決めたこと1〜3）。DB にも画面にも触れない
import type { BillProgress } from './bills';
import { checkText, type IssueError } from './issues';

export const POST_KINDS = ['question', 'answer', 'supplement'] as const;
export type PostKind = (typeof POST_KINDS)[number];
export const STANCES = ['for', 'against', 'undecided'] as const;
export type Stance = (typeof STANCES)[number];
/** 値は TypeScript で絞る（表には CHECK を付けない。#76 で共同提出者を足すため） */
export type PostRole = 'author' | 'supporter';

export const POST_MAX: Record<PostKind, number> = { question: 400, answer: 800, supplement: 400 };
export const QUESTION_PAGE_SIZE = 20;
/** 最初に選んだあとで変えられる回数 */
export const STANCE_CHANGES = 2;

/** 書ける時期：質疑と補足は3週目、答弁は3週目から採決の締切まで */
export const postWindowOpen = (kind: PostKind, progress: BillProgress) =>
	progress === 'deliberation' || (kind === 'answer' && progress === 'vote');

/** 立場を持てる時期：発議から会期末まで */
export const stanceOpen = (progress: BillProgress) => progress === 'proposed' || progress === 'deliberation' || progress === 'vote';

/** 答弁できる人の役割。ほかの人は null（補足を書ける） */
export function answererRole(bill: { userId: string }, userId: string | null, supporter: boolean): PostRole | null {
	if (userId === null) return null;
	if (bill.userId === userId) return 'author';
	return supporter ? 'supporter' : null;
}

/** 本文：前後の空白を除き、改行は \n にそろえて可 */
export function validatePost(kind: PostKind, raw: string | null): { ok: true; body: string } | { ok: false; error: IssueError } {
	const [body, error] = checkText(raw, POST_MAX[kind], true);
	return error ? { ok: false, error } : { ok: true, body };
}

/** 立場のフォームの値。形が違えば null（400） */
export const parseStance = (raw: string | null): Stance | null => ((STANCES as readonly string[]).includes(String(raw)) ? (raw as Stance) : null);
