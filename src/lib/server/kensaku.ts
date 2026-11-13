// 全体の検索（/kensaku）の法令と条文の欄（Issue #208）。遊べる法律を先に、読める法律をあとに並べ、offset から limit 件で切る。
// 読める法律の探し方（どの行を出すか、言葉の長さ）は法律の一覧の検索（law-list.ts。Issue #163）と同じ関数を使う
import type { Word } from '../domain/search';
import type { Db } from './law';
import { countReadableArticles, readableTooShort, searchPlayableLawNames, searchReadableArticles, searchReadableLawNames } from './law-list';
import { PROVISION_CAP, searchLaws, searchProvisions } from './search';

/**
 * 法令の欄：遊べる法律を先に、読める法律を五十音の順にあとに。href が null ならリンクにしない。
 * どちらも読める法律の表の法令名・読み・略称・法令番号で当てる（/hourei と同じ規則）。遊べる法律は、読める法律の表に行がなくても題名で当てる
 */
export async function searchLawSection(db: Db, words: Word[], limit: number, offset: number) {
	const playable = await searchLaws(db, words, await searchPlayableLawNames(db, words));
	const rows: { id: string; title: string; href: string | null }[] = playable
		.slice(offset, offset + limit)
		.map((l) => ({ id: l.id, title: l.title, href: `/hourei/${l.id}` }));
	const readable = await searchReadableLawNames(db, words, limit - rows.length, Math.max(0, offset - playable.length));
	for (const r of readable.rows) rows.push({ id: r.id, title: r.title, href: r.linked ? `/hourei/${r.id}` : null });
	return { total: playable.length + readable.total, rows };
}

/**
 * 条文の欄：遊べる法律の条・項・号（いまの全文検索）を先に、読める法律の条（3文字以上の言葉だけ）をあとに。あわせて PROVISION_CAP 件まで並べる。
 * 読める法律の条は、並べられる件数（＋1件）まで数えて止める。exact が false なら、件数は少なくとも total 件（上限を超えたか、索引の窓を使い切った）
 */
export async function searchArticleSection(db: Db, words: Word[], limit: number, offset: number) {
	const playable = await searchProvisions(db, words);
	const listed = playable.rows.length;
	const room = PROVISION_CAP - listed;
	const readableShort = readableTooShort(words);
	// 遊べる法律だけで上限を超えていれば、読める法律の条は並ばないので数えない
	const counted = readableShort || playable.total > PROVISION_CAP ? { n: 0, windowFull: false } : await countReadableArticles(db, words, room + 1);
	const readableTotal = counted.n;
	const total = playable.total + readableTotal;
	const rows: { lawTitle: string; position: string; href: string; text: string }[] = playable.rows
		.slice(offset, offset + limit)
		.map((r) => ({ lawTitle: r.lawTitle, position: r.position, href: r.href, text: r.text }));
	const readableOffset = Math.max(0, offset - listed);
	const need = Math.min(limit - rows.length, Math.min(readableTotal, room) - readableOffset);
	if (need > 0) {
		for (const a of await searchReadableArticles(db, words, need, readableOffset, room + 1))
			rows.push({ lawTitle: a.lawTitle, position: a.label, href: `/hourei/${a.lawId}/${a.num}`, text: a.text });
	}
	return {
		total,
		capped: total > PROVISION_CAP,
		exact: readableShort || (playable.total <= PROVISION_CAP && readableTotal <= room && !counted.windowFull),
		readableShort,
		rows
	};
}
