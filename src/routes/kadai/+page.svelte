<script lang="ts">
	import { goto } from '$app/navigation';
	import { ja } from '#lib/copy/ja.ts';
	import { listHref, SORTS, type Sort } from '#lib/domain/issues.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const q = $derived(data.query);
	// 絞り込みは1つだけ選ぶ（今回のお題と解決策ありは一緒に選べない）
	const filters = [
		{ key: 'all', label: ja.issue.filterAll, topic: 'all', solutions: false },
		{ key: 'current', label: ja.issue.filterTopic, topic: 'current', solutions: false },
		{ key: 'solutions', label: ja.issue.filterSolutions, topic: 'all', solutions: true }
	] as const;
	const selected = $derived(q.solutions ? 'solutions' : q.topic);
</script>

<svelte:head>
	<title>{ja.issue.listPageTitle}</title>
	{#if q.q.trim()}<meta name="robots" content="noindex" />{/if}
</svelte:head>

<main class="frame">
	<header>
		<h1>{ja.issue.heading}</h1>
		<a class="write" href="/kadai/kaku"><span aria-hidden="true">＋</span> {ja.issue.write}</a>
	</header>

	<!-- 課題を探す（設計書 docs/spec/38.md 決めたこと5）。今の並びと絞り込みは残す -->
	<form method="get" action="/kadai" class="search">
		{#if q.sort !== 'support'}<input type="hidden" name="sort" value={q.sort} />{/if}
		{#if q.topic !== 'all'}<input type="hidden" name="topic" value={q.topic} />{/if}
		{#if q.solutions}<input type="hidden" name="kaiketsu" value="ari" />{/if}
		<label for="issue-search">{ja.search.issueLabel}</label>
		<div class="search-row">
			<input id="issue-search" name="q" type="search" value={q.q} maxlength="60" />
			<button>{ja.search.submit}</button>
		</div>
	</form>
	{#if data.searchError}<p role="alert">{ja.search.errors[data.searchError]}</p>{/if}

	<div class="controls">
		<nav aria-label={ja.issue.filterLabel}>
			{#each filters as f (f.key)}
				<a
					class="chip"
					href={listHref({ ...q, topic: f.topic, solutions: f.solutions, page: 1 })}
					aria-current={selected === f.key ? 'page' : undefined}>{f.label}</a
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
		{#if !data.searchError}
			<p class="empty">
				{data.searching
					? ja.search.none
					: q.solutions
						? ja.issue.emptySolutions
						: q.topic === 'current'
							? ja.issue.emptyTopic
							: ja.issue.empty}
			</p>
		{/if}
	{:else}
		<table>
			<thead>
				<tr>
					<th scope="col">{ja.issue.columnTitle}</th>
					<th scope="col" class="num">{ja.issue.columnSupports}</th>
					<th scope="col" class="num">{ja.issue.columnSolutions}</th>
					<th scope="col">{ja.issue.columnTopic}</th>
				</tr>
			</thead>
			<tbody>
				{#each data.rows as row (row.id)}
					<tr>
						<td class="title"><a href="/kadai/{row.id}">{row.title}</a></td>
						<td class="num"><span class="label">{ja.issue.supports}</span> {row.supports}</td>
						<td class="num solutions"><span class="label">{ja.issue.solutions}</span> {row.solutions}</td>
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

	.search {
		display: grid;
		gap: 0.25rem;
		margin-top: 1rem;
	}

	.search label {
		font-weight: bold;
		font-size: var(--font-size-sub);
	}

	.search-row {
		display: flex;
		gap: 0.5rem;
	}

	.search input {
		flex: 1;
		min-height: var(--tap-min);
		padding: 0 0.75rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-m);
		font: inherit;
	}

	.search button {
		min-height: var(--tap-min);
		padding: 0 1rem;
		border: 1px solid var(--color-base);
		border-radius: var(--radius-m);
		background: var(--color-base);
		color: var(--color-bg);
		font: inherit;
		font-weight: bold;
	}

	[role='alert'] {
		color: var(--color-caution);
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

		.solutions::before,
		.topic:not(:empty)::before {
			content: ' ・ ';
		}
	}
</style>
