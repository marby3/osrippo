<script lang="ts">
	// 現実の改正の取り込みの一覧。全ページに帯と「架空の法令」、noindex。ぶつかった条文は現実と IF世界を並べる
	import IfBand from '#lib/components/IfBand.svelte';
	import { ja } from '#lib/copy/ja.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const href = (page: number) => `/if/hourei/${data.law.id}/torikomi${page > 1 ? `?page=${page}` : ''}`;
</script>

<svelte:head>
	<title>{ja.torikomi.pageTitle(data.law.title)}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<IfBand />

<main>
	<header>
		<p class="fictional">{ja.ifLaw.fictional}</p>
		<p class="law"><a href="/if/hourei/{data.law.id}">{data.law.title}</a></p>
		<h1>{ja.torikomi.heading}</h1>
		<p class="sub">{ja.torikomi.intro}</p>
	</header>

	{#if data.imports.length === 0}
		<p>{ja.torikomi.empty}</p>
	{/if}

	{#each data.imports as item (item.key)}
		<section data-import>
			<h2>{ja.torikomi.enforced(item.date)}</h2>
			{#if item.amendmentTitle}<p class="sub">{item.amendmentTitle}{item.amendmentNum ? `（${item.amendmentNum}）` : ''}</p>{/if}

			{#if item.changed.length === 0 && item.conflicts.length === 0}
				<p>{ja.torikomi.noChange}</p>
			{/if}

			{#if item.changed.length}
				<h3>{ja.torikomi.changedHeading}</h3>
				<ul data-changed>
					{#each item.changed as row (row.num)}
						<li>{row.prevLabel ? ja.torikomi.moved(row.prevLabel, row.label) : row.label}<span class="kind">{ja.torikomi.changes[row.change]}</span></li>
					{/each}
				</ul>
			{/if}

			{#if item.conflicts.length}
				<h3>{ja.torikomi.conflictsHeading}</h3>
				{#each item.conflicts as row (row.num)}
					<article data-conflict>
						<div class="side">
							<h4>{ja.torikomi.real}：{row.prevLabel ? ja.torikomi.moved(row.prevLabel, row.label) : row.label}<span class="caption">{row.realCaption}</span></h4>
							{#if row.realBody === null}<p class="note">{ja.torikomi.realGone}</p>{:else}<p class="law-text">{row.realBody}</p>{/if}
						</div>
						<div class="side if">
							<h4>{ja.torikomi.ifWorld}：{row.ifLabel}<span class="caption">{row.ifCaption}</span></h4>
							{#if row.ifBody === null}<p class="note">{ja.torikomi.ifDeleted}</p>{:else}<p class="law-text">{row.ifBody}</p>{/if}
							{#if row.bill}<p class="by">{ja.torikomi.changedBy}<a href="/houan/{row.bill.id}">{row.bill.title}</a></p>{/if}
						</div>
					</article>
				{/each}
			{/if}
		</section>
	{/each}

	{#if data.page > 1 || data.hasNext}
		<nav class="pages">
			{#if data.page > 1}<a href={href(data.page - 1)}>{ja.unei.prevPage}</a>{/if}
			{#if data.hasNext}<a href={href(data.page + 1)}>{ja.unei.nextPage}</a>{/if}
		</nav>
	{/if}

	<p class="back"><a href="/if/hourei/{data.law.id}">{ja.torikomi.back}</a></p>
</main>

<style>
	main {
		max-width: 60rem;
		margin: 0 auto;
		padding: 1rem;
		overflow-wrap: anywhere;
	}

	.fictional {
		display: inline-block;
		margin: 0;
		padding: 0 0.5rem;
		border: 1px solid var(--color-if);
		border-radius: var(--radius-s);
		color: var(--color-if);
		font-size: var(--font-size-sub);
		font-weight: bold;
	}

	.law {
		margin: 0.5rem 0 0;
		font-size: var(--font-size-sub);
	}

	h1 {
		margin: 0.25rem 0 0;
		font-size: var(--font-size-page-title);
	}

	.sub {
		margin: 0.25rem 0 0;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	section {
		margin-top: 1.5rem;
		padding-top: 1rem;
		border-top: 1px solid var(--color-divider);
	}

	h2 {
		margin: 0;
		font-size: var(--font-size-body);
	}

	h3 {
		margin: 1rem 0 0.25rem;
		font-size: var(--font-size-sub);
	}

	ul {
		margin: 0;
		padding-left: 1.25em;
	}

	.kind {
		margin-left: 0.5em;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	article {
		display: grid;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}

	.side {
		padding: 0.75rem 1rem;
		border: 1px solid var(--color-divider);
		border-radius: var(--radius-m);
		min-width: 0;
	}

	.side.if {
		border: 2px solid var(--color-if);
	}

	h4 {
		margin: 0 0 0.25rem;
		font-size: var(--font-size-sub);
	}

	.caption {
		margin-left: 0.5em;
		color: var(--color-text-sub);
		font-weight: normal;
	}

	.law-text {
		margin: 0;
		white-space: pre-line;
	}

	.note {
		margin: 0;
		color: var(--color-text-sub);
	}

	.by {
		margin: 0.5rem 0 0;
		font-size: var(--font-size-sub);
	}

	.pages {
		display: flex;
		gap: 1rem;
		margin-top: 1.5rem;
	}

	.back {
		margin-top: 1.5rem;
	}

	@media (min-width: 64rem) {
		article {
			grid-template-columns: 1fr 1fr;
		}
	}
</style>
