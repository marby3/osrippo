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
						<td data-label={ja.unei.columns.at}>{jaDateTimeFull(row.createdAt)}</td>
						<!-- 解決策の行は「#[課題] の解決策」。リンクは課題のページへ（解決策の番号は出さない。設計書 docs/spec/36.md 決めたこと6） -->
						<td data-label={ja.unei.columns.issue}
							><a href="/kadai/{row.issueId}">#{row.issueId}</a>{#if row.solutionId !== null}{' '}{ja.unei.solutionOf}{/if}</td
						>
						<td data-label={ja.unei.columns.action}>{ja.unei.actions[row.action]}</td>
						<td data-label={ja.unei.columns.actor}>{ja.unei.actors[row.actor]}</td>
						<td data-label={ja.unei.columns.reason}
							>{#if row.action === 'merge' && row.mergedInto !== null}<a href="/kadai/{row.mergedInto}"
									>{ja.merge.logReason(row.mergedInto)}</a
								>{:else if row.reason}{ja.hideReasons[row.reason]}{/if}</td
						>
						<td data-label={ja.unei.columns.note} class="note">{row.note ?? ''}</td>
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

		/* 見出しの代わりに、セルの前にラベルを出す。空のセルは出さない */
		td::before {
			content: attr(data-label) '：';
			color: var(--color-text-sub);
		}

		td:empty {
			display: none;
		}
	}
</style>
