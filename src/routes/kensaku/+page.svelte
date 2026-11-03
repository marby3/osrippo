<script lang="ts">
	import { ja } from '#lib/copy/ja.ts';
	import type { Part } from '#lib/domain/search.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const href = (extra: Record<string, string | number>) => {
		const params = new URLSearchParams({ q: data.q });
		for (const [k, v] of Object.entries(extra)) params.set(k, String(v));
		return `/kensaku?${params}`;
	};
	const pageHref = (page: number) => (page > 1 ? href({ shurui: data.shurui ?? '', page }) : href({ shurui: data.shurui ?? '' }));
</script>

{#snippet text(parts: Part[])}
	<!-- 当たった言葉に印を付ける（文字列を区切って並べる。{@html} は使わない） -->
	<span class="snippet">{#each parts as part, i (i)}{#if part.mark}<mark>{part.text}</mark>{:else}{part.text}{/if}{/each}</span>
{/snippet}

{#snippet heading(name: string, total: number)}
	<h2>{name} <span>{ja.search.count(total)}</span></h2>
{/snippet}

<svelte:head>
	<title>{ja.search.pageTitle}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main>
	<h1>{ja.search.heading}</h1>
	<form method="get" action="/kensaku" class="search">
		<label for="search-q">{ja.search.label}</label>
		<div class="row">
			<input id="search-q" name="q" type="search" value={data.q} maxlength="60" />
			<button>{ja.search.submit}</button>
		</div>
	</form>
	{#if data.error}<p role="alert">{ja.search.errors[data.error]}</p>{/if}

	{#if data.results}
		{@const r = data.results}
		{#if data.shurui}<p><a href={href({})}>{ja.search.back}</a></p>{/if}

		{#if r.laws}
			<section>
				{@render heading(ja.search.sections.laws, r.laws.length)}
				{#if r.laws.length === 0}<p class="none">{ja.search.none}</p>{/if}
				<ul>
					{#each r.laws as law (law.id)}<li><a href="/hourei/{law.id}">{law.title}</a></li>{/each}
				</ul>
			</section>
		{/if}

		{#if r.jobun}
			<section>
				{@render heading(ja.search.sections.jobun, r.jobun.total)}
				{#if r.jobun.capped}<p class="note">{ja.search.capped}</p>{/if}
				{#if r.jobun.total === 0}<p class="none">{ja.search.none}</p>{/if}
				<ul>
					{#each r.jobun.rows as row, i (i)}
						<li>
							<a href={row.href}><span class="law">{row.lawTitle}</span> <span class="position">{row.position}</span></a>
							{@render text(row.parts)}
						</li>
					{/each}
				</ul>
				{#if !data.shurui && r.jobun.total > r.jobun.rows.length}
					<p><a href={href({ shurui: 'jobun' })}>{ja.search.more(r.jobun.total)}</a></p>
				{/if}
			</section>
		{/if}

		{#if r.kadai}
			<section>
				{@render heading(ja.search.sections.kadai, r.kadai.total)}
				{#if r.kadai.total === 0}<p class="none">{ja.search.none}</p>{/if}
				<ul>
					{#each r.kadai.rows as row (row.id)}
						<li>
							<a href="/kadai/{row.id}">{row.title}</a>
							<span class="meta">{ja.search.supports(row.supports)}</span>
							{@render text(row.parts)}
						</li>
					{/each}
				</ul>
				{#if !data.shurui && r.kadai.total > r.kadai.rows.length}
					<p><a href={href({ shurui: 'kadai' })}>{ja.search.more(r.kadai.total)}</a></p>
				{/if}
			</section>
		{/if}

		{#if r.kaiketsu}
			<section>
				{@render heading(ja.search.sections.kaiketsu, r.kaiketsu.total)}
				{#if r.kaiketsu.total === 0}<p class="none">{ja.search.none}</p>{/if}
				<ul>
					{#each r.kaiketsu.rows as row (row.id)}
						<li>
							<a href="/kadai/{row.issueId}/kaiketsu#kaiketsu-{row.id}">{@render text(row.parts)}</a>
							<span class="meta">{row.issueTitle} ・ {ja.search.supports(row.supports)}</span>
						</li>
					{/each}
				</ul>
				{#if !data.shurui && r.kaiketsu.total > r.kaiketsu.rows.length}
					<p><a href={href({ shurui: 'kaiketsu' })}>{ja.search.more(r.kaiketsu.total)}</a></p>
				{/if}
			</section>
		{/if}

		{#if data.shurui && (data.page > 1 || r.hasNext)}
			<nav class="pages">
				{#if data.page > 1}<a href={pageHref(data.page - 1)}>{ja.search.prevPage}</a>{/if}
				{#if r.hasNext}<a href={pageHref(data.page + 1)}>{ja.search.nextPage}</a>{/if}
			</nav>
		{/if}
	{/if}
</main>

<style>
	main {
		max-width: 48rem;
		margin: 0 auto;
		padding: 1rem;
	}

	h1 {
		font-size: var(--font-size-page-title);
	}

	h2 {
		margin: 1.5rem 0 0.5rem;
		font-size: var(--font-size-heading);
		border-bottom: 1px solid var(--color-divider);
	}

	h2 span {
		color: var(--color-text-sub);
		font-weight: normal;
	}

	.search {
		display: grid;
		gap: 0.25rem;
	}

	.search label {
		font-weight: bold;
		font-size: var(--font-size-sub);
	}

	.row {
		display: flex;
		gap: 0.5rem;
	}

	input {
		flex: 1;
		min-height: var(--tap-min);
		padding: 0 0.75rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-m);
		font: inherit;
	}

	button {
		min-height: var(--tap-min);
		padding: 0 1rem;
		border: 1px solid var(--color-base);
		border-radius: var(--radius-m);
		background: var(--color-base);
		color: var(--color-bg);
		font: inherit;
		font-weight: bold;
	}

	ul {
		padding: 0;
		list-style: none;
	}

	li {
		display: grid;
		gap: 0.25rem;
		padding: 0.75rem 0;
		border-bottom: 1px solid var(--color-divider);
	}

	.position {
		font-weight: bold;
	}

	.snippet,
	.meta,
	.note,
	.none {
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	mark {
		background: var(--color-caution-bg);
		color: var(--color-text);
		font-weight: bold;
	}

	[role='alert'] {
		color: var(--color-caution);
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
</style>
