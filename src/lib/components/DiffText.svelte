<script lang="ts">
	import type { DiffPart } from '#lib/domain/law/compare.ts';
	import { glossParts } from '#lib/domain/law/glossary.ts';
	import LawText from './LawText.svelte';

	/** show：削除だけ（改正前）、追加だけ（改正後）、両方（1つの文の中で示す） */
	let { parts, show = 'both' }: { parts: DiffPart[]; show?: 'removed' | 'added' | 'both' } = $props();
</script>

<!-- 変更点は色だけで示さない：削除は取り消し線と「−」、追加は下線と「＋」。読み仮名は部分ごとに付ける（切れ目が言葉の途中なら付かない。Issue #129 基準6） -->
<p class="text">
	{#each glossParts(parts) as part}
		{#if part.removed}
			{#if show !== 'added'}<del>−<LawText segments={part.segments} /></del>{/if}
		{:else if part.added}
			{#if show !== 'removed'}<ins>＋<LawText segments={part.segments} /></ins>{/if}
		{:else}<LawText segments={part.segments} />{/if}
	{/each}
</p>

<style>
	.text {
		line-height: var(--line-height-law);
		white-space: pre-line;
	}

	del {
		background: var(--color-del-bg);
		color: var(--color-del-text);
		text-decoration: line-through;
	}

	ins {
		background: var(--color-ins-bg);
		color: var(--color-ins-text);
		text-decoration: underline;
	}
</style>
