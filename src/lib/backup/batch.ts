// D1 のバックアップのバッチ（Issue #202。手順は docs/backup.md）。自宅サーバーで毎晩動かす（入口は scripts/backup.ts）。
// 書き出し → 変換（全文検索の表を除く） → R2 に置く、の順。どれかが失敗したら例外を投げる（入口が終了コード1にする）。
// 書き出しと置くのは外から渡す（本物は wrangler を呼ぶ。テストは手元の SQL を使う）
import { closeSync, openSync, readSync, rmSync, statSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { convertDump, type BackupTable } from './convert';

/** wrangler r2 object put で置ける大きさの上限（315MB） */
export const MAX_UPLOAD_BYTES = 315 * 1024 * 1024;

/** R2 の置き場所：d1/<環境>/<日本時間の日付>.sql */
export const backupKey = (env: string, date: string) => `d1/${env}/${date}.sql`;

/** 日本時間の日付（YYYY-MM-DD） */
export const jstDate = (now: Date) => new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

export type BackupOptions = {
	/** wrangler の環境の名前（staging など）。置き場所にも使う */
	env: string;
	bucket: string;
	now: Date;
	/** 書き出しと変換のファイルを置くフォルダ。終わったら中のファイルは消す */
	workDir: string;
	/** D1 を path に書き出す（sqlite3 の .dump の形） */
	exportDb: (path: string) => Promise<void>;
	/** path のファイルを R2 の key に置く */
	upload: (key: string, path: string) => Promise<void>;
};

export type BackupResult = { key: string; bytes: number; tables: BackupTable[]; migrations: string[] };

const NAME = /^[a-z0-9][a-z0-9-]{1,62}$/;

/** 書き出しの --compatibility sqlite3_cli_only が使える wrangler の版 */
export const WRANGLER_MIN = '4.162.0';

/** 版（"4.162.0" や "wrangler 4.162.0" の中の x.y.z）が min 以上か。版が読めなければ false */
export function versionAtLeast(version: string, min: string): boolean {
	const parse = (s: string) => /(\d+)\.(\d+)\.(\d+)/.exec(s)?.slice(1).map(Number);
	const v = parse(version);
	const m = parse(min);
	if (!v || !m) return false;
	for (let i = 0; i < 3; i++) if (v[i] !== m[i]) return v[i] > m[i];
	return true;
}

/** ファイルを少しずつ文字列で読む（大きな書き出しを一度に文字列にしない。UTF-8 の文字の途中で切らない） */
export function* readChunks(path: string, size = 4 * 1024 * 1024): Generator<string> {
	const fd = openSync(path, 'r');
	try {
		const buf = Buffer.alloc(size);
		const decoder = new StringDecoder('utf8');
		for (let n; (n = readSync(fd, buf, 0, size, null)) > 0; ) yield decoder.write(buf.subarray(0, n));
		const rest = decoder.end();
		if (rest) yield rest;
	} finally {
		closeSync(fd);
	}
}

export async function runBackup(o: BackupOptions): Promise<BackupResult> {
	if (!NAME.test(o.env)) throw new Error(`環境の名前は英小文字・数字・ハイフンにしてください：${o.env}`);
	if (!NAME.test(o.bucket)) throw new Error(`バケットの名前は英小文字・数字・ハイフンにしてください：${o.bucket}`);
	const date = jstDate(o.now);
	const key = backupKey(o.env, date);
	const dumpPath = join(o.workDir, 'export.sql');
	const loadPath = join(o.workDir, 'load.sqlite');
	const sqlPath = join(o.workDir, `${date}.sql`);
	const cleanup = () => {
		for (const p of [dumpPath, loadPath, `${loadPath}-journal`, sqlPath]) rmSync(p, { force: true });
	};
	cleanup();
	try {
		await o.exportDb(dumpPath);
		if (statSync(dumpPath).size === 0) throw new Error('書き出しが空です');
		const out = openSync(sqlPath, 'w');
		let converted;
		try {
			converted = convertDump(readChunks(dumpPath), (s) => void writeSync(out, s), { createdAt: o.now.toISOString(), dbPath: loadPath });
		} finally {
			closeSync(out);
		}
		const bytes = statSync(sqlPath).size;
		if (bytes > MAX_UPLOAD_BYTES) throw new Error(`変換した SQL が ${bytes} バイトで、R2 に置ける上限（${MAX_UPLOAD_BYTES} バイト）を超えています`);
		await o.upload(key, sqlPath);
		return { key, bytes, ...converted };
	} finally {
		cleanup();
	}
}
