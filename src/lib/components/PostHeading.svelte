<!--
	発言の見出しの中身（Issue #169、SpBillQA・PcBillQA）。「提出者の答弁」「佐藤 花子 [有識者（消費者法）] の補足」のように、本文の前に読まれる。
	タグは枠のない太字の文字、認証バッジは枠付きの札（PersonName）で、形と文言で見分ける（色だけにしない）。有識者・議員にはタグを足さない
-->
<script lang="ts">
	import { ja } from '../copy/ja';
	import type { PostTag } from '../domain/post-tags';
	import type { PostKind } from '../domain/posts';
	import type { Verified } from '../domain/verification';
	import PersonName from './PersonName.svelte';

	let { kind, author, tags }: { kind: PostKind; author: Verified | null; tags: PostTag[] } = $props();
	const t = ja.post.tags;
</script>

{#if author || tags.length}
	{#if author}<PersonName person={{ name: author.name, verified: author }} />{' '}{/if}{#each tags as tag, i (i)}{#if i > 0}{t.separator}{/if}{#if tag.kind === 'bill'}<strong
				class="tag">{ja.post.roles[tag.role]}</strong
			>{:else if tag.kind === 'asker'}<strong class="tag">{t.asker}</strong>{:else}<strong class="tag">{t.chair(tag.committee, tag.role)}</strong>{t.term(
				tag.sessionKey
			)}{/if}{/each}{t.of(kind)}
{:else}{t.plain(kind)}{/if}

<style>
	.tag {
		color: var(--color-text);
		font-weight: bold;
	}
</style>
