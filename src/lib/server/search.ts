// 全文検索の DB（設計書 docs/spec/38.md）。MATCH の言葉はバインド変数で渡す
import { sql, type SQL } from 'drizzle-orm';
import { laws } from '../db/schema';
import { TARGET_LAWS } from '../db/seed';
import { articleLabel, compareNum, itemLabel } from '../domain/law';
import { matchPhrase, normalizeText, searchTexts, type Word } from '../domain/search';
import type { Db } from './law';

type Kind = 'provision' | 'issue' | 'solution';

/** 言葉ごとに、2文字なら bigram、3文字以上なら trigram の表を引き、INTERSECT で AND にした ref_id の集まり */
function matchedIds(kind: Kind, words: Word[]): SQL {
	const parts = words.map((w) =>
		[...w.norm].length === 2
			? sql`SELECT ref_id FROM search_bigram WHERE kind = ${kind} AND search_bigram MATCH ${matchPhrase(w.norm)}`
			: sql`SELECT ref_id FROM search_trigram WHERE kind = ${kind} AND search_trigram MATCH ${matchPhrase(w.norm)}`
	);
	return sql.join(parts, sql` INTERSECT `);
}

/** 投稿した課題・解決策の検索の行を足す（課題は題名・困っている人・具体例を別の行に） */
export async function indexTexts(db: Db, kind: 'issue' | 'solution', refId: number, sources: string[]) {
	for (const source of sources) {
		const texts = searchTexts(source);
		if (!texts) continue;
		await db.run(sql`INSERT INTO search_trigram (kind, ref_id, text) VALUES (${kind}, ${refId}, ${texts.trigram})`);
		await db.run(sql`INSERT INTO search_bigram (kind, ref_id, text) VALUES (${kind}, ${refId}, ${texts.bigram})`);
	}
}

/** 法令：題名にすべての言葉を含む法令（そろえた題名で比べる） */
export async function searchLaws(db: Db, words: Word[]) {
	const rows = await db.select({ id: laws.id, title: laws.title }).from(laws);
	return rows
		.filter((l) => words.every((w) => normalizeText(l.title).includes(w.norm)))
		.sort((a, b) => TARGET_LAWS.indexOf(a.id) - TARGET_LAWS.indexOf(b.id));
}

/** 条文を並べるために読む行の上限（設計書 決めたこと4） */
export const PROVISION_CAP = 1000;

/** その版で有効な行の条件（v：provision_versions、cur：法令ごとのいまの版の seq） */
const validAt = (v: string, cur: string) =>
	sql.raw(`EXISTS (SELECT 1 FROM law_revisions f WHERE f.id = ${v}.from_revision_id AND f.branch = 'real' AND f.seq <= ${cur}.seq)
		AND NOT EXISTS (SELECT 1 FROM law_revisions t WHERE t.id = ${v}.to_revision_id AND t.seq <= ${cur}.seq)`);

const CURRENT = sql.raw(`(SELECT law_id, max(seq) AS seq FROM law_revisions WHERE branch = 'real' AND status = 'enforced' GROUP BY law_id)`);

type ProvisionRow = {
	law_id: string;
	law_title: string;
	kind: 'article' | 'paragraph' | 'item';
	num: string;
	caption: string | null;
	text: string | null;
	parent_num: string | null;
	grand_num: string | null;
};

/**
 * 条文：いま施行されている版で有効な条・項・号のうち当てはまるもの。法令の順・条・項・号の番号の順。
 * 番号の順は SQL で並べられないので、いまの版で絞ったあと上限+1件まで読んでアプリで並べる
 */
export async function searchProvisions(db: Db, words: Word[]) {
	const ids = matchedIds('provision', words);
	const from = sql`
		FROM provision_versions v
		JOIN provisions p ON p.id = v.provision_id
		JOIN laws l ON l.id = p.law_id
		JOIN ${CURRENT} cur ON cur.law_id = p.law_id
		WHERE v.id IN (${ids}) AND ${validAt('v', 'cur')}`;
	const [counted] = await db.all<{ n: number }>(sql`SELECT count(*) AS n ${from}`);
	const rows = await db.all<ProvisionRow>(sql`
		SELECT p.law_id, l.title AS law_title, p.kind, v.num, v.caption, v.text,
			(SELECT pv.num FROM provision_versions pv WHERE pv.provision_id = p.parent_id AND ${validAt('pv', 'cur')}) AS parent_num,
			(SELECT gv.num FROM provisions gp JOIN provision_versions gv ON gv.provision_id = gp.parent_id
				WHERE gp.id = p.parent_id AND ${validAt('gv', 'cur')}) AS grand_num
		${from}
		LIMIT ${PROVISION_CAP + 1}`);
	return { total: counted?.n ?? 0, rows: sortProvisions(rows).slice(0, PROVISION_CAP) };
}

/** 法令の順、条・項・号の番号の順に並べ、位置と本文とリンク先を付ける */
function sortProvisions(rows: ProvisionRow[]) {
	const keyed = rows.map((r) => {
		const [article, paragraph, item] =
			r.kind === 'article' ? [r.num, null, null] : r.kind === 'paragraph' ? [r.parent_num, r.num, null] : [r.grand_num, r.parent_num, r.num];
		return {
			lawId: r.law_id,
			lawTitle: r.law_title,
			article: article ?? '',
			paragraph,
			item,
			text: (r.kind === 'article' ? r.caption : r.text) ?? ''
		};
	});
	keyed.sort(
		(a, b) =>
			TARGET_LAWS.indexOf(a.lawId) - TARGET_LAWS.indexOf(b.lawId) ||
			compareNum(a.article, b.article) ||
			compareNum(a.paragraph ?? '0', b.paragraph ?? '0') ||
			compareNum(a.item ?? '0', b.item ?? '0')
	);
	return keyed.map((k) => ({
		...k,
		position:
			articleLabel(k.article) + (k.paragraph ? `第${k.paragraph}項` : '') + (k.item ? `第${itemLabel(k.item)}号` : ''),
		href: `/hourei/${k.lawId}#jo-${k.article}`
	}));
}

/** 課題：一覧に出る課題のうち当てはまるもの。「わかる」の多い順、同じなら新しい順 */
export async function searchIssues(db: Db, words: Word[], limit: number, offset = 0) {
	const ids = matchedIds('issue', words);
	const where = sql`i.status IN ('visible', 'restored') AND i.id IN (${ids})`;
	const [counted] = await db.all<{ n: number }>(sql`SELECT count(*) AS n FROM issues i WHERE ${where}`);
	const rows = await db.all<{ id: number; title: string; affected: string; example: string; supports: number }>(sql`
		SELECT i.id, i.title, i.affected, i.example, (SELECT count(*) FROM issue_supports s WHERE s.issue_id = i.id) AS supports
		FROM issues i WHERE ${where}
		ORDER BY supports DESC, i.id DESC LIMIT ${limit} OFFSET ${offset}`);
	return { total: counted?.n ?? 0, rows };
}

/** 解決策：表示中の解決策で、課題も一覧に出るもの。「わかる」の多い順、同じなら新しい順 */
export async function searchSolutions(db: Db, words: Word[], limit: number, offset = 0) {
	const ids = matchedIds('solution', words);
	const where = sql`s.status IN ('visible', 'restored') AND i.status IN ('visible', 'restored') AND s.id IN (${ids})`;
	const [counted] = await db.all<{ n: number }>(sql`SELECT count(*) AS n FROM solutions s JOIN issues i ON i.id = s.issue_id WHERE ${where}`);
	const rows = await db.all<{ id: number; body: string; issueId: number; issueTitle: string; supports: number }>(sql`
		SELECT s.id, s.body, s.issue_id AS issueId, i.title AS issueTitle,
			(SELECT count(*) FROM solution_reactions r WHERE r.solution_id = s.id AND r.kind = 'support') AS supports
		FROM solutions s JOIN issues i ON i.id = s.issue_id WHERE ${where}
		ORDER BY supports DESC, s.id DESC LIMIT ${limit} OFFSET ${offset}`);
	return { total: counted?.n ?? 0, rows };
}

/** 課題の一覧の「課題を探す」で使う、当てはまる課題の番号の集まり（SQL の部分） */
export const issueMatchSql = (words: Word[]) => matchedIds('issue', words);
