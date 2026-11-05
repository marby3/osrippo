// 修正案を出す・更新する（Issue #68。設計書 docs/spec/68.md 決めたこと4・6）。ない法案と下書きは 404。出せないときは欄を出さず理由を出す
import { error } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { ja } from '#lib/copy/ja.ts';
import { amendmentOpen } from '#lib/domain/amendments.ts';
import { articleBodyText } from '#lib/domain/bills.ts';
import { parseIssueId } from '#lib/domain/issues.ts';
import { billWaitUntil } from '#lib/domain/limits.ts';
import { amendableBill, amendmentPostAction } from '#lib/server/amendment-actions.ts';
import { amendableArticles, amendmentOf } from '#lib/server/amendments.ts';
import { nowOf } from '#lib/server/client.ts';
import { progressOf } from '#lib/server/post-actions.ts';
import { requireUser } from '#lib/server/require-user.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const { db, bill } = await amendableBill(event);
	const koushin = event.url.searchParams.get('koushin');
	const id = koushin === null ? null : parseIssueId(koushin);
	const target = id === null ? undefined : await amendmentOf(db, id, bill.id);
	if (koushin !== null && !target) error(404);
	const user = requireUser(event);
	const now = nowOf(event);
	const open = amendmentOpen(progressOf(bill, now).progress);
	const waitUntil = billWaitUntil(user.createdAt.getTime(), now);

	let blocked: string | null = waitUntil !== null ? ja.amendment.tooNew(waitUntil) : !open ? ja.amendment.closed : null;
	if (!blocked && target && target.userId !== user.id) blocked = ja.amendment.notMine;
	if (!blocked && target && (target.status !== 'open' || target.baseRev === bill.rev)) blocked = ja.amendment.noUpdate;
	if (!blocked && !target && bill.userId === user.id) blocked = ja.amendment.author;

	const articles = blocked ? [] : await amendableArticles(db, bill);
	return {
		blocked,
		rev: bill.rev,
		update: target ? { id: target.id, body: articleBodyText(target.paragraphs), reason: target.reason ?? '', label: articles.find((a) => a.lawSeq === target.lawSeq && a.num === target.num)?.label ?? '' } : null,
		multipleLaws: bill.laws.length > 1,
		articles: articles.map((a) => ({ key: a.key, lawTitle: a.lawTitle, label: `${a.label}${a.caption ?? ''}`, body: articleBodyText(a.current) })),
		siteKey: env.TURNSTILE_SITE_KEY
	};
};

export const actions: Actions = { default: amendmentPostAction };
