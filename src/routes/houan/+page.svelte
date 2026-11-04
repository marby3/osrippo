<script lang="ts">
	// 法案の一覧（SpBills・PcBills）。スマホは札・題名・段階と賛同の行、PC は表
	import { ja } from '#lib/copy/ja.ts';
	import { billListHref, type BillTab } from '#lib/domain/bills.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const tabs = $derived<{ tab: BillTab; label: string }[]>([
		{ tab: 'shingi', label: ja.bill.list.shingi(data.counts.shingi) },
		{ tab: 'shitagaki', label: ja.bill.list.shitagaki(data.counts.shitagaki) },
		{ tab: 'owari', label: ja.bill.list.owari }
	]);
</script>

<svelte:head>
	<title>{ja.bill.list.pageTitle}</title>
</svelte:head>

<main>
	<h1>{ja.bill.list.heading}</h1>

	<nav class="tabs" aria-label={ja.bill.list.tabs}>
		{#each tabs as t (t.tab)}
			<a href={billListHref(t.tab, 1)} aria-current={data.tab === t.tab ? 'page' : undefined}>{t.label}</a>
		{/each}
	</nav>

	{#if data.rows.length}
		<!-- スマホは CSS で display を変えるので、表として読めるように role を明示する（冗長ではない） -->
		<!-- svelte-ignore a11y_no_redundant_roles -->
		<table role="table">
			<!-- svelte-ignore a11y_no_redundant_roles -->
			<thead role="rowgroup">
				<!-- svelte-ignore a11y_no_redundant_roles -->
				<tr role="row">
					<th role="columnheader" class="kind">{ja.bill.list.kind}</th>
					<th role="columnheader">{ja.bill.list.bill}</th>
					<th role="columnheader" class="stage">{ja.bill.list.stage}</th>
					<th role="columnheader" class="support">{ja.bill.list.support}</th>
				</tr>
			</thead>
			<!-- svelte-ignore a11y_no_redundant_roles -->
			<tbody role="rowgroup">
				{#each data.rows as row (row.id)}
					<!-- svelte-ignore a11y_no_redundant_roles -->
					<tr role="row">
						<td role="cell" class="kind"><span class="badge">{ja.bill.kinds[row.kind]}</span></td>
						<td role="cell" class="title"><a href="/houan/{row.id}">{row.title}</a></td>
						<td role="cell" class="stage">{ja.bill.list.stages[row.progress]}</td>
						<td role="cell" class="support"><span class="sp-label">{ja.bill.list.supportPrefix}</span>{ja.bill.list.supportCell(row.supports)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{:else}
		<p class="empty">{ja.bill.list.empty[data.tab]}</p>
	{/if}

	{#if data.page > 1 || data.hasNext}
		<nav class="pages" aria-label={ja.bill.list.pages}>
			{#if data.page > 1}<a href={billListHref(data.tab, data.page - 1)}>{ja.bill.list.prevPage}</a>{/if}
			{#if data.hasNext}<a href={billListHref(data.tab, data.page + 1)}>{ja.bill.list.nextPage}</a>{/if}
		</nav>
	{/if}

	<!-- 案の「法案の書き方を見る」の場所：スマホは一覧の下（SpBills）、PC は見出しの右（PcBills）。リンクは1つで、PC は CSS で動かす -->
	<p class="write"><a href="/houan/kaku">{ja.bill.list.write}</a></p>
</main>

<style>
	main {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		max-width: 76rem;
		margin: 0 auto;
		padding: 1rem;
	}

	.pages a,
	.write a {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap-min);
	}

	h1 {
		margin: 0;
		font-size: var(--font-size-page-title);
	}

	.tabs {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		margin: 0.5rem -1rem 0;
		border-bottom: 1px solid var(--color-divider);
	}

	.tabs a {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: var(--tap-min);
		color: var(--color-text-sub);
		text-decoration: none;
	}

	.tabs a[aria-current='page'] {
		border-bottom: 3px solid var(--color-base);
		color: var(--color-text);
		font-weight: bold;
	}

	/* スマホ：表を行のカードの並びにする */
	table,
	tbody,
	tr,
	td {
		display: block;
	}

	thead {
		display: none;
	}

	tr {
		padding: 1rem 0;
		border-bottom: 1px solid var(--color-divider);
	}

	td {
		padding: 0;
	}

	.badge {
		display: inline-block;
		padding: 0 0.5rem;
		border: 1px solid var(--color-text);
		border-radius: var(--radius-s);
		font-size: var(--font-size-min);
		font-weight: bold;
	}

	.title {
		margin-top: 0.25rem;
	}

	.title a {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap-min);
		color: var(--color-text);
		font-weight: bold;
		text-decoration: none;
	}

	td.stage,
	td.support {
		display: inline;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	.empty {
		margin: 1.5rem 0;
		color: var(--color-text-sub);
	}

	.pages {
		display: flex;
		justify-content: space-between;
		margin-top: 1rem;
	}

	.write {
		margin: 1rem 0 0;
	}

	@media (min-width: 64rem) {
		main {
			grid-template-columns: minmax(0, 1fr) auto;
			padding: 1.5rem 4rem;
		}

		h1 {
			grid-area: 1 / 1;
		}

		.write {
			grid-area: 1 / 2;
			align-self: center;
			margin: 0;
		}

		.tabs,
		table,
		.empty,
		.pages {
			grid-column: 1 / -1;
		}

		.tabs {
			display: flex;
			margin: 1.5rem 0 0;
		}

		.tabs a {
			padding: 0 1.25rem;
		}

		table {
			display: table;
			width: 100%;
			margin-top: 1rem;
			border-collapse: collapse;
		}

		thead {
			display: table-header-group;
		}

		tbody {
			display: table-row-group;
		}

		tr {
			display: table-row;
			padding: 0;
		}

		th,
		td {
			display: table-cell;
			padding: 0.75rem 0;
			border-bottom: 1px solid var(--color-divider);
			text-align: left;
			vertical-align: middle;
		}

		th {
			border-bottom: 2px solid var(--color-text);
			color: var(--color-text-sub);
			font-size: var(--font-size-sub);
			font-weight: normal;
		}

		.kind {
			width: 5rem;
		}

		.stage {
			width: 10rem;
		}

		td.stage,
		td.support {
			display: table-cell;
			color: var(--color-text);
			font-size: var(--font-size-body);
		}

		.support {
			width: 5rem;
			text-align: right;
		}

		.sp-label {
			display: none;
		}

		.title {
			margin: 0;
		}

		.title a {
			text-decoration: underline;
		}
	}
</style>
