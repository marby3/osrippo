// e-Gov のデータ（今はテストデータ）から、法令と版の DB に入れる SQL を作る（設計書 docs/spec/8.md）
import { BASELINE_DATE, buildHistory, parseLaw, type EgovNode } from '../domain/law';

/** 対象3法：景品表示法、特定商取引法、消費者契約法（法令ID順） */
export const TARGET_LAWS = ['337AC0000000134', '351AC0000000057', '412AC0000000061'];

type EgovRevision = {
	law_revision_id: string;
	law_title: string;
	law_title_kana: string | null;
	amendment_enforcement_date: string;
	amendment_law_title: string | null;
	amendment_law_num: string | null;
	amendment_promulgate_date: string | null;
	current_revision_status: string;
};

type Value = string | number | null;
type Table = { name: string; columns: string[]; rows: Value[][] };

const MAX_ROWS = 100;
const MAX_BYTES = 100_000;

const STATUS: Record<string, 'enforced' | 'scheduled'> = {
	CurrentEnforced: 'enforced',
	PreviousEnforced: 'enforced',
	UnEnforced: 'scheduled'
};

const literal = (v: Value) => (v === null ? 'NULL' : typeof v === 'number' ? String(v) : `'${v.replaceAll("'", "''")}'`);

/** D1 が受け付ける形にする：トランザクション文なし、1文 100 行まで・100KB 未満 */
function inserts({ name, columns, rows }: Table): string[] {
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
	const status = STATUS[r.current_revision_status];
	if (!status) throw new Error(`${r.law_revision_id}：知らない状態 ${r.current_revision_status}`);
	return status;
}

/** load(name) は tests/fixtures/egov/<name>.json の中身を返す */
export function seedStatements(lawIds: string[], load: (name: string) => unknown): string[] {
	const laws: Table = { name: 'laws', columns: ['id', 'title', 'title_kana', 'law_num'], rows: [] };
	const revisions: Table = {
		name: 'law_revisions',
		columns: ['id', 'law_id', 'branch', 'seq', 'enforcement_date', 'status', 'amendment_law_title', 'amendment_law_num', 'amendment_promulgate_date'],
		rows: []
	};
	const provisions: Table = { name: 'provisions', columns: ['id', 'law_id', 'kind', 'parent_id'], rows: [] };
	const versions: Table = {
		name: 'provision_versions',
		columns: ['id', 'provision_id', 'from_revision_id', 'to_revision_id', 'num', 'caption', 'text', 'change', 'similarity', 'unconfirmed_of'],
		rows: []
	};

	let nextId = 1;
	let nextVersionId = 1;
	for (const lawId of [...lawIds].sort()) {
		const data = load(`law_revisions_${lawId}`) as { law_info: { law_num: string }; revisions: EgovRevision[] };
		// 一覧は新しい順（同じ施行日の版も新しいものが前）なので、逆にすると古い順になる
		const all = [...data.revisions].reverse();
		const base = all.findLastIndex((r) => r.amendment_enforcement_date <= BASELINE_DATE);
		const chosen = all.slice(Math.max(base, 0));
		// 題名は施行済みのうち最新の版から取る（施行予定の改正で題名が変わることがある）
		const latest = data.revisions.find((r) => STATUS[r.current_revision_status] === 'enforced')!;
		laws.rows.push([lawId, latest.law_title, latest.law_title_kana, data.law_info.law_num]);
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
				r.amendment_promulgate_date
			])
		);

		const history = buildHistory(
			chosen.map((r) => ({
				id: r.law_revision_id,
				articles: parseLaw((load(`law_data_${r.law_revision_id}`) as { law_full_text: EgovNode }).law_full_text)
			})),
			{ hasBaseline: base >= 0, nextId }
		);
		nextId = history.nextId;
		for (const p of history.provisions) provisions.rows.push([p.id, lawId, p.kind, p.parentId]);
		for (const v of history.versions) {
			versions.rows.push([
				nextVersionId++,
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
	// 外部キーを満たす順：laws → law_revisions → provisions（ID順）→ provision_versions
	return [laws, revisions, provisions, versions].flatMap(inserts);
}
