<script lang="ts">
	import { ja, jaDateTimeFull } from '#lib/copy/ja.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const pageHref = (page: number) => (page > 1 ? `/unei?page=${page}` : '/unei');
</script>

<svelte:head>
	<title>{ja.unei.pageTitle}</title>
</svelte:head>

<main>
	<h1>{ja.unei.heading}</h1>

	<h2>{ja.unei.criteriaHeading}</h2>
	<ul>
		{#each ja.unei.criteria as line (line)}<li>{line}</li>{/each}
	</ul>

	<h2>{ja.unei.logHeading}</h2>
	{#if data.rows.length === 0}
		<p>{ja.unei.empty}</p>
	{:else}
		<table>
			<thead>
				<tr>
					{#each Object.values(ja.unei.columns) as column (column)}<th scope="col">{column}</th>{/each}
				</tr>
			</thead>
			<tbody>
				{#each data.rows as row (row.id)}
					<tr>
						<td>{jaDateTimeFull(row.createdAt)}</td>
						<td><a href="/kadai/{row.issueId}">#{row.issueId}</a></td>
						<td>{ja.unei.actions[row.action]}</td>
						<td>{ja.unei.actors[row.actor]}</td>
						<td>{row.reason ? ja.hideReasons[row.reason] : ''}</td>
						<td class="note">{row.note ?? ''}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}

	{#if data.page > 1 || data.hasNext}
		<nav class="pages">
			{#if data.page > 1}<a href={pageHref(data.page - 1)}>{ja.unei.prevPage}</a>{/if}
			{#if data.hasNext}<a href={pageHref(data.page + 1)}>{ja.unei.nextPage}</a>{/if}
		</nav>
	{/if}
</main>

<style>
	main {
		max-width: 72rem;
		margin: 0 auto;
		padding: 1rem;
	}

	h1 {
		font-size: var(--font-size-page-title);
	}

	h2 {
		font-size: var(--font-size-heading);
		margin-top: 1.5rem;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--font-size-sub);
	}

	th {
		color: var(--color-text-sub);
		font-weight: normal;
		text-align: left;
		border-bottom: 2px solid var(--color-text);
		padding: 0.5rem;
	}

	td {
		border-bottom: 1px solid var(--color-divider);
		padding: 0.5rem;
		vertical-align: top;
	}

	.note {
		white-space: pre-wrap;
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

	/* スマホは表を縦に積む */
	@media (max-width: 40rem) {
		thead {
			display: none;
		}

		tr {
			display: block;
			border-bottom: 1px solid var(--color-divider);
			padding: 0.5rem 0;
		}

		td {
			display: block;
			border: none;
			padding: 0.125rem 0;
		}
	}
</style>
