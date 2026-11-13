<script lang="ts">
	// 「この条の URL」とコピー（Issue #164。案 SpLawArticle・PcLawArticle）。
	// URL は読み取りだけの欄に入れるので、スクリプトがなくても読めて選べる。コピーのボタンはスクリプトが動いてから出す
	import { onMount } from 'svelte';
	import { ja } from '../copy/ja';

	let { url }: { url: string } = $props();
	let ready = $state(false);
	let status = $state('');
	let input = $state<HTMLInputElement>();

	onMount(() => (ready = true));

	async function copy() {
		try {
			await navigator.clipboard.writeText(url);
			status = ja.lawArticle.copied;
		} catch {
			input?.select();
			status = ja.lawArticle.copyFailed;
		}
	}
</script>

<div class="share">
	<label for="article-url">{ja.lawArticle.url}</label>
	<div class="row">
		<input id="article-url" type="text" readonly value={url} bind:this={input} onfocus={(e) => e.currentTarget.select()} />
		{#if ready}<button type="button" onclick={copy}>{ja.lawArticle.copy}</button>{/if}
	</div>
	<p class="status" role="status">{status}</p>
</div>

<style>
	label {
		display: block;
		margin-bottom: 0.5rem;
		font-size: var(--font-size-sub);
		font-weight: bold;
	}

	.row {
		display: flex;
		gap: 0.5rem;
	}

	input {
		flex: 1;
		min-width: 0;
		min-height: var(--tap-min);
		padding: 0 0.75rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-m);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		font-size: var(--font-size-sub);
	}

	button {
		min-height: var(--tap-min);
		padding: 0 1rem;
		border: 1px solid var(--color-base);
		border-radius: var(--radius-m);
		background: var(--color-bg);
		color: var(--color-text);
		font: inherit;
		font-weight: bold;
	}

	.status {
		margin: 0.25rem 0 0;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	.status:empty {
		margin: 0;
	}
</style>
