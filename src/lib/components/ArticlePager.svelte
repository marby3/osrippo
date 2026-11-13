<script lang="ts">
	// 条だけのページの前の条・次の条（Issue #164。案 SpLawArticle・PcLawArticle）。スマホは条の番号だけ、PC は見出しも出す
	import { ja } from '../copy/ja';

	type Near = { num: string; label: string; caption: string } | null;
	let { base, prev, next }: { base: string; prev: Near; next: Near } = $props();
</script>

{#if prev || next}
	<nav class="pager" aria-label={ja.lawArticle.pager}>
		{#if prev}
			<a class="prev" href="{base}/{prev.num}"><span class="dir">{ja.lawArticle.prev}</span><strong>{prev.label}<span class="caption">{prev.caption}</span></strong></a>
		{/if}
		{#if next}
			<a class="next" href="{base}/{next.num}"><span class="dir">{ja.lawArticle.next}</span><strong>{next.label}<span class="caption">{next.caption}</span></strong></a>
		{/if}
	</nav>
{/if}

<style>
	.pager {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
		margin: 1rem 0;
	}

	a {
		display: block;
		min-height: var(--tap-min);
		padding: 0.25rem 1rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-m);
		background: var(--color-bg);
		color: var(--color-text);
		text-decoration: none;
		overflow-wrap: anywhere;
	}

	a:hover {
		border-color: var(--color-link);
	}

	.next {
		grid-column: 2;
		text-align: right;
	}

	.dir {
		display: block;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	strong {
		font-size: var(--font-size-sub);
	}

	.caption {
		display: none;
	}

	@media (min-width: 64rem) {
		.pager {
			display: flex;
			justify-content: space-between;
		}

		.next {
			margin-left: auto;
		}

		.caption {
			display: inline;
		}
	}
</style>
