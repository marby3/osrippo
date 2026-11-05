// 法案の一覧（Issue #48）。下書きもだれでも見られる
import { error } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { billProgress, lapsedBefore, parseBillTab, referralSession } from '#lib/domain/bills.ts';
import { sessionAt } from '#lib/domain/session.ts';
import { billStage } from '#lib/domain/votes.ts';
import type { BatchDb } from '#lib/server/law.ts';
import { adjustmentsFor } from '#lib/server/if-world.ts';
import { resultsFor, settleOnRead } from '#lib/server/results.ts';
import { parsePage } from '#lib/domain/issues.ts';
import { billTabCounts, listBills } from '#lib/server/bills.ts';
import { nowOf, sessionsAt } from '#lib/server/client.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const { url } = event;
	const tab = parseBillTab(url.searchParams.get('tab'));
	const page = parsePage(url.searchParams.get('page'));
	if (tab === null || page === null) error(404);
	const db = drizzle(env.DB);
	const now = nowOf(event);
	const { previous, minutes } = sessionsAt(now);
	const before = lapsedBefore(previous);
	// 「終わった」のタブだけ結果を出す。1つ前の会期がまだなら、ここで確定する（docs/spec/71.md 決めたこと5）
	if (tab === 'owari') await settleOnRead(db as unknown as BatchDb, previous, sessionAt(previous.startsAt - 1, minutes), now, minutes);
	const { rows, hasNext } = await listBills(db, tab, page, before);
	// 2ページ目以降で法案がなければ 404（課題の一覧と同じ）
	if (page > 1 && rows.length === 0) error(404);
	const ids = rows.map((r) => r.id);
	const [results, adjustments] = tab === 'owari' ? await Promise.all([resultsFor(db, ids), adjustmentsFor(db, ids)]) : [[], []];
	const keyOf = (proposedAt: number) => referralSession(proposedAt, minutes).key;
	const outcomeOf = (id: number, proposedAt: number) => results.find((r) => r.billId === id && r.sessionKey === keyOf(proposedAt))?.outcome ?? null;
	const adjustmentOf = (id: number, proposedAt: number) => adjustments.find((a) => a.billId === id && a.sessionKey === keyOf(proposedAt) && a.resolvedAt === null) ?? null;
	return {
		tab,
		page,
		rows: rows.map(({ id, kind, title, supports, status, proposedAt }) => {
			const progress = billProgress({ status, proposedAt }, now, minutes);
			const ended = progress === 'lapsed';
			return { id, kind, title, supports, stage: billStage(progress, ended ? outcomeOf(id, proposedAt as number) : null, ended ? adjustmentOf(id, proposedAt as number) : null, now) };
		}),
		hasNext,
		counts: await billTabCounts(db, before)
	};
};
