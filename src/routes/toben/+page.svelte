<!-- 答弁イベントの一覧（Issue #153） -->
<script lang="ts">
	import TobenItem from '#lib/components/TobenItem.svelte';
	import { ja } from '#lib/copy/ja.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const parts = $derived([
		{ key: 'upcoming', label: ja.toben.upcoming, rows: data.list.upcoming },
		{ key: 'live', label: ja.toben.live, rows: data.list.live },
		{ key: 'ended', label: ja.toben.ended, rows: data.list.ended }
	]);
</script>

<svelte:head>
	<title>{ja.toben.listTitle}</title>
</svelte:head>

<main class="frame">
	<h1>{ja.toben.heading}</h1>
	<p class="lead">{ja.toben.lead}</p>
	{#each parts as part (part.key)}
		<section aria-labelledby="toben-{part.key}">
			<h2 id="toben-{part.key}">{part.label}</h2>
			{#if part.rows.length === 0}
				<p class="empty">{ja.toben.empty}</p>
			{:else}
				<ul>
					{#each part.rows as e (e.id)}<TobenItem {e} showState />{/each}
				</ul>
				{#if part.key === 'ended' && part.rows.length >= 50}<p class="empty">{ja.toben.endedCap}</p>{/if}
			{/if}
		</section>
	{/each}
</main>

<style>
	main {
		padding-top: 1rem;
		padding-bottom: 2rem;
	}

	h1 {
		font-size: var(--font-size-page-title);
	}

	h2 {
		margin-top: 1.5rem;
		font-size: var(--font-size-heading);
	}

	.lead,
	.empty {
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
</style>
