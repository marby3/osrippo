// 解決策の「わかる」「考えが変わった」の操作（設計書 docs/spec/34.md 決めたこと5）。課題のページと解決策の一覧で同じ処理を使う
import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { ja } from '../copy/ja';
import { parseIssueId } from '../domain/issues';
import { isHidden } from '../domain/reports';
import { parseReaction } from '../domain/solutions';
import { refusalMessage, writeGuard } from './client';
import { issueMeta } from './issues';
import { react, solutionMeta } from './solutions';

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
	const now = Date.now();
	const guard = await writeGuard(event, db, user, now);
	if (!guard.ok) return guard.failure;

	const form = await event.request.formData();
	const field = (name: string) => (form.has(name) ? String(form.get(name)) : null);
	const input = parseReaction({ solution: field('solution'), kind: field('kind'), op: field('op') });
	if (!input) error(400);
	// その課題の解決策でなければ 404（統合したあとは解決策が統合先へ移っているので、元の課題への操作もここで止まる）
	const solution = await solutionMeta(db, input.solutionId);
	if (!solution || solution.issueId !== id) error(404);
	if (meta.status === 'merged') return fail(403, { message: ja.merge.mergedOp });
	if (isHidden(meta.status)) return fail(403, { message: ja.report.hiddenIssue });
	if (solution.userId === user.id) return fail(403, { message: ja.solution.ownSolution });

	const result = await react(db, guard.actor, input.solutionId, input.kind, input.op, now);
	if (!result.ok) return fail(429, { message: refusalMessage(result.refusal) });
	return { reacted: input.solutionId };
}
