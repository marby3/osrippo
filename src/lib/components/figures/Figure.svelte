<script lang="ts">
	// 説明の図の枠（Issue #225）。図は1つの絵として読み上げ（role="img" と説明）、中の文字は本文と同じことを示す。
	// 色とサイズは Tokens の変数だけを使う
	import type { Snippet } from 'svelte';

	let { label, children }: { label: string; children: Snippet } = $props();
</script>

<figure class="figure" data-figure role="img" aria-label={label}>
	{@render children()}
</figure>

<style>
	.figure {
		margin: 1rem 0;
		padding: 1rem 0.75rem;
		border: 1px solid var(--color-divider);
		border-radius: var(--radius-l);
		background: var(--color-surface);
		color: var(--color-text);
		font-size: var(--font-size-sub);
		line-height: var(--line-height-body);
	}

	/* 図の中の SVG は、塗らずに線で描く（色は文字の色から） */
	.figure :global(svg) {
		fill: none;
		stroke: currentColor;
	}
</style>
