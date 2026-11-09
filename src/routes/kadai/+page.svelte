<script lang="ts">
	import { goto } from '$app/navigation';
	import SearchBox from '#lib/components/SearchBox.svelte';
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
	/** 探すときも、いまの並びと絞り込みは残す */
	const searchHidden = $derived({
		...(q.sort !== 'support' ? { sort: q.sort } : {}),
		...(q.topic !== 'all' ? { topic: q.topic } : {}),
		...(q.solutions ? { kaiketsu: 'ari' } : {})
	});
</script>

<svelte:head>
	<title>{ja.issue.listPageTitle}</title>
	{#if q.q.trim()}<meta name="robots" content="noindex" />{/if}
</svelte:head>

<main class="frame">
	<header>
		<h1>{ja.issue.heading}</h1>
		<!-- スマホは下のタブの上に留める帯、PC は見出しの右（SpIssues・PcIssues） -->
		<div class="write-bar">
			<a class="write" href="/kadai/kaku"><span aria-hidden="true">＋</span> {ja.issue.write}</a>
		</div>
	</header>

	<div class="layout">
		<div class="side">
			<!-- 課題を探す（設計書 docs/spec/38.md 決めたこと5）。今の並びと絞り込みは残す -->
			<SearchBox id="issue-search" label={ja.search.issueLabel} action="/kadai" value={q.q} hidden={searchHidden} />
			{#if data.searchError}<p role="alert">{ja.search.errors[data.searchError]}</p>{/if}

			<div class="controls">
				<!-- PC は丸い選択肢の形（PcIssues）。スクリプトなしでも移れるよう、中身はリンク -->
				<p class="filter-label" id="filter-label">{ja.issue.filterLabel}</p>
				<nav aria-labelledby="filter-label">
					{#each filters as f (f.key)}
						<a
							class="chip"
							href={listHref({ ...q, topic: f.topic, solutions: f.solutions, page: 1 })}
							aria-current={selected === f.key ? 'page' : undefined}>{f.label}</a
						>
					{/each}
				</nav>
				<label class="sort">
					<span class="sort-sp">{ja.issue.sortLabel}：</span><span class="sort-pc">{ja.issue.sortLabelPc}</span>
					<span class="select">
						<select value={q.sort} onchange={(e) => goto(listHref({ ...q, sort: e.currentTarget.value as Sort, page: 1 }))}>
							{#each SORTS as sort (sort)}
								<option value={sort}>{ja.issue.sorts[sort]}</option>
							{/each}
						</select>
						<!-- スマホの「⌄」。既定の描画を外すので自前で描く（iOS でも枠を出さない） -->
						<svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
					</span>
				</label>
				<noscript>
					<p>
						{#each SORTS as sort (sort)}
							<a href={listHref({ ...q, sort, page: 1 })}>{ja.issue.sorts[sort]}</a>
						{/each}
					</p>
				</noscript>
			</div>
		</div>

		<div class="content">
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
		</div>
	</div>
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
		justify-content: center;
		min-height: var(--tap-primary);
		padding: 0 1.25rem;
		border-radius: var(--radius-m);
		background: var(--color-base);
		color: var(--color-bg);
		font-weight: bold;
		text-decoration: none;
	}

	.side {
		display: grid;
		gap: 0.5rem;
		margin-top: 1rem;
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

	.filter-label {
		display: none;
		margin: 0;
		font-size: var(--font-size-sub);
		font-weight: bold;
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

	.sort-pc {
		display: none;
	}

	/* スマホの並び：枠のない文字だけの選択欄と「⌄」（SpIssues） */
	.select {
		display: inline-flex;
		position: relative;
		align-items: center;
	}

	.sort select {
		min-height: var(--tap-min);
		padding: 0 1.75rem 0 0;
		border: 0;
		appearance: none;
		background: transparent;
		color: var(--color-text);
		font: inherit;
		font-weight: bold;
	}

	.chevron {
		position: absolute;
		right: 0;
		width: 1.25rem;
		height: 1.25rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
		pointer-events: none;
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

	/* スマホ：見出しは上の帯が代わり（見えない見出し）。「＋課題を書く」は下のタブの上に、横いっぱいで留める（SpIssues） */
	@media (max-width: 63.99rem) {
		/* base.css の .visually-hidden と同じ中身（スマホだけに効かせるので写す） */
		h1 {
			position: absolute;
			width: 1px;
			height: 1px;
			margin: -1px;
			padding: 0;
			border: 0;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}

		/* 下のタブ（高さ 3.75rem。SiteHeader.svelte）のすぐ上。帯の高さを変えたら +layout.svelte の .tab-space.bar も */
		.write-bar {
			position: fixed;
			z-index: 9;
			right: 0;
			bottom: 3.75rem;
			left: 0;
			padding: 0.5rem 1rem;
			border-top: 1px solid var(--color-divider);
			background: var(--color-bg);
		}

		.write {
			display: flex;
		}
	}

	/* PC：左の列に探す・表示する課題・並び順、右の列に表（PcIssues） */
	@media (min-width: 64rem) {
		.layout {
			display: grid;
			grid-template-columns: 15rem minmax(0, 1fr);
			column-gap: 2.5rem;
			align-items: start;
			margin-top: 1.5rem;
		}

		.side {
			gap: 1.5rem;
			margin-top: 0;
		}

		.controls {
			gap: 0.5rem;
			margin: 0;
		}

		.filter-label {
			display: block;
		}

		/* 表示する課題は丸い選択肢の形。選んでいるものは印が塗られる */
		.controls nav {
			flex-direction: column;
			gap: 0;
			margin-bottom: 1rem;
		}

		.chip {
			gap: 0.75rem;
			padding: 0;
			border: 0;
			border-radius: 0;
		}

		.chip::before {
			content: '';
			box-sizing: border-box;
			width: 1.25rem;
			height: 1.25rem;
			border: 1px solid var(--color-input-border);
			border-radius: var(--radius-pill);
		}

		.chip[aria-current='page'] {
			background: none;
			color: var(--color-text);
		}

		.chip[aria-current='page']::before {
			border: 2px solid var(--color-base);
			background: var(--color-base);
			box-shadow: inset 0 0 0 3px var(--color-bg);
		}

		.sort {
			display: grid;
			gap: 0.25rem;
		}

		.sort-sp {
			display: none;
		}

		.sort-pc {
			display: inline;
			font-size: var(--font-size-sub);
			font-weight: bold;
		}

		.select {
			display: flex;
		}

		.sort select {
			flex: 1;
			min-height: var(--tap-secondary);
			padding: 0 0.75rem;
			border: 1px solid var(--color-input-border);
			border-radius: var(--radius-m);
			appearance: auto;
			background: var(--color-bg);
			font-weight: normal;
		}

		.chevron {
			display: none;
		}
	}
</style>
