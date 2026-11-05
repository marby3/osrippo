// 現実の改正の同期（設計書 docs/spec/74.md 決めたこと4）。固定の版までは変えず、それより後を一覧に合わせて作り直す。
// 自宅サーバーの入口（scripts/sync-laws.ts）から読むので、cloudflare:workers、import.meta.env、#lib に頼らない
import { and, asc, eq, inArray, isNull, max, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { laws, lawRevisions, provisions, provisionVersions } from '../db/schema';
import { extendHistory } from '../domain/law';
import { searchTexts } from '../domain/search';
import { checkRevision, readLawText, readRevisionList, type FetchJson } from '../egov/client';
import { revisionStatus, type EgovRevision } from '../egov/revision';
import { ifBranchOf } from './if-world';
import { provisionsAt, type BatchDb } from './law';

// D1 の1文の値の上限は100個
const PROVISIONS_PER_STATEMENT = 25;
const VERSIONS_PER_STATEMENT = 10;
const SEARCH_PER_STATEMENT = 33;

// 検索の表は FTS5 で、スキーマでは管理しない（drizzle/0008_search.sql）。D1 の batch は値つきの db.run を受け付けないので、builder で書くためにここで形だけ宣言する
const searchTable = (name: string) => sqliteTable(name, { kind: text('kind').notNull(), refId: integer('ref_id').notNull(), text: text('text').notNull() });
const searchTrigram = searchTable('search_trigram');
const searchBigram = searchTable('search_bigram');

const chunks = <T>(rows: T[], size: number) => Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size));
const inJson = (values: unknown[]) => sql`(SELECT value FROM json_each(${JSON.stringify(values)}))`;

/** 施行済みの最新の版の題名（施行予定の改正で題名が変わることがある） */
const latestEnforced = (revisions: EgovRevision[]) => revisions.findLast((r) => revisionStatus(r.current_revision_status) === 'enforced') as EgovRevision;

export type SyncResult = {
	/** 固定の版より後を作り直したか */
	changed: boolean;
	/** 固定の版より前に遅れて来て、履歴に入れなかった版 */
	skipped: string[];
};

export async function syncLaw(db: BatchDb, lawId: string, fetchJson: FetchJson): Promise<SyncResult> {
	// 現実の版が進む前に固定する
	const pinId = await ifBranchOf(db, lawId);
	if (!pinId) throw new Error(`${lawId}：DB にない法令です`);
	const existing = await db
		.select({ id: lawRevisions.id, seq: lawRevisions.seq, status: lawRevisions.status })
		.from(lawRevisions)
		.where(and(eq(lawRevisions.lawId, lawId), eq(lawRevisions.branch, 'real')))
		.orderBy(asc(lawRevisions.seq));
	const pinIndex = existing.findIndex((r) => r.id === pinId);
	const pinned = new Set(existing.slice(0, pinIndex + 1).map((r) => r.id));
	const oldTail = existing.slice(pinIndex + 1);

	const listed = await readRevisionList(fetchJson, lawId);
	const pinPosition = listed.findIndex((r) => r.law_revision_id === pinId);
	if (pinPosition < 0) throw new Error(`${lawId}：固定の版 ${pinId} が一覧にありません`);
	const pin = checkRevision(listed[pinPosition]);
	if (revisionStatus(pin.current_revision_status) !== 'enforced') throw new Error(`${lawId}：固定の版 ${pinId} が施行済みではありません`);

	// DB の先頭の版より前（2017年より前）は比べない
	const firstPosition = listed.findIndex((r) => r.law_revision_id === existing[0].id);
	const skipped =
		firstPosition < 0
			? []
			: listed
					.slice(firstPosition, pinPosition)
					.map((r) => r.law_revision_id)
					.filter((id) => !pinned.has(id));
	const tail = listed
		.slice(pinPosition + 1)
		.filter((r) => !pinned.has(r.law_revision_id))
		.map(checkRevision);

	const latest = latestEnforced([pin, ...tail]);
	const saveTitle = db.update(laws).set({ title: latest.law_title, titleKana: latest.law_title_kana }).where(eq(laws.id, lawId));

	const same = oldTail.length === tail.length && tail.every((r, i) => r.law_revision_id === oldTail[i].id && revisionStatus(r.current_revision_status) === oldTail[i].status);
	if (same) {
		await saveTitle;
		return { changed: false, skipped };
	}

	// 読めなければ DB に触らない。施行済みになる版もここで読み直すので、中身はその時点の e-Gov と同じになる
	const lawTexts: Awaited<ReturnType<typeof readLawText>>[] = [];
	for (const r of tail) lawTexts.push(await readLawText(fetchJson, r.law_revision_id));
	const startRows = await provisionsAt(db, pinId);

	const oldIds = oldTail.map((r) => r.id);
	const oldOnly = oldIds.length
		? await db
				.selectDistinct({ id: provisionVersions.provisionId })
				.from(provisionVersions)
				.where(
					and(
						inArray(provisionVersions.fromRevisionId, oldIds),
						sql`NOT EXISTS (SELECT 1 FROM provision_versions o WHERE o.provision_id = ${provisionVersions}.provision_id AND o.from_revision_id NOT IN ${inJson(oldIds)})`
					)
				)
		: [];

	// 全文を読んだあとで読む（読むときの反映と番号が重なる時間を短くする。重なれば batch が失敗し、次の日にやり直す）
	const [{ provisionMax }] = await db.select({ provisionMax: max(provisions.id) }).from(provisions);
	const [{ versionMax }] = await db.select({ versionMax: max(provisionVersions.id) }).from(provisionVersions);
	const history = extendHistory(
		{ revisionId: pinId, rows: startRows },
		tail.map((r, i) => ({ id: r.law_revision_id, articles: lawTexts[i].articles })),
		{ nextId: (provisionMax ?? 0) + 1 }
	);
	const firstVersionId = (versionMax ?? 0) + 1;
	const versions = history.versions.map((v, i) => ({ id: firstVersionId + i, ...v }));
	const searchRows = versions.flatMap((v) => {
		const texts = searchTexts(v.caption ?? v.text ?? '');
		return texts ? [{ id: v.id, ...texts }] : [];
	});
	const closedBy = new Map<string, number[]>();
	for (const c of history.closes) closedBy.set(c.toRevisionId, [...(closedBy.get(c.toRevisionId) ?? []), c.provisionId]);
	const pinSeq = existing[pinIndex].seq;

	const oldSearchRows = sql`kind = 'provision' AND ref_id IN (SELECT id FROM provision_versions WHERE from_revision_id IN ${inJson(oldIds)})`;
	const insertSearch = (table: ReturnType<typeof searchTable>, column: 'trigram' | 'bigram') =>
		chunks(searchRows, SEARCH_PER_STATEMENT).map((rows) => db.insert(table).values(rows.map((r) => ({ kind: 'provision', refId: r.id, text: r[column] }))));

	const statements: BatchItem<'sqlite'>[] = [
		db.delete(searchTrigram).where(oldSearchRows),
		db.delete(searchBigram).where(oldSearchRows),
		db.delete(provisionVersions).where(sql`from_revision_id IN ${inJson(oldIds)}`),
		db.update(provisionVersions).set({ toRevisionId: null }).where(sql`to_revision_id IN ${inJson(oldIds)}`),
		// 親と子を1文で消す（外部キーは文の終わりに確かめられる）
		db.delete(provisions).where(sql`id IN ${inJson(oldOnly.map((p) => p.id))}`),
		db.delete(lawRevisions).where(sql`id IN ${inJson(oldIds)}`),
		...tail.map((r, i) =>
			db.insert(lawRevisions).values({
				id: r.law_revision_id,
				lawId,
				branch: 'real',
				seq: pinSeq + 1 + i,
				enforcementDate: r.amendment_enforcement_date,
				status: revisionStatus(r.current_revision_status) as 'enforced' | 'scheduled',
				amendmentLawTitle: r.amendment_law_title,
				amendmentLawNum: r.amendment_law_num,
				amendmentPromulgateDate: r.amendment_promulgate_date,
				headings: lawTexts[i].headings
			})
		),
		// 新しい行を入れる前に閉じる（to_revision_id が NULL の行は、固定の版で開いている行だけ）
		...[...closedBy].map(([toRevisionId, ids]) =>
			db
				.update(provisionVersions)
				.set({ toRevisionId })
				.where(and(isNull(provisionVersions.toRevisionId), sql`provision_id IN ${inJson(ids)}`))
		),
		// 親が先（作った順）
		...chunks(history.provisions.map((p) => ({ ...p, lawId })), PROVISIONS_PER_STATEMENT).map((rows) => db.insert(provisions).values(rows)),
		...chunks(versions, VERSIONS_PER_STATEMENT).map((rows) => db.insert(provisionVersions).values(rows)),
		...insertSearch(searchTrigram, 'trigram'),
		...insertSearch(searchBigram, 'bigram'),
		saveTitle
	];
	await db.batch(statements as never);
	return { changed: true, skipped };
}

/** DB の全部の法令を順に同期する。1つの法令の失敗で残りを止めない */
export async function syncAll(db: BatchDb, fetchJson: FetchJson) {
	const rows = await db.select({ id: laws.id }).from(laws).orderBy(asc(laws.id));
	const failed: string[] = [];
	const skipped: { lawId: string; revisionId: string }[] = [];
	for (const { id } of rows) {
		try {
			const result = await syncLaw(db, id, fetchJson);
			skipped.push(...result.skipped.map((revisionId) => ({ lawId: id, revisionId })));
		} catch (e) {
			console.error(`${id} の同期に失敗しました`, e);
			failed.push(id);
		}
	}
	return { failed, skipped };
}
