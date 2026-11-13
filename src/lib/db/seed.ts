// e-Gov のデータ（今はテストデータ）から、法令と版の DB に入れる SQL を作る（設計書 docs/spec/8.md）
import { BASELINE_DATE, buildHistory, parseHeadings, parseLaw, type EgovNode } from '../domain/law';
import { provisionSearchSource, searchTexts } from '../domain/search';
import { revisionStatus, type EgovRevision } from '../egov/revision';

/** 対象3法：景品表示法、特定商取引法、消費者契約法（法令ID順） */
export const TARGET_LAWS = ['337AC0000000134', '351AC0000000057', '412AC0000000061'];

export type Value = string | number | null;
export type Table = { name: string; columns: string[]; rows: Value[][] };

const MAX_ROWS = 100;
const MAX_BYTES = 100_000;

const literal = (v: Value) => (v === null ? 'NULL' : typeof v === 'number' ? String(v) : `'${v.replaceAll("'", "''")}'`);

/** D1 が受け付ける形にする：トランザクション文なし、1文 100 行まで・100KB 未満 */
export function inserts({ name, columns, rows }: Table): string[] {
	const head = `INSERT INTO ${name} (${columns.join(', ')}) VALUES\n`;
	const bytes = (s: string) => new TextEncoder().encode(s).length;
	const statements: string[] = [];
	let chunk: string[] = [];
	let size = bytes(head);
	for (const row of rows) {
		const tuple = `(${row.map(literal).join(', ')})`;
		const add = bytes(tuple) + 2;
		if (bytes(head) + add >= MAX_BYTES) throw new Error(`${name} の1行が ${MAX_BYTES} バイトを超えています`);
		if (chunk.length && (chunk.length >= MAX_ROWS || size + add >= MAX_BYTES)) {
			statements.push(head + chunk.join(',\n') + ';');
			chunk = [];
			size = bytes(head);
		}
		chunk.push(tuple);
		size += add;
	}
	if (chunk.length) statements.push(head + chunk.join(',\n') + ';');
	return statements;
}

function statusOf(r: EgovRevision): 'enforced' | 'scheduled' {
	const status = revisionStatus(r.current_revision_status);
	if (!status) throw new Error(`${r.law_revision_id}：知らない状態 ${r.current_revision_status}`);
	return status;
}

/** load(name) は tests/fixtures/egov/<name>.json の中身を返す。start は内部IDと行の番号の始まり（すでに行のある DB に足すとき） */
export function seedStatements(lawIds: string[], load: (name: string) => unknown, start = { provisionId: 1, versionId: 1 }): string[] {
	const laws: Table = { name: 'laws', columns: ['id', 'title', 'title_kana', 'law_num'], rows: [] };
	const revisions: Table = {
		name: 'law_revisions',
		columns: ['id', 'law_id', 'branch', 'seq', 'enforcement_date', 'status', 'amendment_law_title', 'amendment_law_num', 'amendment_promulgate_date', 'headings'],
		rows: []
	};
	const provisions: Table = { name: 'provisions', columns: ['id', 'law_id', 'kind', 'parent_id'], rows: [] };
	const versions: Table = {
		name: 'provision_versions',
		columns: ['id', 'provision_id', 'from_revision_id', 'to_revision_id', 'num', 'caption', 'text', 'change', 'similarity', 'unconfirmed_of'],
		rows: []
	};

	// 全文検索の行（設計書 docs/spec/38.md「行の作り方」）。条は見出し、項・号は本文。どの版の行かは引くときに決める
	const trigram: Table = { name: 'search_trigram', columns: ['kind', 'ref_id', 'text'], rows: [] };
	const bigram: Table = { name: 'search_bigram', columns: ['kind', 'ref_id', 'text'], rows: [] };

	let nextId = start.provisionId;
	let nextVersionId = start.versionId;
	for (const lawId of [...lawIds].sort()) {
		const data = load(`law_revisions_${lawId}`) as { law_info: { law_num: string }; revisions: EgovRevision[] };
		// 一覧は新しい順（同じ施行日の版も新しいものが前）なので、逆にすると古い順になる
		const all = [...data.revisions].reverse();
		const base = all.findLastIndex((r) => r.amendment_enforcement_date <= BASELINE_DATE);
		const chosen = all.slice(Math.max(base, 0));
		// 題名は施行済みのうち最新の版から取る（施行予定の改正で題名が変わることがある）
		const latest = data.revisions.find((r) => revisionStatus(r.current_revision_status) === 'enforced')!;
		laws.rows.push([lawId, latest.law_title, latest.law_title_kana, data.law_info.law_num]);
		const texts = chosen.map((r) => (load(`law_data_${r.law_revision_id}`) as { law_full_text: EgovNode }).law_full_text);
		chosen.forEach((r, seq) =>
			revisions.rows.push([
				r.law_revision_id,
				lawId,
				'real',
				seq,
				r.amendment_enforcement_date,
				statusOf(r),
				r.amendment_law_title,
				r.amendment_law_num,
				r.amendment_promulgate_date,
				JSON.stringify(parseHeadings(texts[seq]))
			])
		);

		const history = buildHistory(
			chosen.map((r, i) => ({
				id: r.law_revision_id,
				articles: parseLaw(texts[i])
			})),
			{ hasBaseline: base >= 0, nextId }
		);
		nextId = history.nextId;
		for (const p of history.provisions) provisions.rows.push([p.id, lawId, p.kind, p.parentId]);
		for (const v of history.versions) {
			const versionId = nextVersionId++;
			const search = searchTexts(provisionSearchSource(v));
			if (search) {
				trigram.rows.push(['provision', versionId, search.trigram]);
				bigram.rows.push(['provision', versionId, search.bigram]);
			}
			versions.rows.push([
				versionId,
				v.provisionId,
				v.fromRevisionId,
				v.toRevisionId,
				v.num,
				v.caption,
				v.text,
				v.change,
				v.similarity,
				v.unconfirmedOf
			]);
		}
	}
	// 委員会1（消費者保護）の対象法令。渡した法令のうち対象3法に入るものだけ（設計書 docs/spec/45.md）
	const committeeLaws: Table = {
		name: 'committee_laws',
		columns: ['committee_id', 'law_id'],
		rows: [...lawIds].sort().filter((id) => TARGET_LAWS.includes(id)).map((id) => [1, id])
	};
	// 外部キーを満たす順：laws → law_revisions → provisions（ID順）→ provision_versions → 検索の行 → 委員会の対象法令
	return [laws, revisions, provisions, versions, trigram, bigram, committeeLaws].flatMap(inserts);
}
