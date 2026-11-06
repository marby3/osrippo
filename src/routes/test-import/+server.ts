// テストのサーバーだけの、取り込みの一覧のデータを作る入口（設計書 docs/spec/95.md 決めたこと7）。
// テストのサーバーで API を呼ばず、別のプロセスから D1 を開けないので、委員会の外の法令と法案を作り、実際の同期と取り込みを通す
import { error, json } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { and, eq, max, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { billChanges, billLaws, bills, ifRevisions, lawRevisions, provisions, provisionVersions, user } from '#lib/db/schema.ts';
import { seedStatements } from '#lib/db/seed.ts';
import { sessionAt } from '#lib/domain/session.ts';
import { isTestServer } from '#lib/server/client.ts';
import { ifArticles, ifBranchOf, ifHeadOf, importReal, nextIfSeq } from '#lib/server/if-world.ts';
import type { BatchDb } from '#lib/server/law.ts';
import { syncLaw } from '#lib/server/law-sync.ts';
import type { RequestHandler } from './$types';

type A = { num: string; text: string; caption?: string };
type Revision = { id: string; date: string; amendmentTitle?: string; articles: A[] };

const lawNode = (rows: A[]) => ({
	tag: 'Law',
	children: [
		{
			tag: 'MainProvision',
			children: rows.map((a) => ({
				tag: 'Article',
				attr: { Num: a.num },
				children: [{ tag: 'ArticleCaption', children: [a.caption ?? '（見出し）'] }, { tag: 'Paragraph', attr: { Num: '1' }, children: [{ tag: 'ParagraphSentence', children: [a.text] }] }]
			}))
		}
	]
});

const listed = (title: string, id: string, date: string, amendmentTitle: string | null, status: string) => ({
	law_revision_id: id,
	law_title: title,
	law_title_kana: null,
	amendment_enforcement_date: date,
	amendment_law_title: amendmentTitle,
	amendment_law_num: null,
	amendment_promulgate_date: date,
	current_revision_status: status,
	repeal_status: 'None'
});

export const POST: RequestHandler = async ({ request, url }) => {
	if (!isTestServer(url)) error(404);
	const body = (await request.json()) as { op: string; lawId: string; title: string; revision: Revision; changes: { num: string; op: 'amend' | 'delete'; text?: string }[] };
	const db = drizzle(env.DB) as unknown as BatchDb;
	const now = Date.now();
	const { lawId } = body;

	if (body.op === 'create') {
		const { id, date, articles } = body.revision;
		const load = (name: string) =>
			name.startsWith('law_revisions_') ? { law_info: { law_num: `テスト第${lawId}号` }, revisions: [listed(body.title, id, date, null, 'CurrentEnforced')] } : { law_full_text: lawNode(articles) };
		const [{ provisionMax }] = await db.select({ provisionMax: max(provisions.id) }).from(provisions);
		const [{ versionMax }] = await db.select({ versionMax: max(provisionVersions.id) }).from(provisionVersions);
		for (const statement of seedStatements([lawId], load, { provisionId: (provisionMax ?? 0) + 1, versionId: (versionMax ?? 0) + 1 })) await db.run(sql.raw(statement));
		await ifBranchOf(db, lawId);
		return json({ ok: true });
	}

	if (body.op === 'bill') {
		const head = await ifHeadOf(db, lawId);
		const articles = await ifArticles(db, lawId, head.branchRevisionId as string, head.seq);
		await db.insert(user).values({ id: 'test-import', name: 'test-import', email: 'test-import@test.invalid', createdAt: new Date(now), updatedAt: new Date(now) }).onConflictDoNothing();
		// 一覧の順に影響しないよう、発議の時刻は昔にする
		const [bill] = await db
			.insert(bills)
			.values({ userId: 'test-import', committeeId: 1, kind: 'amend', status: 'proposed', rev: 1, nextRev: 2, proposedRev: 1, title: body.title, affected: 'a', sideEffects: 's', createdAt: now, updatedAt: now, proposedAt: 1 })
			.returning({ id: bills.id });
		await db.insert(billLaws).values({ billId: bill.id, rev: 1, seq: 0, action: 'amend', lawId, baseRevisionId: head.branchRevisionId, baseIfSeq: head.seq });
		for (const c of body.changes) {
			const target = articles.find((a) => a.num === c.num);
			if (!target) error(400);
			await db.insert(billChanges).values({ billId: bill.id, rev: 1, lawSeq: 0, num: c.num, op: c.op, provisionId: target.id, caption: c.op === 'delete' ? null : target.caption, body: c.op === 'delete' ? null : JSON.stringify([{ num: '1', text: c.text ?? '', items: [] }]) });
		}
		await db.run(sql`
			INSERT INTO ${ifRevisions} (law_id, seq, bill_id, bill_rev, law_seq, session_key, created_at)
			SELECT ${lawId}, ${nextIfSeq(lawId)}, ${bill.id}, 1, 0, 'test-import', ${now}`);
		return json({ ok: true, billId: bill.id });
	}

	if (body.op === 'revise') {
		const known = await db.select().from(lawRevisions).where(and(eq(lawRevisions.lawId, lawId), eq(lawRevisions.branch, 'real'))).orderBy(lawRevisions.seq);
		const { id, date, amendmentTitle, articles } = body.revision;
		const list = [...known.map((r) => listed(body.title ?? lawId, r.id, r.enforcementDate, r.amendmentLawTitle, 'PreviousEnforced')), listed(body.title ?? lawId, id, date, amendmentTitle ?? null, 'CurrentEnforced')];
		await syncLaw(db, lawId, async (requested) => {
			if (requested.includes('/law_revisions/')) return { revisions: [...list].reverse() };
			return { revision_info: { law_revision_id: id }, law_full_text: lawNode(articles) };
		});
		// 取り込みは前の会期の最終日までに施行された版を見る。テストの版は昔の日付
		const current = sessionAt(now, null);
		await importReal(db, sessionAt(current.startsAt - 1, null), now, lawId);
		return json({ ok: true });
	}
	error(400);
};
