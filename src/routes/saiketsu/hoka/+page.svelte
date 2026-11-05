<script lang="ts">
	// ほかの法案（案はなく、採決の一覧にそろえる）
	import { ja } from '#lib/copy/ja.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const pageHref = (n: number) => (n === 1 ? '/saiketsu/hoka' : `/saiketsu/hoka?page=${n}`);
</script>

<svelte:head>
	<title>{ja.vote.otherPageTitle}</title>
</svelte:head>

<main>
	<nav class="crumbs" aria-label={ja.vote.crumbs}>
		<a href="/saiketsu">{ja.vote.heading}</a> {ja.vote.crumbSeparator} <span>{ja.vote.otherHeading}</span>
	</nav>
	<h1>{ja.vote.otherHeading}</h1>
	<p>{ja.vote.otherLead}</p>

	{#if data.rows.length}
		<ul>
			{#each data.rows as row (row.id)}
				<li>
					<a href="/saiketsu/{row.id}">{row.title}</a>
					<span class="state">{row.voted ? ja.vote.voted : ja.vote.notYet}</span>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="empty">{ja.vote.otherEmpty}</p>
	{/if}

	{#if data.page > 1 || data.hasNext}
		<nav class="pages" aria-label={ja.vote.pages}>
			{#if data.page > 1}<a href={pageHref(data.page - 1)}>{ja.vote.prevPage}</a>{/if}
			{#if data.hasNext}<a href={pageHref(data.page + 1)}>{ja.vote.nextPage}</a>{/if}
		</nav>
	{/if}
</main>

<style>
	main {
		max-width: 47rem;
		margin: 0 auto;
		padding: 1rem;
	}

	.crumbs {
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	h1 {
		margin: 0.5rem 0 0;
		font-size: var(--font-size-page-title);
	}

	ul {
		margin: 1rem 0 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: grid;
		gap: 0.25rem;
		padding: 0.75rem 0;
		border-top: 1px solid var(--color-divider);
	}

	li a {
		overflow-wrap: anywhere;
	}

	.state,
	.empty {
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	.pages {
		display: flex;
		gap: 1rem;
		margin-top: 1.5rem;
	}
</style>
