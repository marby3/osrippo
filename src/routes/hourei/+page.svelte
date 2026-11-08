<script lang="ts">
	// 法律の一覧（Issue #85 決めたこと A）。「法律」のタブの行き先
	import { ja } from '#lib/copy/ja.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{ja.laws.pageTitle}</title>
</svelte:head>

<main>
	<h1>{ja.laws.heading}</h1>
	<p class="lead">{ja.laws.lead}</p>
	<ul>
		{#each data.laws as law (law.id)}
			<li><a href="/hourei/{law.id}">{law.title}</a></li>
		{/each}
	</ul>
</main>

<style>
	main {
		max-width: 48rem;
		margin: 0 auto;
		padding: 1rem;
	}

	h1 {
		margin: 0.5rem 0;
		font-size: var(--font-size-page-title);
	}

	.lead {
		color: var(--color-text-sub);
	}

	ul {
		margin: 1rem 0 0;
		padding: 0;
		list-style: none;
	}

	li {
		border-bottom: 1px solid var(--color-divider);
	}

	li a {
		display: flex;
		align-items: center;
		min-height: var(--tap-primary);
		font-size: var(--font-size-heading);
		font-weight: 700;
	}
</style>
