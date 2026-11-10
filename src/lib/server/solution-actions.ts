// 解決策の「わかる」「考えが変わった」の操作（設計書 docs/spec/34.md 決めたこと5）。課題のページと解決策の一覧で同じ処理を使う
import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { ja } from '../copy/ja';
import { parseIssueId } from '../domain/issues';
import { isHidden, validateSolutionReport } from '../domain/reports';
import { parseReaction } from '../domain/solutions';
import { nowOf, refusalMessage, writeGuard } from './client';
import { issueMeta } from './issues';
import { react, reportSolution, solutionMeta } from './solutions';

/** back はログインしていなかったときに戻るパス */
export async function reactAction(event: RequestEvent<{ id: string }>, back: (id: number) => string) {
	// 課題の番号と課題があるか（ログインより先）→ ログイン → 国 → 締め出し → 入力 → 課題の状態 → 自分の解決策 → 保存
	const id = parseIssueId(event.params.id);
	if (id === null) error(404);
	const db = drizzle(env.DB);
	const meta = await issueMeta(db, id);
	if (!meta) error(404);
	const user = event.locals.user;
	if (!user) redirect(303, `/login?next=${encodeURIComponent(back(id))}`);
	const now = nowOf(event);
	const form = await event.request.formData();
	const field = (name: string) => (form.has(name) ? String(form.get(name)) : null);
	const raw = field('solution');
	const guard = await writeGuard(event, db, user, now, 'participate');
	if (!guard.ok) return fail(guard.failure.status, { ...guard.failure.data, solution: parseIssueId(raw ?? '') });
	const input = parseReaction({ solution: raw, kind: field('kind'), op: field('op') });
	if (!input) error(400);
	// その課題の解決策でなければ 404（統合したあとは解決策が統合先へ移っているので、元の課題への操作もここで止まる）
	const solution = await solutionMeta(db, input.solutionId);
	if (!solution || solution.issueId !== id) error(404);
	// 断った理由は、押した解決策のところに出す（solution で見分ける）
	const solutionId = input.solutionId;
	if (meta.status === 'merged') return fail(403, { message: ja.merge.mergedOp, solution: solutionId });
	if (isHidden(meta.status)) return fail(403, { message: ja.report.hiddenIssue, solution: solutionId });
	if (isHidden(solution.status)) return fail(403, { message: ja.solution.hiddenOp, solution: solutionId });
	if (solution.userId === user.id) return fail(403, { message: ja.solution.ownSolution, solution: solutionId });

	const result = await react(db, guard.actor, solutionId, input.kind, input.op, now);
	if (!result.ok) return fail(429, { message: refusalMessage(result.refusal), solution: solutionId });
	return { reacted: input.solutionId };
}

/** 解決策の通報（設計書 docs/spec/36.md 決めたこと2）。back はログインしていなかったときに戻るパス */
export async function reportSolutionAction(event: RequestEvent<{ id: string }>, back: (id: number) => string) {
	// 課題の番号と課題があるか（ログインより先）→ ログイン → 国 → 締め出し → 入力 → 自分の解決策 → 状態 → 2回目か → レート制限 → 保存
	const id = parseIssueId(event.params.id);
	if (id === null) error(404);
	const db = drizzle(env.DB);
	const meta = await issueMeta(db, id);
	if (!meta) error(404);
	const user = event.locals.user;
	if (!user) redirect(303, `/login?next=${encodeURIComponent(back(id))}`);
	const now = nowOf(event);
	const form = await event.request.formData();
	const field = (name: string) => (form.has(name) ? String(form.get(name)) : null);
	// 解決策の番号の形は課題の番号と同じ判定（断った理由を出す場所にも使う）
	const solutionId = parseIssueId(field('solution') ?? '');
	const guard = await writeGuard(event, db, user, now, 'report');
	if (!guard.ok) return fail(guard.failure.status, { ...guard.failure.data, solution: solutionId });

	const checked = validateSolutionReport({ reason: field('reason'), note: field('note') });
	if (solutionId === null || !checked.ok) error(400);
	// その課題の解決策でなければ 404（統合したあとは解決策が統合先へ移っているので、元の課題への通報もここで止まる）
	const solution = await solutionMeta(db, solutionId);
	if (!solution || solution.issueId !== id) error(404);
	if (solution.userId === user.id) error(400);
	if (meta.status === 'merged') return fail(403, { message: ja.merge.mergedOp, solution: solutionId });
	if (isHidden(meta.status)) return fail(403, { message: ja.report.hiddenIssue, solution: solutionId });
	if (isHidden(solution.status)) return fail(403, { message: ja.solution.hiddenOp, solution: solutionId });

	const result = await reportSolution(db, guard.actor, solutionId, checked.value, now);
	if (!result.ok) return fail(429, { message: refusalMessage(result.refusal), solution: solutionId });
	return { reportMessage: result.already ? ja.solution.reportAlready : ja.solution.reportDone, solution: solutionId };
}
