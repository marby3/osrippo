<script lang="ts">
	// 法律の一覧と検索（Issue #163。画面の案 SpLaws・PcLaws）。「法律」のタブの行き先
	import { goto } from '$app/navigation';
	import SearchBox from '#lib/components/SearchBox.svelte';
	import { ja } from '#lib/copy/ja.ts';
	import { KANA_ROWS, LAW_LIST_PAGE, LAW_SORTS, lawListHref, type LawSort } from '#lib/domain/law-list.ts';
	import type { LawRow } from '#lib/server/law-list.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const q = $derived(data.query);
	/** 分野は本数の多いものを先に出し、残りは「ほかの分野」に畳む */
	const FEATURED = 4;
	const featured = $derived(data.categories.slice(0, FEATURED));
	const others = $derived(data.categories.slice(FEATURED));
	/** 探すときも、いまの分野と並びは残す */
	const searchHidden = $derived({ ...(q.bunya ? { bunya: q.bunya } : {}), ...(q.narabi !== 'kana' ? { narabi: q.narabi } : {}) });
	const from = $derived((q.page - 1) * LAW_LIST_PAGE + 1);
</script>

<svelte:head>
	<title>{ja.laws.pageTitle}</title>
	{#if q.q.trim()}<meta name="robots" content="noindex" />{/if}
</svelte:head>

<!-- タグは枠のある文字（色だけで見分けない） -->
{#snippet tags(law: LawRow)}
	{#if law.playable}<span class="tag">{ja.laws.tags.playable}</span>{/if}
	{#if law.ifChanged}<span class="tag if">{ja.laws.tags.ifChanged}</span>{/if}
	{#if law.deliberating}<span class="tag">{ja.laws.tags.deliberating}</span>{/if}
{/snippet}

{#snippet amended(law: LawRow)}
	{#if law.lastAmended}{ja.laws.amendedMonth(law.lastAmended)}<span class="sp-only">{ja.laws.amendedSuffix}</span>{:else}{ja.laws.unamended}{/if}
	{#if law.unchangedYears !== null}{ja.laws.sep}<strong>{ja.laws.unchangedYears(law.unchangedYears)}</strong>{/if}
{/snippet}

<main class="frame">
	<h1>{ja.laws.heading}</h1>

	<div class="layout">
		<div class="search">
			<SearchBox
				id="law-search"
				label={ja.laws.searchLabel}
				action="/hourei"
				value={q.q}
				hidden={searchHidden}
				placeholder={ja.laws.searchPlaceholder}
				hint={ja.laws.searchHint}
			/>
			{#if data.searchError}<p role="alert">{ja.search.errors[data.searchError]}</p>{/if}
		</div>

		{#if data.playable.length}
			<section class="playable" aria-labelledby="playable-heading">
				<h2 id="playable-heading">
					{ja.laws.playableHeading}
					<span class="sub">{ja.laws.playableOf(data.playable.map((g) => g.committee))}</span>
				</h2>
				<ul>
					{#each data.playable as g (g.committee)}
						{#each g.laws as law (law.id)}
							<li class="card">
								<a class="card-title" href="/hourei/{law.id}">{ja.laws.titleWithAbbrev(law.title, law.abbrev)}</a>
								<p class="meta">{law.lawNum}{ja.laws.sep}{@render amended(law)}</p>
								<p class="tags">{@render tags(law)}</p>
							</li>
						{/each}
					{/each}
				</ul>
			</section>
		{/if}

		<div class="filters">
			<div class="categories">
				<h2 class="filter-heading"><span class="sp-only">{ja.laws.categoryHeading}</span><span class="pc-only">{ja.laws.categoryHeadingPc}</span></h2>
				<!-- スクリプトなしでも移れるよう、中身はリンク。PC は丸い選択肢の形、スマホは本数つきの枠 -->
				<nav aria-label={ja.laws.categoryHeadingPc}>
					<a class="choice all" href={lawListHref({ ...q, bunya: null, page: 1 })} aria-current={q.bunya === null ? 'page' : undefined}>{ja.laws.categoryAll}</a>
					{#each featured as c (c.name)}
						<a class="choice" href={lawListHref({ ...q, bunya: c.name, page: 1 })} aria-current={q.bunya === c.name ? 'page' : undefined}
							>{c.name} <span class="count">{ja.laws.categoryCount(c.count)}</span></a
						>
					{/each}
					{#if others.length}
						<details open={others.some((c) => c.name === q.bunya)}>
							<summary>{ja.laws.moreCategories(data.categories.length)}</summary>
							{#each others as c (c.name)}
								<a class="choice" href={lawListHref({ ...q, bunya: c.name, page: 1 })} aria-current={q.bunya === c.name ? 'page' : undefined}
									>{c.name} <span class="count">{ja.laws.categoryCount(c.count)}</span></a
								>
							{/each}
						</details>
					{/if}
				</nav>
			</div>

			<div class="sorts">
				<!-- スマホは選ぶ欄（SpLaws）、PC は丸い選択肢（PcLaws） -->
				<label class="sort-select">
					<span class="filter-heading">{ja.laws.sortLabel}</span>
					<select value={q.narabi} onchange={(e) => goto(lawListHref({ ...q, narabi: e.currentTarget.value as LawSort, page: 1 }))}>
						{#each LAW_SORTS as sort (sort)}
							<option value={sort}>{ja.laws.sorts[sort]}</option>
						{/each}
					</select>
				</label>
				<p class="filter-heading pc-only" aria-hidden="true">{ja.laws.sortLabel}</p>
				<nav class="sort-links" aria-label={ja.laws.sortLabel}>
					{#each LAW_SORTS as sort (sort)}
						<a class="choice" href={lawListHref({ ...q, narabi: sort, page: 1 })} aria-current={q.narabi === sort ? 'page' : undefined}>{ja.laws.sorts[sort]}</a>
					{/each}
				</nav>
			</div>
		</div>

		<section class="content" aria-labelledby="readable-heading">
			<div class="content-head">
				<h2 id="readable-heading">
					{ja.laws.readableHeading}
					<span class="sub">{ja.laws.readableMeta(q.bunya, data.total)}</span>
				</h2>
				<!-- 五十音の索引は PC だけ（PcLaws） -->
				<nav class="kana" aria-label={ja.laws.kanaIndex}>
					{#each KANA_ROWS as row (row.key)}
						<a href={lawListHref({ ...q, kana: q.kana === row.key ? null : row.key, page: 1 })} aria-current={q.kana === row.key ? 'page' : undefined}>{row.label}</a>
					{/each}
				</nav>
			</div>

			{#if data.rows.length === 0}
				{#if !data.searchError}
					<p class="empty">
						{data.searching ? (data.articles?.rows.length ? ja.laws.noneByName : ja.laws.none) : ja.laws.empty}
					</p>
				{/if}
			{:else}
				<table aria-labelledby="readable-heading">
					<thead>
						<tr>
							<th scope="col">{ja.laws.columns.title}</th>
							<th scope="col">{ja.laws.columns.lawNum}</th>
							<th scope="col">{ja.laws.columns.amended}</th>
						</tr>
					</thead>
					<tbody>
						{#each data.rows as law (law.id)}
							<tr>
								<th scope="row" class="title">
									{#if law.linked}<a href="/hourei/{law.id}">{ja.laws.titleWithAbbrev(law.title, law.abbrev)}</a
										>{:else}<span>{ja.laws.titleWithAbbrev(law.title, law.abbrev)}</span>{/if}
									{@render tags(law)}
								</th>
								<td class="law-num">{law.lawNum}</td>
								<td class="amended">{@render amended(law)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
				<nav class="pages">
					<span>{ja.laws.range(from, from + data.rows.length - 1)}</span>
					<span class="links">
						{#if q.page > 1}<a href={lawListHref({ ...q, page: q.page - 1 })}>{ja.laws.prevPage}</a>{/if}
						{#if data.hasNext}<a href={lawListHref({ ...q, page: q.page + 1 })}>{ja.laws.nextPage}</a>{/if}
					</span>
				</nav>
			{/if}

			{#if data.articles}
				<section class="articles" aria-labelledby="articles-heading">
					<h2 id="articles-heading">{ja.laws.articlesHeading}</h2>
					{#if data.articles.rows.length}
						<ul>
							{#each data.articles.rows as a, i (i)}
								<li>
									<a href={a.href}>{a.lawTitle} {a.label}</a>
									<p class="snippet">{#each a.parts as part, i (i)}{#if part.mark}<mark>{part.text}</mark>{:else}{part.text}{/if}{/each}</p>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="empty">{ja.laws.none}</p>
					{/if}
					{#if data.articles.more}<p class="note">{ja.laws.articlesMore}</p>{/if}
					{#if data.articles.readableShort}<p class="note">{ja.laws.articlesShort}</p>{/if}
				</section>
			{/if}
		</section>
	</div>
</main>

<style>
	main {
		padding: 1rem;
	}

	h1 {
		font-size: var(--font-size-page-title);
	}

	h2 {
		margin: 0;
		font-size: var(--font-size-heading);
	}

	.sub {
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
		font-weight: normal;
	}

	.layout {
		display: grid;
		gap: 1.5rem;
		grid-template-columns: minmax(0, 1fr);
		grid-template-areas: 'search' 'playable' 'filters' 'content';
	}

	.search {
		grid-area: search;
		display: grid;
		gap: 0.25rem;
	}

	[role='alert'] {
		margin: 0;
		color: var(--color-caution);
	}

	.playable {
		grid-area: playable;
	}

	.playable ul {
		display: grid;
		gap: 0.75rem;
		margin: 0.75rem 0 0;
		padding: 0;
		list-style: none;
	}

	.card {
		padding: 0.75rem 1rem;
		border: 2px solid var(--color-base);
		border-radius: var(--radius-l);
	}

	.card-title {
		color: var(--color-text);
		text-decoration: none;
		font-size: var(--font-size-body);
		font-weight: bold;
	}

	.meta {
		margin: 0.25rem 0;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	.meta strong {
		color: var(--color-text);
	}

	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		margin: 0;
	}

	.tag {
		display: inline-block;
		margin-right: 0.25rem;
		padding: 0 0.5rem;
		border: 1px solid var(--color-text);
		border-radius: var(--radius-pill);
		color: var(--color-text);
		font-size: var(--font-size-min);
		font-weight: normal;
		white-space: nowrap;
	}

	.tag.if {
		border-color: var(--color-if);
		color: var(--color-if);
	}

	.filters {
		grid-area: filters;
		display: grid;
		gap: 1.5rem;
	}

	.filter-heading {
		display: block;
		margin: 0 0 0.5rem;
		font-size: var(--font-size-heading);
		font-weight: bold;
	}

	/* スマホの分野：本数つきの枠を2列に（SpLaws） */
	.categories nav {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.5rem;
	}

	.categories details {
		grid-column: 1 / -1;
		display: grid;
		gap: 0.5rem;
	}

	.categories summary {
		display: flex;
		align-items: center;
		min-height: var(--tap-min);
		color: var(--color-link);
		text-decoration: underline;
		cursor: pointer;
	}

	.categories details[open] {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.categories details[open] summary {
		grid-column: 1 / -1;
	}

	.choice {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		min-height: var(--tap-secondary);
		padding: 0 0.75rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-m);
		color: var(--color-text);
		text-decoration: none;
	}

	.choice[aria-current='page'] {
		border: 2px solid var(--color-base);
		font-weight: bold;
	}

	.count {
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
		font-weight: normal;
	}

	/* スマホの並び順は選ぶ欄だけ */
	.sort-links,
	.pc-only {
		display: none;
	}

	.sort-select {
		display: grid;
	}

	.sort-select select {
		min-height: var(--tap-secondary);
		padding: 0 0.75rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-m);
		background: var(--color-bg);
		color: var(--color-text);
		font: inherit;
	}

	.content {
		grid-area: content;
		min-width: 0;
	}

	.content-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid var(--color-divider);
	}

	.kana {
		display: none;
	}

	.empty {
		color: var(--color-text-sub);
	}

	table {
		width: 100%;
		border-collapse: collapse;
	}

	thead {
		display: none;
	}

	tr {
		display: block;
		padding: 1rem 0;
		border-bottom: 1px solid var(--color-divider);
	}

	th,
	td {
		padding: 0;
		text-align: left;
	}

	/* スマホは縦の並び（SpLaws）：法令名とタグの下に「法令番号 ・ 改正」 */
	.title {
		display: block;
		margin-bottom: 0.25rem;
		font-weight: bold;
	}

	.title a,
	.title span:not(.tag) {
		margin-right: 0.25rem;
		color: var(--color-text);
		text-decoration: none;
	}

	.law-num,
	.amended {
		display: inline;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	.amended::before {
		content: ' ・ ';
	}

	.amended strong {
		color: var(--color-text);
	}

	.pages {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-top: 1rem;
		color: var(--color-text-sub);
	}

	.pages .links {
		display: flex;
		gap: 1rem;
	}

	.pages a {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap-min);
	}

	.articles {
		margin-top: 2rem;
	}

	.articles ul {
		margin: 0.5rem 0 0;
		padding: 0;
		list-style: none;
	}

	.articles li {
		padding: 0.75rem 0;
		border-bottom: 1px solid var(--color-divider);
	}

	.articles li a {
		font-weight: bold;
	}

	.snippet {
		margin: 0.25rem 0 0;
		font-size: var(--font-size-sub);
	}

	mark {
		background: var(--color-caution-bg);
		color: var(--color-text);
		font-weight: bold;
	}

	.note {
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	/* スマホ：見出しは上の帯が代わり（見えない見出し。課題の一覧と同じ） */
	@media (max-width: 63.99rem) {
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
	}

	/* PC：いま遊べる法律を上に横並び、その下の左の列に探す・分野・並び順、右の列に表（PcLaws） */
	@media (min-width: 64rem) {
		.layout {
			grid-template-columns: 15rem minmax(0, 1fr);
			grid-template-rows: auto auto 1fr;
			grid-template-areas: 'playable playable' 'search content' 'filters content';
			column-gap: 2.5rem;
			row-gap: 2rem;
			align-items: start;
		}

		.playable ul {
			grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
		}

		.sp-only {
			display: none;
		}

		.pc-only {
			display: inline;
		}

		p.pc-only {
			display: block;
		}

		.filter-heading {
			font-size: var(--font-size-sub);
		}

		/* 分野と並び順は丸い選択肢の形。選んでいるものは印が塗られる */
		.categories nav,
		.categories details[open],
		.sort-links {
			display: flex;
			flex-direction: column;
			gap: 0;
		}

		.choice {
			justify-content: flex-start;
			gap: 0.75rem;
			min-height: var(--tap-min);
			padding: 0;
			border: 0;
			border-radius: 0;
		}

		.choice::before {
			content: '';
			flex: none;
			box-sizing: border-box;
			width: 1.25rem;
			height: 1.25rem;
			border: 1px solid var(--color-input-border);
			border-radius: var(--radius-pill);
		}

		.choice[aria-current='page'] {
			border: 0;
			font-weight: normal;
		}

		.choice[aria-current='page']::before {
			border: 2px solid var(--color-base);
			background: var(--color-base);
			box-shadow: inset 0 0 0 3px var(--color-bg);
		}

		.count {
			display: none;
		}

		.sort-select {
			display: none;
		}

		.kana {
			display: flex;
			gap: 0.25rem;
		}

		.kana a {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			min-width: var(--tap-min);
			min-height: var(--tap-min);
			border-radius: var(--radius-m);
		}

		.kana a[aria-current='page'] {
			background: var(--color-base);
			color: var(--color-bg);
			text-decoration: none;
		}

		thead {
			display: table-header-group;
		}

		tr {
			display: table-row;
			padding: 0;
		}

		th,
		td,
		.title,
		.law-num,
		.amended {
			display: table-cell;
			margin: 0;
			padding: 0.75rem 0.5rem;
			border-bottom: 1px solid var(--color-divider);
			vertical-align: middle;
		}

		thead th {
			color: var(--color-text-sub);
			font-size: var(--font-size-sub);
			font-weight: normal;
			border-bottom: 2px solid var(--color-text);
		}

		.title a {
			text-decoration: underline;
		}

		.law-num,
		.amended {
			color: var(--color-text);
		}

		.amended::before {
			content: none;
		}
	}
</style>
