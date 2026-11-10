<script lang="ts">
	// 条の項と号（現実の法令ページと IF世界の法令ページで共通）
	import { itemLabel } from '../domain/law/display';
	import LawText from './LawText.svelte';
	import type { Paragraph } from '../domain/law';

	let { paragraphs }: { paragraphs: Paragraph[] } = $props();
</script>

{#each paragraphs as paragraph, i (paragraph.num)}
	<div class="paragraph">
		<p>{#if i > 0}<span class="num">{paragraph.num}</span>{/if}<LawText text={paragraph.text} /></p>
		{#if paragraph.items.length}
			<ol>
				{#each paragraph.items as item (item.num)}
					<li><span class="num">{itemLabel(item.num)}</span><LawText text={item.text} /></li>
				{/each}
			</ol>
		{/if}
	</div>
{/each}

<style>
	.paragraph p,
	.paragraph li {
		margin: 0;
		line-height: var(--line-height-law);
		/* 号の細分（イ、ロ、ハ）は改行して出す */
		white-space: pre-line;
	}

	.paragraph ol {
		margin: 0;
		padding-left: 1em;
		list-style: none;
	}

	.num {
		margin-right: 1em;
	}
</style>
