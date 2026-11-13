// バックアップの書き出しの読み方と、戻す表と順（Issue #202）。DB にも node: にも触れない。
// 書き出しは wrangler d1 export --compatibility sqlite3_cli_only（sqlite3 の .dump と同じ形。D1 にはそのまま戻せない）

/** FTS5 の影の表の名前の後ろ（<表>_data など）。仮想表といっしょに書き出しから除く */
export const FTS5_SHADOW_SUFFIXES = ['data', 'idx', 'content', 'docsize', 'config'] as const;

/**
 * 戻す表か。除くのは、sqlite_ の表（番号の続き・統計）、D1 の内部の表（_cf_）、マイグレーションの記録（戻す先にマイグレーションで入る）、
 * 全文検索の仮想表とその影の表（戻したあとで、ほかの表から作り直す）
 */
export function isBackedUp(name: string, virtualTables: readonly string[]): boolean {
	const lower = name.toLowerCase();
	if (lower.startsWith('sqlite_') || lower.startsWith('_cf_') || lower === 'd1_migrations') return false;
	return !virtualTables.some((v) => {
		const base = v.toLowerCase();
		return lower === base || FTS5_SHADOW_SUFFIXES.some((s) => lower === `${base}_${s}`);
	});
}

/** 外部キーを満たす順（参照される表が先）。同じ段は名前の順。自分を指す外部キーは見ない（行は rowid の順に入れる）。循環か、ない表を指していたら例外 */
export function restoreOrder(tables: readonly { name: string; references: readonly string[] }[]): string[] {
	const names = new Set(tables.map((t) => t.name));
	const waiting = new Map<string, Set<string>>();
	for (const t of tables) {
		const refs = new Set(t.references.filter((r) => r !== t.name));
		for (const r of refs) if (!names.has(r)) throw new Error(`${t.name} が、戻さない表 ${r} を指しています`);
		waiting.set(t.name, refs);
	}
	const order: string[] = [];
	while (waiting.size) {
		const ready = [...waiting].filter(([, refs]) => refs.size === 0).map(([name]) => name).sort();
		if (!ready.length) throw new Error(`外部キーが循環しています：${[...waiting.keys()].sort().join(', ')}`);
		for (const name of ready) {
			order.push(name);
			waiting.delete(name);
			for (const refs of waiting.values()) refs.delete(name);
		}
	}
	return order;
}

/** INSERT で動くトリガー（戻すあいだは外す。外さないと、立場を入れたときに履歴が二重になる） */
export function insertTriggers<T extends { sql: string }>(triggers: readonly T[]): T[] {
	return triggers.filter((t) => /\bINSERT\s+ON\b/i.test(t.sql.split(/\bBEGIN\b/i)[0]));
}

/** 文の先頭の名前（"…"・'…'・`…`・[…]・そのまま）を読む */
function readIdent(s: string): string | null {
	const m = /^(?:"((?:[^"]|"")*)"|'((?:[^']|'')*)'|`((?:[^`]|``)*)`|\[([^\]]*)\]|([A-Za-z0-9_$]+))/.exec(s);
	if (!m) return null;
	if (m[1] !== undefined) return m[1].replaceAll('""', '"');
	if (m[2] !== undefined) return m[2].replaceAll("''", "'");
	if (m[3] !== undefined) return m[3].replaceAll('``', '`');
	return m[4] ?? m[5];
}

export type Statement =
	| { kind: 'skip' }
	| { kind: 'table'; table: string }
	| { kind: 'virtual'; table: string }
	| { kind: 'insert'; table: string }
	| { kind: 'delete'; table: string }
	| { kind: 'trigger'; name: string }
	| { kind: 'unknown' };

/** 書き出しの1文の種類と、触る表 */
export function classify(stmt: string): Statement {
	const ident = (re: RegExp) => {
		const m = re.exec(stmt);
		return m ? readIdent(stmt.slice(m[0].length)) : null;
	};
	if (/^(?:PRAGMA|BEGIN|COMMIT|END|ROLLBACK|ANALYZE)\b/i.test(stmt)) return { kind: 'skip' };
	if (/^CREATE\s+(?:UNIQUE\s+)?INDEX\b|^CREATE\s+(?:TEMP\s+|TEMPORARY\s+)?VIEW\b/i.test(stmt)) return { kind: 'skip' };
	let name = ident(/^CREATE\s+VIRTUAL\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?/i);
	if (name !== null) return { kind: 'virtual', table: name };
	name = ident(/^CREATE\s+(?:TEMP\s+|TEMPORARY\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?/i);
	if (name !== null) return { kind: 'table', table: name };
	name = ident(/^CREATE\s+(?:TEMP\s+|TEMPORARY\s+)?TRIGGER\s+(?:IF\s+NOT\s+EXISTS\s+)?/i);
	if (name !== null) return { kind: 'trigger', name };
	name = ident(/^INSERT\s+(?:OR\s+[A-Z]+\s+)?INTO\s+/i);
	if (name !== null) {
		// 仮想表は sqlite_schema への INSERT で書き出される（PRAGMA writable_schema=ON のあと）
		const virtual = /^sqlite_(?:schema|master)$/i.test(name) && /CREATE\s+VIRTUAL\s+TABLE/i.test(stmt) ? /VALUES\s*\(\s*'table'\s*,\s*'((?:[^']|'')*)'/i.exec(stmt) : null;
		return virtual ? { kind: 'virtual', table: virtual[1].replaceAll("''", "'") } : { kind: 'insert', table: name };
	}
	name = ident(/^DELETE\s+FROM\s+/i);
	if (name !== null) return { kind: 'delete', table: name };
	return { kind: 'unknown' };
}

const WORD = /[A-Za-z0-9_$]/;

/**
 * SQL を文に分ける（文の終わりの ; とコメントは除く）。少しずつ渡せる（大きな書き出しを一度に文字列にしない）。
 * 文字列・名前の囲み（' " ` []）とコメント（-- と /* *\/）の中の ; では切らない。トリガーは BEGIN … END（CASE … END は数える）までを1文にする
 */
export class SqlSplitter {
	private buf = '';
	private pending = '';
	private state: 'normal' | 'quote' | 'line' | 'block' = 'normal';
	private close = '';
	private word = '';
	private words: string[] = [];
	private inBody = false;
	private caseDepth = 0;
	private ended = false;

	push(chunk: string): string[] {
		return this.scan(this.pending + chunk, false);
	}

	end(): string[] {
		const out = this.scan(this.pending, true);
		this.endWord();
		const last = this.buf.trim();
		if (last) out.push(last);
		this.reset();
		return out;
	}

	private reset() {
		this.buf = '';
		this.words = [];
		this.inBody = false;
		this.caseDepth = 0;
		this.ended = false;
	}

	private get isTrigger() {
		const [a, b, c] = this.words;
		return a === 'CREATE' && (b === 'TRIGGER' || ((b === 'TEMP' || b === 'TEMPORARY') && c === 'TRIGGER'));
	}

	private endWord() {
		if (!this.word) return;
		const w = this.word.toUpperCase();
		this.word = '';
		if (this.words.length < 3) this.words.push(w);
		if (!this.isTrigger) return;
		if (!this.inBody) {
			if (w === 'BEGIN') this.inBody = true;
		} else if (w === 'CASE') this.caseDepth++;
		else if (w === 'END') {
			if (this.caseDepth > 0) this.caseDepth--;
			else this.ended = true;
		}
	}

	/** 先読みが1文字いるので、最後でなければ末尾の1文字を次に回す */
	private scan(text: string, final: boolean): string[] {
		const out: string[] = [];
		const stop = final ? text.length : text.length - 1;
		let seg = 0;
		let i = 0;
		while (i < stop) {
			if (this.state === 'quote') {
				const j = text.indexOf(this.close, i);
				if (j < 0 || j >= stop) {
					i = stop;
					break;
				}
				if (this.close !== ']' && text[j + 1] === this.close) {
					i = j + 2;
					continue;
				}
				this.state = 'normal';
				i = j + 1;
				continue;
			}
			if (this.state === 'line') {
				const j = text.indexOf('\n', i);
				if (j < 0 || j >= stop) {
					i = stop;
					seg = i;
					break;
				}
				this.state = 'normal';
				i = j + 1;
				seg = i;
				continue;
			}
			if (this.state === 'block') {
				const j = text.indexOf('*/', i);
				if (j < 0) {
					// 閉じがまだ来ていない（最後の1文字は次に回すので、"*" で終わるときも次で見る）
					i = stop;
					seg = i;
					break;
				}
				this.state = 'normal';
				i = j + 2;
				seg = i;
				continue;
			}
			const c = text[i];
			if (WORD.test(c)) {
				this.word += c;
				i++;
				continue;
			}
			this.endWord();
			if (c === "'" || c === '"' || c === '`' || c === '[') {
				this.state = 'quote';
				this.close = c === '[' ? ']' : c;
				i++;
			} else if ((c === '-' && text[i + 1] === '-') || (c === '/' && text[i + 1] === '*')) {
				this.buf += text.slice(seg, i) + ' ';
				this.state = c === '-' ? 'line' : 'block';
				i += 2;
				seg = i;
			} else if (c === ';') {
				if (this.isTrigger && !this.ended) {
					i++;
					continue;
				}
				const stmt = (this.buf + text.slice(seg, i)).trim();
				if (stmt) out.push(stmt);
				this.reset();
				i++;
				seg = i;
			} else i++;
		}
		this.buf += text.slice(seg, i);
		this.pending = text.slice(i);
		return out;
	}
}
