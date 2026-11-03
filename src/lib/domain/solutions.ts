// 解決策の判定（設計書 docs/spec/34.md 決めたこと1・5）
import { checkText, type IssueError } from './issues';

export const SOLUTION_MAX = 400;
export const REACTIONS = ['support', 'changed'] as const;
export type Reaction = (typeof REACTIONS)[number];

/** 本文：課題の具体例と同じ判定（前後の空白を除き、改行は \n にそろえて可、1〜400字、制御文字なし） */
export function validateSolution(raw: string | null): { ok: true; body: string } | { ok: false; error: IssueError } {
	const [body, error] = checkText(raw, SOLUTION_MAX, true);
	return error ? { ok: false, error } : { ok: true, body };
}

/** 「わかる」「考えが変わった」のフォームの値。形が違えば null（400） */
export function parseReaction(raw: {
	solution: string | null;
	kind: string | null;
	op: string | null;
}): { solutionId: number; kind: Reaction; op: 'add' | 'remove' } | null {
	if (raw.solution === null || !/^[1-9]\d{0,9}$/.test(raw.solution)) return null;
	if (raw.kind !== 'support' && raw.kind !== 'changed') return null;
	if (raw.op !== 'add' && raw.op !== 'remove') return null;
	return { solutionId: Number(raw.solution), kind: raw.kind, op: raw.op };
}
