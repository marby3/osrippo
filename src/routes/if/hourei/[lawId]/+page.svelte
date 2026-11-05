<script lang="ts">
	// IF世界の法令ページ（SpLaw・PcLaw）。全ページに帯と「架空の法令」、noindex。
	// 改正履歴、変わった記録、2時点の比較は出さない（docs/spec/72.md の G）
	import IfBand from '#lib/components/IfBand.svelte';
	import LawParagraphs from '#lib/components/LawParagraphs.svelte';
	import LawSwitch from '#lib/components/LawSwitch.svelte';
	import { ja } from '#lib/copy/ja.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{ja.ifLaw.pageTitle(data.law.title)}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

{#snippet tocList(items: typeof data.toc)}
	<ul>
		{#each items as h (h.title)}
			<li>
				{#if h.first}<a href="#jo-{h.first}">{h.title}</a>{:else}{h.title}{/if}
				{#if h.children.length}{@render tocList(h.children)}{/if}
			</li>
		{/each}
	</ul>
{/snippet}

<IfBand />

<main>
	{#if data.real}<LawSwitch lawId={data.law.id} current="if" />{/if}
	<header>
		<p class="fictional">{ja.ifLaw.fictional}</p>
		<h1>{data.law.title}</h1>
		{#if data.law.lawNum}<p class="sub">{data.law.lawNum}</p>{/if}
		{#if data.repealedBy}<p class="notice">{ja.ifLaw.repealedBy}<a href="/houan/{data.repealedBy.id}">{data.repealedBy.title}</a></p>{/if}
		{#if data.enactedBy}<p class="notice">{ja.ifLaw.enactedBy}<a href="/houan/{data.enactedBy.id}">{data.enactedBy.title}</a></p>{/if}
		{#if data.real}<p class="torikomi"><a href="/if/hourei/{data.law.id}/torikomi">{ja.torikomi.heading}</a></p>{/if}
	</header>

	<div class="layout">
		{#if data.toc.length}
			<nav aria-labelledby="toc-title">
				<h2 id="toc-title">{ja.law.toc}</h2>
				{@render tocList(data.toc)}
			</nav>
		{/if}
		<div>
			{#each data.articles as article (article.num)}
				{#if article.band}<h2 class="band">{ja.law.band(article.band)}</h2>{/if}
				<article id="jo-{article.num}" aria-labelledby="article-{article.num}" class:changed={article.changedBy}>
					<h3><span id="article-{article.num}">{article.label}</span><span class="caption">{article.caption}</span></h3>
					{#if article.conflict}<p class="conflict-mark">{ja.torikomi.mark}</p>{/if}
					<LawParagraphs paragraphs={article.paragraphs} />
					{#if article.changedBy}
						<p class="changed-by">{ja.ifLaw.changedBy}<a href="/houan/{article.changedBy.id}">{article.changedBy.title}</a></p>
					{/if}
				</article>
			{/each}
		</div>
	</div>
</main>

<style>
	main {
		max-width: 76rem;
		margin: 0 auto;
		padding: 1rem;
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

	h1 {
		margin: 0.5rem 0 0;
		font-size: var(--font-size-page-title);
		overflow-wrap: anywhere;
	}

	.sub {
		margin: 0.25rem 0 0;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	.notice {
		margin: 0.75rem 0 0;
		padding: 0.75rem 1rem;
		border-radius: var(--radius-m);
		background: var(--color-if-bg);
		overflow-wrap: anywhere;
	}

	.torikomi {
		margin: 0.75rem 0 0;
		font-size: var(--font-size-sub);
	}

	.conflict-mark {
		display: inline-block;
		margin: 0 0 0.5rem;
		padding: 0 0.5rem;
		border: 1px solid var(--color-if);
		border-radius: var(--radius-s);
		color: var(--color-if);
		font-size: var(--font-size-sub);
		font-weight: bold;
	}

	nav h2 {
		font-size: var(--font-size-sub);
	}

	nav ul {
		margin: 0;
		padding-left: 1em;
		list-style: none;
		font-size: var(--font-size-sub);
	}

	.band {
		margin: 1.5rem 0 1rem;
		padding: 0.5rem 0.75rem;
		border-left: 4px solid var(--color-if);
		background: var(--color-surface);
		font-size: var(--font-size-body);
		font-weight: bold;
	}

	article {
		margin-top: 1.5rem;
		overflow-wrap: anywhere;
	}

	article.changed {
		padding: 1rem;
		border: 2px solid var(--color-if);
		border-radius: var(--radius-l);
	}

	article h3 {
		margin: 0 0 0.25rem;
		font-size: var(--font-size-body);
	}

	.caption {
		margin-left: 0.5em;
		color: var(--color-text-sub);
		font-weight: normal;
	}

	.changed-by {
		margin: 0.5rem 0 0;
		font-size: var(--font-size-sub);
	}

	nav {
		display: none;
	}

	@media (min-width: 64rem) {
		.layout {
			display: grid;
			grid-template-columns: 15rem minmax(0, 1fr);
			gap: 2.5rem;
			margin-top: 1rem;
		}

		nav {
			display: block;
		}
	}
</style>
