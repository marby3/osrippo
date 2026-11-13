// バックアップと索引の作り直しで、D1 に流す SQL を書く（Issue #202）。DB にも node: にも触れない
/** D1 の1文の上限は 100,000 バイト（https://developers.cloudflare.com/d1/platform/limits/）。これ未満にする */
export const MAX_STATEMENT_BYTES = 100_000;

const encoder = new TextEncoder();
export const byteLength = (s: string) => encoder.encode(s).length;

export const quoteIdent = (name: string) => `"${name.replaceAll('"', '""')}"`;

const quoteText = (s: string) => `'${s.replaceAll("'", "''")}'`;

/** SQLite の値を SQL の書き方にする。DB から読んだ整数は bigint で受ける（2^53 を超える値も崩さない）。小数の値の REAL 列（1.0 など）は、列の型で REAL に戻る */
export function sqlLiteral(v: unknown): string {
	if (v === null || v === undefined) return 'NULL';
	if (typeof v === 'bigint') return v.toString();
	if (typeof v === 'number') {
		if (Number.isNaN(v)) return 'NULL';
		if (!Number.isFinite(v)) return v > 0 ? '9e999' : '-9e999';
		return String(v);
	}
	// 文字列の途中の NUL は、文の終わりと読まれないよう char(0) でつなぐ
	if (typeof v === 'string') return v.includes('\0') ? `(${v.split('\0').map(quoteText).join(' || char(0) || ')})` : quoteText(v);
	if (v instanceof Uint8Array) return `X'${Array.from(v, (b) => b.toString(16).padStart(2, '0')).join('')}'`;
	throw new Error(`SQL に書けない値です：${typeof v}`);
}

/** 行を、1文が上限未満の INSERT 文に分ける（文の終わりの ; と改行を付ける）。1行で上限を超えたら例外 */
export function* insertStatements(verb: string, table: string, columns: string[], rows: Iterable<unknown[]>): Generator<string> {
	const head = `${verb} ${quoteIdent(table)} (${columns.map(quoteIdent).join(', ')}) VALUES\n`;
	const headBytes = byteLength(head);
	let chunk: string[] = [];
	let size = headBytes;
	for (const row of rows) {
		const tuple = `(${row.map(sqlLiteral).join(', ')})`;
		const add = byteLength(tuple) + 2;
		if (headBytes + add >= MAX_STATEMENT_BYTES) throw new Error(`${table} の1行が ${MAX_STATEMENT_BYTES} バイトを超えています`);
		if (chunk.length && size + add >= MAX_STATEMENT_BYTES) {
			yield `${head}${chunk.join(',\n')};\n`;
			chunk = [];
			size = headBytes;
		}
		chunk.push(tuple);
		size += add;
	}
	if (chunk.length) yield `${head}${chunk.join(',\n')};\n`;
}
