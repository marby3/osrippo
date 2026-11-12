// 公開ミラーの書き出しの形（Issue #155。#147 決めること22）。DB にも画面にも触れない純粋な関数。
// 書き出す先は GitHub の公開リポジトリで、画面ではないので、文言はここに置く
import { articleBodyText, articleLabel } from './law';
import type { Paragraph } from './law';

export type MirrorArticle = { num: string; caption: string; paragraphs: Paragraph[] };
export type MirrorLaw = { id: string; title: string; enacted: boolean; articles: MirrorArticle[] };
export type MirrorSnapshot = { key: string; laws: MirrorLaw[] };

/** 書き出しの進み（最後に書き出した会期）を書くファイル */
export const PROGRESS_FILE = '.osrippo-mirror';
export const CREDIT = 'オープンソース立法府 投稿者一同';

/** カレンダーの月の会期（"2035-04"）か。分の会期（開発用）は書き出さない */
export const isSessionKey = (key: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(key);

/** "2035-04" → "2035年4月の会期"（コミットのメッセージ） */
export function sessionName(key: string): string {
	const [y, m] = key.split('-');
	return `${y}年${Number(m)}月の会期`;
}

/** 条のファイル名（"3_2" → "第3条の2.md"） */
export const articleFileName = (num: string) => `${articleLabel(num)}.md`;

/** Markdown の記号として読まれる文字を、文字のまま出す */
function escape(text: string): string {
	return text.replace(/[\\`*_[\]<>#|~]/g, '\\$&').replace(/^([-+=]|\d+[.)])/, '\\$1');
}

/** 条の Markdown：1行目に条の番号と見出し、そのあとに項（2項から番号付き）と号を段落に分けて並べる */
export function articleMarkdown(article: MirrorArticle): string {
	const heading = `# ${articleLabel(article.num)}${article.caption ? `　${escape(article.caption)}` : ''}`;
	const lines = articleBodyText(article.paragraphs).split('\n').map(escape);
	return `${[heading, ...lines].join('\n\n')}\n`;
}

const link = (path: string) => encodeURI(path);
const NOTICE = 'これは架空の法令です。「オープンソース立法府」の参加者が可決した改正を、現行法に重ねた「もう一つの日本の法律（IF世界）」で、現実の法令ではありません。';

function lawReadme(law: MirrorLaw): string {
	const lines = [`# ${escape(law.title)}`, '', NOTICE, ''];
	if (law.enacted) lines.push('IF世界で制定した法令です。', '');
	for (const a of law.articles) lines.push(`- [${articleLabel(a.num)}](${link(articleFileName(a.num))})`);
	return `${lines.join('\n')}\n`;
}

function rootReadme(snapshot: MirrorSnapshot): string {
	return `${[
		'# オープンソース立法府 IF世界の法令',
		'',
		NOTICE,
		'',
		`この内容は ${sessionName(snapshot.key)}の処理を終えた時点のものです。会期ごとに1つのコミットにしています。`,
		'',
		'## 法令の一覧',
		'',
		...snapshot.laws.map((l) => `- [${escape(l.title)}](${link(`${l.id}/`)})${l.enacted ? '（IF世界で制定）' : ''}`),
		'',
		'## ライセンス',
		'',
		'[クリエイティブ・コモンズ 表示 4.0 国際（CC BY 4.0）](https://creativecommons.org/licenses/by/4.0/deed.ja)',
		'',
		`クレジット：${CREDIT}`,
		'',
		'現実の法令の本文は、e-Gov法令検索（デジタル庁）のデータを基にしています。'
	].join('\n')}\n`;
}

/** 1つの会期のリポジトリの中身（パス → 中身）。法令のフォルダは法令の ID。パスにならない ID や番号は投げる（受け取った JSON をそのままパスにしない） */
export function mirrorFiles(snapshot: MirrorSnapshot): Map<string, string> {
	if (!isSessionKey(snapshot.key)) throw new Error(`会期の形が違います：${snapshot.key}`);
	for (const law of snapshot.laws) {
		if (!/^[A-Za-z0-9-]+$/.test(law.id)) throw new Error(`法令の ID の形が違います：${law.id}`);
		for (const a of law.articles) if (!/^\d+(_\d+)*$/.test(a.num)) throw new Error(`条の番号の形が違います：${law.id} ${a.num}`);
	}
	const files = new Map<string, string>([
		['README.md', rootReadme(snapshot)],
		[PROGRESS_FILE, `${snapshot.key}\n`]
	]);
	for (const law of snapshot.laws) {
		files.set(`${law.id}/README.md`, lawReadme(law));
		for (const a of law.articles) files.set(`${law.id}/${articleFileName(a.num)}`, articleMarkdown(a));
	}
	return files;
}
