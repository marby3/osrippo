// 法令と版の DB を読む（設計書 docs/spec/8.md の決定1〜3）
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, max, or } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { alias } from 'drizzle-orm/sqlite-core';
import {
	articleLabel,
	BASELINE_DATE,
	compareArticles,
	compareNum,
	headingPaths,
	tableOfContents,
	tokyoDate,
	type Change
} from '../domain/law';
import { committeeLaws, laws, lawRevisions, provisions, provisionVersions, readableArticles, readableLaws } from '../db/schema';

// D1（本番）と node:sqlite（テスト）の両方の Drizzle を受ける
export type Db = BaseSQLiteDatabase<'async', any>;
/** 1つのトランザクションで流せる Db（D1 の batch）。BaseSQLiteDatabase の型には batch がない */
export type BatchDb = Db & { batch: (queries: readonly [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]) => Promise<unknown> };

/** 「改正された」に数える change（設計書「change の値」） */
const COUNTED: Change[] = ['added', 'amended', 'unconfirmed'];

/** 委員会で扱う法令（法律の一覧、Issue #85 決めたこと A） */
export async function committeeLawList(db: Db) {
	return db
		.selectDistinct({ id: laws.id, title: laws.title })
		.from(committeeLaws)
		.innerJoin(laws, eq(laws.id, committeeLaws.lawId))
		.orderBy(asc(laws.id));
}

/** 現在の版：施行済みのうち seq が最大の版（決定2） */
export async function currentRevision(db: Db, lawId: string) {
	const [row] = await db
		.select()
		.from(lawRevisions)
		.where(and(eq(lawRevisions.lawId, lawId), eq(lawRevisions.branch, 'real'), eq(lawRevisions.status, 'enforced')))
		.orderBy(desc(lawRevisions.seq))
		.limit(1);
	return row;
}

/** 版 R で有効な条・項・号の行（決定1） */
export async function provisionsAt(db: Db, revisionId: string) {
	const [r] = await db.select().from(lawRevisions).where(eq(lawRevisions.id, revisionId));
	if (!r) return [];
	const from = alias(lawRevisions, 'from_revision');
	const to = alias(lawRevisions, 'to_revision');
	return db
		.select({
			id: provisions.id,
			kind: provisions.kind,
			parentId: provisions.parentId,
			num: provisionVersions.num,
			caption: provisionVersions.caption,
			text: provisionVersions.text,
			change: provisionVersions.change,
			unconfirmedOf: provisionVersions.unconfirmedOf
		})
		.from(provisionVersions)
		.innerJoin(provisions, eq(provisions.id, provisionVersions.provisionId))
		.innerJoin(from, eq(from.id, provisionVersions.fromRevisionId))
		.leftJoin(to, eq(to.id, provisionVersions.toRevisionId))
		.where(
			and(
				eq(provisions.lawId, r.lawId),
				eq(from.branch, r.branch),
				lte(from.seq, r.seq),
				or(isNull(to.id), gt(to.seq, r.seq))
			)
		);
}

/**
 * 制定の版：起点の版がない法令（2017年4月2日以降に制定）の最初の版（Issue #18）。
 * 取り込みは起点の版か制定の版を seq 0 にするので、seq 0 が起点の日より後なら制定の版。起点の版がある法令は undefined
 */
export async function enactmentRevision(db: Db, lawId: string) {
	const [row] = await db
		.select({ id: lawRevisions.id, date: lawRevisions.enforcementDate })
		.from(lawRevisions)
		.where(and(eq(lawRevisions.lawId, lawId), eq(lawRevisions.branch, 'real'), eq(lawRevisions.seq, 0)));
	return row && row.date > BASELINE_DATE ? row : undefined;
}

/**
 * 条・項・号ごとの最後に改正された日（決定3）。改正のないものは入らない。
 * seq 0 の行は起点の版（baseline）か制定の版（added）なので、改正に数えない（Issue #18）
 */
export async function lastAmendedDates(db: Db, lawId: string): Promise<Map<number, string>> {
	const from = alias(lawRevisions, 'from_revision');
	const rows = await db
		.select({ id: provisionVersions.provisionId, date: max(from.enforcementDate) })
		.from(provisionVersions)
		.innerJoin(provisions, eq(provisions.id, provisionVersions.provisionId))
		.innerJoin(from, eq(from.id, provisionVersions.fromRevisionId))
		.where(
			and(
				eq(provisions.lawId, lawId),
				eq(from.branch, 'real'),
				inArray(provisionVersions.change, COUNTED),
				eq(from.status, 'enforced'),
				gt(from.seq, 0)
			)
		)
		.groupBy(provisionVersions.provisionId);
	return new Map(rows.filter((r) => r.date).map((r) => [r.id, r.date!]));
}

/** 版で有効な行を、条・項・号の木にする（並びは num の順） */
function articlesAt(rows: Awaited<ReturnType<typeof provisionsAt>>) {
	const childrenOf = (kind: string, parentId: number) =>
		rows.filter((r) => r.kind === kind && r.parentId === parentId).sort((a, b) => compareNum(a.num, b.num));
	return rows
		.filter((r) => r.kind === 'article')
		.sort((a, b) => compareNum(a.num, b.num))
		.map((a) => ({
			id: a.id,
			num: a.num,
			label: articleLabel(a.num),
			caption: a.caption ?? '',
			paragraphs: childrenOf('paragraph', a.id).map((p) => ({
				num: p.num,
				text: p.text ?? '',
				items: childrenOf('item', p.id).map((i) => ({ num: i.num, text: i.text ?? '' }))
			}))
		}));
}

/** 版で有効な条（内部IDつき。項と号の木）。法案の基にした版の条に使う */
export async function articlesOfRevision(db: Db, revisionId: string) {
	return articlesAt(await provisionsAt(db, revisionId));
}

/** 法令ページに出すもの。ない法令なら undefined */
export async function lawPage(db: Db, lawId: string) {
	const [law] = await db.select().from(laws).where(eq(laws.id, lawId));
	const current = law && (await currentRevision(db, lawId));
	if (!law || !current) return undefined;

	const amended = await lastAmendedDates(db, lawId);
	const enacted = (await enactmentRevision(db, lawId))?.date ?? null;
	// 見出しが前の条と変わるところにだけ帯を出す（設計書 docs/spec/21.md）
	// 木の外の条（本来ない）は帯を出さず、前の帯も続いているものとみなす
	const paths = headingPaths(current.headings ?? []);
	let previous = '';
	// 内部IDは画面に渡さない
	const articles = articlesAt(await provisionsAt(db, current.id)).map(({ id, ...a }) => {
		const path = paths.get(a.num) ?? [];
		const key = path.join('\n');
		const band = key && key !== previous ? path : null;
		if (key) previous = key;
		const lastAmended = amended.get(id) ?? null;
		// 制定のあと変わっていない条だけ、制定の日を持つ
		return { ...a, band, lastAmended, enacted: lastAmended ? null : enacted };
	});

	const revisions = await db
		.select()
		.from(lawRevisions)
		.where(and(eq(lawRevisions.lawId, lawId), eq(lawRevisions.branch, 'real')))
		.orderBy(desc(lawRevisions.seq));
	// seq 0 の版（起点の版か制定の版）は、改正履歴に並べない。制定の版は enacted として別に出す（Issue #18）
	const listed = revisions.filter((r) => r.seq !== 0);
	const entry = (r: (typeof revisions)[number]) => ({ date: r.enforcementDate, title: r.amendmentLawTitle ?? '' });
	return {
		law: { id: law.id, title: law.title, titleKana: law.titleKana, lawNum: law.lawNum },
		current: { enforcementDate: current.enforcementDate },
		enacted,
		articles,
		toc: tableOfContents(current.headings ?? []),
		enforced: listed.filter((r) => r.status === 'enforced').map(entry),
		scheduled: listed.filter((r) => r.status === 'scheduled').map(entry)
	};
}

/**
 * 読める法律のページに出すもの（Issue #162、設計書 docs/spec/162.md 決めたこと4）。最新の版だけで、改正の記録はない。
 * 本文を入れ終えて（synced_updated がある）、条が1つ以上ある法令だけ。ほかは undefined
 */
export async function readableLawPage(db: Db, lawId: string) {
	const [law] = await db
		.select()
		.from(readableLaws)
		.where(and(eq(readableLaws.id, lawId), isNotNull(readableLaws.syncedUpdated), gte(readableLaws.articleCount, 1)));
	if (!law) return undefined;
	const rows = await db
		.select({ num: readableArticles.num, label: readableArticles.label, caption: readableArticles.caption, paragraphs: readableArticles.paragraphs })
		.from(readableArticles)
		.where(eq(readableArticles.lawId, lawId))
		.orderBy(asc(readableArticles.seq));
	// 見出しの帯は、遊べる法律のページと同じく、前の条と変わるところにだけ出す
	const paths = headingPaths(law.headings ?? []);
	let previous = '';
	const articles = rows.map((a) => {
		const path = paths.get(a.num) ?? [];
		const key = path.join('\n');
		const band = key && key !== previous ? path : null;
		if (key) previous = key;
		return { ...a, band };
	});
	return {
		law: { id: law.id, title: law.title, titleKana: law.titleKana, lawNum: law.lawNum },
		lastAmended: law.lastAmended,
		promulgationDate: law.promulgationDate,
		articles,
		toc: tableOfContents(law.headings ?? [])
	};
}

/**
 * 改正で変わったところ（Issue #191）。改正法（＝その改正で施行された版）を1つ選び、直前の版と比べる。
 * kaisei がないときは、いま効力のある版。前の版がない一番古い版や、その法令にない版は undefined
 */
export async function comparePage(db: Db, lawId: string, kaisei?: string | null) {
	const [law] = await db.select().from(laws).where(eq(laws.id, lawId));
	if (!law) return undefined;
	const revisions = await db
		.select()
		.from(lawRevisions)
		.where(and(eq(lawRevisions.lawId, lawId), eq(lawRevisions.branch, 'real')))
		.orderBy(asc(lawRevisions.seq));

	const version = (r: (typeof revisions)[number]) => ({
		id: r.id,
		date: r.enforcementDate,
		title: r.amendmentLawTitle ?? '',
		scheduled: r.status === 'scheduled'
	});
	const page = {
		law: { id: law.id, title: law.title },
		// 前の版がない一番古い版は選べない。新しい順
		amendments: revisions.slice(1).map(version).reverse()
	};

	let i: number;
	if (kaisei) {
		i = revisions.findIndex((r) => r.id === kaisei);
		if (i < 1) return undefined;
	} else {
		const current = await currentRevision(db, lawId);
		if (!current) return undefined;
		i = revisions.findIndex((r) => r.id === current.id);
		if (i < 0) return undefined;
		// いま効力のある版が一番古い版なら、その次の（施行予定の）改正。版が1つしかなければ見せる改正がない
		if (i === 0) {
			if (revisions.length < 2) return { ...page, compared: undefined };
			i = 1;
		}
	}
	const before = revisions[i - 1];
	const after = revisions[i];
	const changes = compareArticles(
		articlesAt(await provisionsAt(db, before.id)),
		articlesAt(await provisionsAt(db, after.id))
	);
	return { ...page, compared: { before: version(before), after: version(after), changes } };
}

/**
 * 条ごとの変わった記録。num は現在の版での条の番号。
 * 改正されたことがない条（または、ない条）なら undefined
 */
export async function articleHistory(db: Db, lawId: string, num: string) {
	const current = await currentRevision(db, lawId);
	if (!current) return undefined;
	const article = (await provisionsAt(db, current.id)).find((r) => r.kind === 'article' && r.num === num);
	if (!article) return undefined;

	const from = alias(lawRevisions, 'from_revision');
	const versions = await db
		.select({
			num: provisionVersions.num,
			change: provisionVersions.change,
			revisionId: from.id,
			seq: from.seq,
			status: from.status,
			date: from.enforcementDate,
			lawNum: from.amendmentLawNum
		})
		.from(provisionVersions)
		.innerJoin(from, eq(from.id, provisionVersions.fromRevisionId))
		.where(and(eq(provisionVersions.provisionId, article.id), eq(from.branch, 'real')))
		.orderBy(desc(from.seq));
	// seq 0 の行（制定の版の added）は改正に数えない（Issue #18）
	const amendments = versions.filter((v) => COUNTED.includes(v.change) && v.status === 'enforced' && v.seq > 0);
	if (!amendments.length) return undefined;

	// 番号が今と違う時期には、当時の番号を添える
	const then = (n: string) => (n === num ? null : articleLabel(n));
	const baseline = versions.find((v) => v.change === 'baseline');
	// 制定の版からある条なら、いちばん古い行を制定にする
	const enactment = await enactmentRevision(db, lawId);
	const atEnactment = enactment && versions.find((v) => v.revisionId === enactment.id);

	// 最新の改正の変更点：その版と、1つ前の版の同じ条を比べる
	const latest = amendments[0];
	const [previous] = await db
		.select()
		.from(lawRevisions)
		.where(and(eq(lawRevisions.lawId, lawId), eq(lawRevisions.branch, 'real'), lt(lawRevisions.seq, latest.seq)))
		.orderBy(desc(lawRevisions.seq))
		.limit(1);
	const at = async (revisionId: string) =>
		articlesAt(await provisionsAt(db, revisionId)).filter((a) => a.id === article.id);
	const [change] = compareArticles(previous ? await at(previous.id) : [], await at(latest.revisionId));

	return {
		label: articleLabel(num),
		latest: change?.parts ?? [],
		amendments: amendments.map((v) => ({ date: v.date, lawNum: v.lawNum ?? '', then: then(v.num) })),
		baseline: baseline ? { then: then(baseline.num) } : null,
		enacted: atEnactment ? { date: enactment.date, then: then(atEnactment.num) } : null
	};
}

/** 日本時間の今日（YYYY-MM-DD） */
export function todayInTokyo(): string {
	return tokyoDate(Date.now());
}
