// 発言の役のタグ（Issue #169。#198 の決定2）。投稿に列を足さず、読むときに求める
import type { PostKind, PostRole } from './posts';

export type ChairTag = { kind: 'chair'; role: 'chair' | 'director'; committee: string; sessionKey: string };
export type PostTag = { kind: 'bill'; role: PostRole } | { kind: 'asker' } | ChairTag;

/**
 * 発言に付けるタグを、読む順に並べる。
 * 答弁はその法案での役、補足は質疑を書いた人なら「質問者」、どれも書いた時点の会期に委員長か理事なら、その役。
 * 有識者・議員は認証バッジが印なので、タグにしない
 */
export function postTags(kind: PostKind, { role = null, asker = false, chair = null }: { role?: PostRole | null; asker?: boolean; chair?: ChairTag | null }): PostTag[] {
	const tags: PostTag[] = [];
	if (kind === 'answer' && role) tags.push({ kind: 'bill', role });
	if (kind === 'supplement' && asker) tags.push({ kind: 'asker' });
	if (chair) tags.push(chair);
	return tags;
}
