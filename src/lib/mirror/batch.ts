// 公開ミラーのバッチ（Issue #155。#147 決めること23）。自宅サーバーで動かす（入口は scripts/mirror.ts）。
// ミラーのリポジトリの .osrippo-mirror の次の会期から古い順に、会期ごとに1コミットする。Worker の中では読まない（node:fs と git を使う）
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CREDIT, isSessionKey, mirrorFiles, PROGRESS_FILE, sessionName, type MirrorSnapshot } from '../domain/mirror';

/** 書き出しの入口を読む。path は "/mirror?after=…" か "/mirror/2035-04" */
export type MirrorFetch = (path: string) => Promise<unknown>;

// コミットの作者。メールは GitHub のアカウントにつながらない値にする
const AUTHOR = { GIT_AUTHOR_NAME: CREDIT, GIT_AUTHOR_EMAIL: 'mirror@osrippo.invalid', GIT_COMMITTER_NAME: CREDIT, GIT_COMMITTER_EMAIL: 'mirror@osrippo.invalid' };

/**
 * 続きの会期を書き出す。push が false なら押さない（--no-push）。コミットした会期を返す。
 * 途中で失敗しても、コミットした会期は .osrippo-mirror に残るので、次はその続きから進む（押すのは次に流したとき）
 */
export async function runMirror({ dir, fetchJson, push }: { dir: string; fetchJson: MirrorFetch; push: boolean }): Promise<string[]> {
	const git = (...args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: dir, env: { ...process.env, ...AUTHOR }, stdio: ['ignore', 'pipe', 'inherit'] });
	const progress = join(dir, PROGRESS_FILE);
	const last = existsSync(progress) ? readFileSync(progress, 'utf8').trim() : null;
	if (last !== null && !isSessionKey(last)) throw new Error(`${PROGRESS_FILE} の会期の形が違います：${last}`);

	const list = (await fetchJson(last === null ? '/mirror' : `/mirror?after=${last}`)) as { sessions?: unknown };
	if (!Array.isArray(list.sessions) || !list.sessions.every((k) => typeof k === 'string' && isSessionKey(k))) throw new Error('書き出せる会期の一覧の形が違います');
	const keys = (list.sessions as string[]).filter((k) => last === null || k > last).sort();

	const committed: string[] = [];
	for (const key of keys) {
		const snapshot = (await fetchJson(`/mirror/${key}`)) as MirrorSnapshot;
		if (snapshot?.key !== key || !Array.isArray(snapshot.laws)) throw new Error(`会期 ${key} の中身の形が違います`);
		const files = mirrorFiles(snapshot);
		// 前の会期の中身を消してから書く（廃止した法令のフォルダと、なくなった条のファイルが残らないように）
		for (const entry of readdirSync(dir)) if (entry !== '.git') rmSync(join(dir, entry), { recursive: true, force: true });
		for (const [path, content] of files) {
			mkdirSync(dirname(join(dir, path)), { recursive: true });
			writeFileSync(join(dir, path), content);
		}
		git('add', '--all');
		git('commit', '--quiet', '--message', sessionName(key));
		committed.push(key);
	}
	if (push && (committed.length || unpushed(git))) git('push', '--quiet', '--set-upstream', 'origin', 'HEAD');
	return committed;
}

/** 前に流したときに押せなかったコミットがあるか（押す先の枝がまだなければ、コミットがあれば押す） */
function unpushed(git: (...args: string[]) => Buffer): boolean {
	try {
		return git('rev-list', '--count', '@{upstream}..HEAD').toString().trim() !== '0';
	} catch {
		try {
			return git('rev-list', '--count', 'HEAD').toString().trim() !== '0';
		} catch {
			return false;
		}
	}
}
