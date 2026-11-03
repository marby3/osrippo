<script lang="ts">
	import { goto } from '$app/navigation';
	import { ja } from '#lib/copy/ja.ts';
	import { listHref, SORTS, type Sort } from '#lib/domain/issues.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const q = $derived(data.query);
	const filters = [
		['all', ja.issue.filterAll],
		['current', ja.issue.filterTopic]
	] as const;
</script>

<svelte:head>
	<title>{ja.issue.listPageTitle}</title>
</svelte:head>

<main>
	<header>
		<h1>{ja.issue.heading}</h1>
		<a class="write" href="/kadai/kaku"><span aria-hidden="true">＋</span> {ja.issue.write}</a>
	</header>

	<div class="controls">
		<nav aria-label={ja.issue.filterLabel}>
			{#each filters as [topic, label] (topic)}
				<a
					class="chip"
					href={listHref({ ...q, topic, page: 1 })}
					aria-current={q.topic === topic ? 'page' : undefined}>{label}</a
				>
			{/each}
		</nav>
		<label class="sort">
			{ja.issue.sortLabel}：
			<select value={q.sort} onchange={(e) => goto(listHref({ ...q, sort: e.currentTarget.value as Sort, page: 1 }))}>
				{#each SORTS as sort (sort)}
					<option value={sort}>{ja.issue.sorts[sort]}</option>
				{/each}
			</select>
		</label>
		<noscript>
			<p>
				{#each SORTS as sort (sort)}
					<a href={listHref({ ...q, sort, page: 1 })}>{ja.issue.sorts[sort]}</a>
				{/each}
			</p>
		</noscript>
	</div>

	{#if data.rows.length === 0}
		<!-- 「課題を書く」は見出しの横の1つだけ -->
		<p class="empty">{q.topic === 'current' ? ja.issue.emptyTopic : ja.issue.empty}</p>
	{:else}
		<table>
			<thead>
				<tr>
					<th scope="col">{ja.issue.columnTitle}</th>
					<th scope="col" class="num">{ja.issue.columnSupports}</th>
					<th scope="col">{ja.issue.columnTopic}</th>
				</tr>
			</thead>
			<tbody>
				{#each data.rows as row (row.id)}
					<tr>
						<td class="title"><a href="/kadai/{row.id}">{row.title}</a></td>
						<td class="num"><span class="label">{ja.issue.supports}</span> {row.supports}</td>
						<td class="topic">{row.topicName ? ja.issue.topicMark(row.topicName) : ''}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}

	{#if q.page > 1 || data.hasNext}
		<nav class="pages">
			{#if q.page > 1}<a href={listHref({ ...q, page: q.page - 1 })}>{ja.issue.prevPage}</a>{/if}
			{#if data.hasNext}<a href={listHref({ ...q, page: q.page + 1 })}>{ja.issue.nextPage}</a>{/if}
		</nav>
	{/if}
</main>

<style>
	main {
		max-width: 72rem;
		margin: 0 auto;
		padding: 1rem;
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	h1 {
		font-size: var(--font-size-page-title);
	}

	.write {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap-primary);
		padding: 0 1.25rem;
		border-radius: var(--radius-m);
		background: var(--color-base);
		color: var(--color-bg);
		font-weight: bold;
		text-decoration: none;
	}

	.controls {
		display: grid;
		gap: 0.75rem;
		margin: 1rem 0;
	}

	.controls nav {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap-min);
		padding: 0 1rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-pill);
		color: var(--color-text);
		text-decoration: none;
	}

	.chip[aria-current='page'] {
		background: var(--color-base);
		border-color: var(--color-base);
		color: var(--color-bg);
	}

	.sort select {
		min-height: var(--tap-min);
		font: inherit;
		font-weight: bold;
	}

	table {
		width: 100%;
		border-collapse: collapse;
	}

	th {
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
		font-weight: normal;
		text-align: left;
		border-bottom: 2px solid var(--color-text);
		padding: 0.5rem;
	}

	td {
		border-bottom: 1px solid var(--color-divider);
		padding: 1rem 0.5rem;
	}

	.num {
		text-align: right;
		white-space: nowrap;
	}

	.title a {
		color: var(--color-text);
		font-weight: bold;
	}

	.label {
		display: none;
	}

	.topic {
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	.pages {
		display: flex;
		justify-content: space-between;
		margin-top: 1rem;
	}

	.pages a {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap-min);
	}

	/* スマホは縦の並び（SpIssues）：タイトルの下に「わかる 214 ・ お題」 */
	@media (max-width: 40rem) {
		thead {
			display: none;
		}

		tr {
			display: block;
			border-bottom: 1px solid var(--color-divider);
			padding: 1rem 0;
		}

		td {
			display: inline;
			border: none;
			padding: 0;
		}

		.title {
			display: block;
			margin-bottom: 0.25rem;
		}

		.title a {
			text-decoration: none;
		}

		.num,
		.topic {
			color: var(--color-text-sub);
			font-size: var(--font-size-sub);
		}

		.label {
			display: inline;
		}

		.topic:not(:empty)::before {
			content: ' ・ ';
		}
	}
</style>
