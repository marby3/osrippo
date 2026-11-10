// 「拾った」ステータス（Issue #150。#147 の決めること10〜12）
import { error, fail, type RequestEvent } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { ja } from '../copy/ja';
import { issueHirotta, issueHirottaLogs, issues, userVerifications } from '../db/schema';
import { HIROTTA_KINDS, parseKokkaiUrl, type HirottaKind } from '../domain/hirotta';
import { LISTED } from '../domain/reports';
import { isTestServer, nowOf, writeGuard } from './client';
import { notify } from './notifications';
import type { Db } from './law';
import { activeVerification, legislatorNameAt } from './verifications';

/** 課題のページの「議員の反応」：いま付いている反応のうち、いまも議員の人のもの（付けた順） */
export async function hirottaOf(db: Db, issueId: number, now: number) {
	return db
		.select({ kind: issueHirotta.kind, name: userVerifications.displayName, url: issueHirotta.url, createdAt: issueHirotta.createdAt })
		.from(issueHirotta)
		.innerJoin(userVerifications, and(eq(userVerifications.userId, issueHirotta.userId), eq(userVerifications.kind, 'legislator'), activeVerification(now)))
		.where(eq(issueHirotta.issueId, issueId))
		.orderBy(asc(issueHirotta.createdAt), asc(issueHirotta.kind));
}

/** 議員自身が付けている反応（課題ごとに、種類 → 付けているか） */
export async function myHirotta(db: Db, userId: string, issueIds: number[]): Promise<Map<number, Record<HirottaKind, boolean>>> {
	const mine = new Map<number, Record<HirottaKind, boolean>>();
	if (!issueIds.length) return mine;
	const rows = await db
		.select({ issueId: issueHirotta.issueId, kind: issueHirotta.kind })
		.from(issueHirotta)
		.where(and(eq(issueHirotta.userId, userId), inArray(issueHirotta.issueId, issueIds)));
	for (const id of issueIds) mine.set(id, { considering: false, questioned: false });
	for (const r of rows) mine.get(r.issueId)![r.kind] = true;
	return mine;
}

/**
 * 会議録があるか。会議録のページは画面を JavaScript で組み立てるので、どの番号でも同じ応答を返す。
 * そのため公開の検索 API（会議録の番号で引く）に問い合わせ、1件以上あれば「ある」。リダイレクトは追わない。5秒で諦める。
 * テストのサーバーでは問い合わせず、番号が 000000000X で始まるものだけを「ある」とする
 */
async function kokkaiExists(meetingId: string, test: boolean): Promise<'yes' | 'no' | 'unreachable'> {
	if (test) return meetingId.startsWith('000000000X') ? 'yes' : 'no';
	try {
		const api = `https://kokkai.ndl.go.jp/api/meeting_list?issueID=${encodeURIComponent(meetingId)}&maximumRecords=1&recordPacking=json`;
		const res = await fetch(api, { redirect: 'manual', signal: AbortSignal.timeout(5000), headers: { accept: 'application/json' } });
		if (!res.ok) return 'unreachable';
		const body = (await res.json()) as { numberOfRecords?: number };
		return (body.numberOfRecords ?? 0) > 0 ? 'yes' : 'no';
	} catch {
		return 'unreachable';
	}
}

/**
 * 付ける・外す。付けたときだけ記録と、課題を書いた人への通知（本人の課題には送らない）。
 * いまと同じ状態への操作は何もしない（記録もしない）。書いたかを返す
 */
export async function setHirotta(
	db: Db,
	input: { issueId: number; userId: string; kind: HirottaKind; op: 'add' | 'remove'; url: string | null; name: string },
	now: number
): Promise<boolean> {
	const key = and(eq(issueHirotta.issueId, input.issueId), eq(issueHirotta.userId, input.userId), eq(issueHirotta.kind, input.kind));
	const changed =
		input.op === 'add'
			? await db
					.insert(issueHirotta)
					.values({ issueId: input.issueId, userId: input.userId, kind: input.kind, url: input.kind === 'questioned' ? input.url : null, createdAt: now })
					.onConflictDoNothing()
					.returning({ issueId: issueHirotta.issueId })
			: await db.delete(issueHirotta).where(key).returning({ issueId: issueHirotta.issueId });
	if (!changed.length) return false;
	await db.insert(issueHirottaLogs).values({ issueId: input.issueId, userId: input.userId, kind: input.kind, action: input.op, displayName: input.name, createdAt: now });
	if (input.op === 'add') {
		const [issue] = await db.select({ userId: issues.userId }).from(issues).where(eq(issues.id, input.issueId));
		if (issue && issue.userId !== input.userId) await notify(db, sql`SELECT user_id FROM issues WHERE id = ${input.issueId}`, input.kind === 'considering' ? 'issue_considered' : 'issue_questioned', input.issueId, now, now);
	}
	return true;
}

/**
 * 課題のページとダッシュボードの「拾った」の操作（form の action は ?/hirotta）。議員だけ（writeGuard の legislator）。
 * 付けられるのは表示中の課題だけ。失敗は hirottaIssue に課題の番号を入れて返す（どの行の失敗か分かるように）
 */
export async function hirottaAction(event: RequestEvent, issueId: number | null) {
	const user = event.locals.user;
	if (!user) error(404);
	const db = drizzle(env.DB);
	const now = nowOf(event);
	const guard = await writeGuard(event, db, user, now, 'legislator');
	if (!guard.ok) return fail(guard.failure.status, { ...guard.failure.data, hirottaIssue: issueId });
	const form = await event.request.formData();
	const kind = String(form.get('kind') ?? '') as HirottaKind;
	const op = form.get('op');
	if (issueId === null || !HIROTTA_KINDS.includes(kind) || (op !== 'add' && op !== 'remove')) error(400);
	const [issue] = await db.select({ status: issues.status }).from(issues).where(eq(issues.id, issueId));
	if (!issue) error(404);
	// 付けられるのは表示中の課題だけ。外すのは、非表示になっても自分の反応ならできる
	if (op === 'add' && !LISTED.includes(issue.status)) return fail(403, { message: ja.hirotta.hiddenIssue, hirottaIssue: issueId });
	let url: string | null = null;
	if (op === 'add' && kind === 'questioned') {
		const parsed = parseKokkaiUrl(String(form.get('url') ?? ''));
		if (parsed === null) return fail(400, { message: ja.hirotta.urlInvalid, hirottaIssue: issueId });
		const found = await kokkaiExists(parsed.meetingId, isTestServer(event.url));
		if (found !== 'yes') return fail(found === 'no' ? 400 : 503, { message: found === 'no' ? ja.hirotta.urlNotFound : ja.hirotta.urlUnreachable, hirottaIssue: issueId });
		url = parsed.url;
	}
	const name = (await legislatorNameAt(db, user.id, now)) ?? '';
	await setHirotta(db, { issueId, userId: user.id, kind, op, url, name }, now);
	return { hirottaIssue: issueId, done: true };
}

const LOG_PAGE_SIZE = 20;

/** 運営の記録の「議員の反応の記録」（新しい順） */
export async function hirottaLogPage(db: Db, page: number) {
	const rows = await db
		.select({ id: issueHirottaLogs.id, kind: issueHirottaLogs.kind, action: issueHirottaLogs.action, name: issueHirottaLogs.displayName, issueId: issueHirottaLogs.issueId, title: issues.title, status: issues.status, createdAt: issueHirottaLogs.createdAt })
		.from(issueHirottaLogs)
		.innerJoin(issues, eq(issues.id, issueHirottaLogs.issueId))
		.orderBy(desc(issueHirottaLogs.createdAt), desc(issueHirottaLogs.id))
		.limit(LOG_PAGE_SIZE + 1)
		.offset((page - 1) * LOG_PAGE_SIZE);
	// 非表示の課題の題名は出さない（本人と運営にしか見せない。docs/spec/28.md 決めたこと4）
	return {
		rows: rows.slice(0, LOG_PAGE_SIZE).map(({ status, title, ...r }) => ({ ...r, title: LISTED.includes(status) ? title : null })),
		hasNext: rows.length > LOG_PAGE_SIZE
	};
}
