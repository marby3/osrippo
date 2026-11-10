<!-- 議員ダッシュボード（Issue #149、SpMember・PcMember、設計書 docs/spec/149.md）。
     PC は表、スマホは同じ表をカードの形に崩して出す（行は1つだけにして、読み上げと順番をそろえる） -->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { ja } from '#lib/copy/ja.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const q = $derived(data.query);
	type Sort = 'bridge' | 'support' | 'new';
	const SORTS: Sort[] = ['bridge', 'support', 'new'];

	/** 既定の値は URL に入れない（引数なしの URL だけが既定。+page.server.ts の parseQuery） */
	function href(o: { tab?: 'kadai' | 'houan' | 'kaketsu'; sort?: Sort; filter?: 'all' | 'kaiketsu' | 'houan'; page?: number }) {
		const params = new URLSearchParams();
		const tab = o.tab ?? 'kadai';
		if (tab !== 'kadai') params.set('tab', tab);
		if (tab === 'kadai') {
			if (o.sort && o.sort !== 'bridge') params.set('sort', o.sort);
			if (o.filter === 'kaiketsu') params.set('kaiketsu', 'ari');
			if (o.filter === 'houan') params.set('houan', 'ari');
		}
		if (o.page && o.page > 1) params.set('page', String(o.page));
		const s = params.toString();
		return s ? `/giin?${s}` : '/giin';
	}
	const filter = $derived(q.solutions ? 'kaiketsu' : q.bills ? 'houan' : 'all');
	const FILTERS = ['all', 'kaiketsu', 'houan'] as const;
	const TABS = ['kadai', 'houan', 'kaketsu'] as const;
	const next = $derived(href({ tab: q.tab, sort: q.sort, filter, page: q.page + 1 }));
</script>

<svelte:head>
	<title>{ja.giin.pageTitle}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<!-- スマホはヘッダーの下に「認証済み議員・氏名」の帯（SpMember）。PC はヘッダーの右に出す -->
<p class="band">
	<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 4 5v6c0 5.2 3.4 9.4 8 11 4.6-1.6 8-5.8 8-11V5z" /><path d="m8.5 12 2.5 2.5 4.5-5" /></svg>
	{ja.giin.verifiedSp(data.name)}
</p>

<main class="frame">
	<div class="head">
		<div>
			<h1>{ja.giin.heading}</h1>
			<p class="lead">{ja.giin.lead}</p>
		</div>
		{#if q.tab === 'kadai'}
			<label class="sort">
				<span>{ja.giin.sortLabel}</span>
				<select value={q.sort} onchange={(e) => goto(href({ sort: e.currentTarget.value as Sort, filter }))}>
					{#each SORTS as sort (sort)}<option value={sort}>{ja.giin.sorts[sort]}</option>{/each}
				</select>
			</label>
			<noscript>
				<p>{#each SORTS as sort (sort)}<a href={href({ sort, filter })}>{ja.giin.sorts[sort]}</a> {/each}</p>
			</noscript>
		{/if}
	</div>

	<nav class="tabs" aria-label={ja.giin.tabsLabel}>
		{#each TABS as tab (tab)}
			<a href={href({ tab })} aria-current={q.tab === tab ? 'page' : undefined}>{ja.giin.tabs[tab](data.counts[tab])}</a>
		{/each}
	</nav>

	{#if q.tab === 'kadai'}
		<nav class="filters" aria-label={ja.giin.filtersLabel}>
			{#each FILTERS as f (f)}
				<a href={href({ sort: q.sort, filter: f })} aria-current={filter === f ? 'page' : undefined}>{ja.giin.filters[f]}</a>
			{/each}
		</nav>
		{#if data.bridgeFallback}<p class="note">{ja.issue.bridgeFallback}</p>{/if}
		{#if data.issues.length === 0}
			<p class="empty">{ja.giin.empty}</p>
		{:else}
			<table>
				<thead>
					<tr>
						<th scope="col">{ja.giin.columns.issue}</th>
						<th scope="col" class="num">{ja.giin.columns.supports}</th>
						<th scope="col">{ja.giin.columns.bridge}</th>
						<th scope="col">{ja.giin.columns.solution}</th>
					</tr>
				</thead>
				<tbody>
					{#each data.issues as row (row.id)}
						<tr data-giin-row>
							<td class="title"><a href="/kadai/{row.id}">{row.title}</a></td>
							<td class="num"><span class="sp-label">{ja.giin.columns.supports}{' '}</span>{row.supports}</td>
							<td class="ratio">
								<span class="sp-label">{ja.giin.columns.bridge} </span>
								{#if row.ratio !== null}
									<span class="bar" aria-hidden="true"><span style:width="{row.ratio}%"></span></span>
								{/if}
								<strong title={row.ratio === null ? ja.giin.ratioNone : undefined}>{ja.giin.ratio(row.ratio)}</strong>
							</td>
							<td class="solution"><span class="sp-label">{ja.giin.columns.solution}：</span>{row.solution ?? ja.giin.none}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	{:else if q.tab === 'houan'}
		{#if data.bills.length === 0}
			<p class="empty">{ja.giin.empty}</p>
		{:else}
			<table>
				<thead>
					<tr>
						<th scope="col">{ja.giin.columns.bill}</th>
						<th scope="col">{ja.giin.columns.stage}</th>
						<th scope="col">{ja.giin.columns.origin}</th>
					</tr>
				</thead>
				<tbody>
					{#each data.bills as row (row.id)}
						<tr data-giin-row>
							<td class="title"><a href="/houan/{row.id}">{row.title}</a></td>
							<td><span class="sp-label">{ja.giin.columns.stage}：</span>{ja.bill.progress[row.progress]}</td>
							<td><span class="sp-label">{ja.giin.columns.origin}：</span>{#if row.origin}<a href="/kadai/{row.origin.id}">{row.origin.title}</a>{:else}{ja.giin.none}{/if}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	{:else if data.passed.length === 0}
		<p class="empty">{ja.giin.empty}</p>
	{:else}
		<table>
			<thead>
				<tr>
					<th scope="col">{ja.giin.columns.bill}</th>
					<th scope="col">{ja.giin.columns.session}</th>
					<th scope="col">{ja.giin.columns.laws}</th>
				</tr>
			</thead>
			<tbody>
				{#each data.passed as row (row.id)}
					<tr data-giin-row>
						<td class="title"><a href="/saiketsu/{row.id}/kekka">{row.title}</a></td>
						<td><span class="sp-label">{ja.giin.columns.session}：</span>{ja.giin.session(row.sessionKey)}</td>
						<td>
							<span class="sp-label">{ja.giin.columns.laws}：</span>
							{#each row.laws as law, i (law.id)}{#if i}{ja.bill.nameSeparator}{/if}<a href="/if/hourei/{law.id}">{law.title}</a>{/each}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}

	{#if data.hasNext}<p class="more"><a href={next}>{ja.giin.more}</a></p>{/if}
	<p class="foot">{ja.giin.footnote}</p>
</main>

<style>
	.band {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		margin: 0;
		padding: 0.75rem 1rem;
		background: var(--color-base);
		color: var(--color-bg);
		font-size: var(--font-size-sub);
		font-weight: 700;
	}

	.band svg {
		width: 1.25rem;
		height: 1.25rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.75;
		stroke-linejoin: round;
	}

	main {
		padding-top: 1rem;
		padding-bottom: 2rem;
	}

	h1 {
		margin: 0;
		font-size: var(--font-size-page-title);
	}

	.lead,
	.note,
	.foot {
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	.sort {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		font-weight: 700;
	}

	.sort select {
		min-height: var(--tap-min);
		padding: 0 0.75rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-m);
		background: var(--color-bg);
		font: inherit;
		font-weight: 400;
	}

	.tabs,
	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin: 1rem 0;
	}

	.tabs a,
	.filters a {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap-min);
		padding: 0 1rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-pill);
		color: var(--color-text);
		text-decoration: none;
	}

	.tabs a[aria-current='page'],
	.filters a[aria-current='page'] {
		border-color: var(--color-base);
		background: var(--color-base);
		color: var(--color-bg);
		font-weight: 700;
	}

	/* スマホ：表をカードの形に崩す（SpMember） */
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
		margin-bottom: 1rem;
		padding: 1rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-l);
	}

	td {
		padding: 0.25rem 0;
		color: var(--color-text-sub);
	}

	td.title {
		font-weight: 700;
		color: var(--color-text);
	}

	/* スマホは「わかる N ・ 立場を超えた支持 N%」を1行に（SpMember） */
	td.num,
	td.ratio {
		display: inline;
	}

	td.ratio::before {
		content: ' ・ ';
	}

	td.solution {
		margin-top: 0.5rem;
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius-m);
		background: var(--color-surface);
		color: var(--color-text);
	}

	.title a {
		color: var(--color-text);
	}

	.ratio strong {
		font-weight: 400;
	}

	.bar {
		display: none;
	}

	.more {
		margin-top: 1rem;
	}

	@media (min-width: 64rem) {
		/* PC はヘッダーの右に出すので帯はない（PcMember） */
		.band {
			display: none;
		}

		.head {
			display: flex;
			gap: 1rem;
			align-items: center;
			justify-content: space-between;
		}

		.sp-label {
			display: none;
		}

		td.ratio::before {
			content: none;
		}

		td.num,
		td.ratio {
			display: table-cell;
		}

		.tabs {
			gap: 0;
			border-bottom: 1px solid var(--color-divider);
		}

		.tabs a {
			border: none;
			border-bottom: 3px solid transparent;
			border-radius: 0;
			background: none;
		}

		.tabs a[aria-current='page'] {
			border-bottom-color: var(--color-base);
			background: none;
			color: var(--color-text);
		}

		table {
			display: table;
			width: 100%;
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
			border: none;
			border-bottom: 1px solid var(--color-divider);
		}

		th,
		td {
			display: table-cell;
			padding: 0.75rem 0.5rem;
			text-align: left;
			vertical-align: middle;
		}

		th {
			color: var(--color-text-sub);
			font-size: var(--font-size-sub);
			font-weight: 400;
			border-bottom: 2px solid var(--color-text);
		}

		td {
			color: var(--color-text);
		}

		td.solution {
			margin: 0;
			background: none;
		}

		.num {
			text-align: right;
		}

		.ratio {
			white-space: nowrap;
		}

		.ratio strong {
			font-weight: 700;
		}

		.bar {
			display: inline-block;
			width: 8rem;
			height: 0.75rem;
			margin-right: 0.5rem;
			border: 1px solid var(--color-base);
			border-radius: var(--radius-pill);
			vertical-align: middle;
			overflow: hidden;
		}

		.bar span {
			display: block;
			height: 100%;
			background: var(--color-base);
		}
	}
</style>
