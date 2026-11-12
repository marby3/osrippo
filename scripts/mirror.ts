// 公開ミラーのバッチの入口（Issue #155。手順は docs/mirror.md）。自宅サーバーで定期的に動かす。
//   MIRROR_TOKEN=… tsx scripts/mirror.ts --repo <ミラーのリポジトリ> --url https://<Worker の URL> [--no-push]
// トークンは引数にしない（ps やシェルの履歴に残らないように）。失敗したら終了コード1
import { parseArgs } from 'node:util';
import { runMirror } from '../src/lib/mirror/batch';

const { values } = parseArgs({ options: { repo: { type: 'string' }, url: { type: 'string' }, 'no-push': { type: 'boolean', default: false } } });
const token = process.env.MIRROR_TOKEN;
if (!values.repo || !values.url || !token) {
	console.error('使い方：MIRROR_TOKEN=… tsx scripts/mirror.ts --repo <ミラーのリポジトリ> --url <Worker の URL> [--no-push]');
	process.exit(2);
}
const base = values.url.replace(/\/+$/, '');

async function fetchJson(path: string): Promise<unknown> {
	const res = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });
	if (!res.ok) throw new Error(`${path}：${res.status}`);
	return res.json();
}

try {
	const committed = await runMirror({ dir: values.repo, fetchJson, push: !values['no-push'] });
	console.log(committed.length ? `書き出した会期：${committed.join(', ')}` : '新しく確定した会期はありません');
} catch (e) {
	console.error(e);
	process.exitCode = 1;
}
