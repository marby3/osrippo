<script lang="ts">
	// 法案の書き方（Issue #59）。キャンバスに案がないので、法案のページと法令ページの文字の組み方に合わせて組む
	import Crumbs from '#lib/components/Crumbs.svelte';
	import { ja } from '#lib/copy/ja.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const t = ja.bill.howto;
	const sections = $derived([
		{ id: 'nagare', title: t.sections.flow, items: t.flow(data.proposeUntil, data.deliberation, data.vote), ordered: true, note: t.flowNote },
		{ id: 'kakihajime', title: t.sections.start, items: t.start(data.waitDays, data.solutions) },
		{ id: 'shurui', title: t.sections.kinds, items: t.kinds, note: t.kindsNote },
		{ id: 'jo', title: t.sections.articles, items: t.articles, example: true },
		{ id: 'fukusu', title: t.sections.laws, items: t.laws(data.laws, data.changes) },
		{ id: 'hatsugi', title: t.sections.propose, items: t.propose(data.percent, data.min, data.proposeUntil) },
		{ id: 'ato', title: t.sections.after, items: t.after }
	]);
</script>

<svelte:head>
	<title>{t.pageTitle}</title>
</svelte:head>

<main>
	<Crumbs current={t.heading} />
	<h1>{t.heading}</h1>
	<p class="lead">{t.lead}</p>
	<!-- 全体の流れは遊び方へ（Issue #131） -->
	<p class="asobikata"><a href="/asobikata">{ja.asobikata.back}</a></p>

	<!-- 目次は節と同じ階層の見出しにしない -->
	<nav class="toc" aria-label={t.toc}>
		<p class="toc-title" aria-hidden="true">{t.toc}</p>
		<ol>
			{#each sections as s (s.id)}<li><a href="#{s.id}">{s.title}</a></li>{/each}
		</ol>
	</nav>

	{#each sections as s (s.id)}
		<section id={s.id} aria-labelledby="{s.id}-heading">
			<h2 id="{s.id}-heading">{s.title}</h2>
			{#if s.ordered}
				<ol class="steps">{#each s.items as item (item)}<li>{item}</li>{/each}</ol>
			{:else}
				<ul>{#each s.items as item (item)}<li>{item}</li>{/each}</ul>
			{/if}
			{#if s.example}
				<figure>
					<figcaption>{t.articlesExampleLabel}</figcaption>
					<pre>{t.articlesExample}</pre>
				</figure>
				<p>{t.articlesAdd}</p>
			{/if}
			{#if s.note}<p class="note">{s.note}</p>{/if}
		</section>
	{/each}

	<p class="start">{t.startFrom}</p>
	<p><a class="to-issues" href="/kadai">{t.toIssues}</a></p>
</main>

<style>
	main {
		max-width: 48rem;
		margin: 0 auto;
		padding: 1rem;
	}

	.note {
		font-size: var(--font-size-sub);
	}

	.note {
		color: var(--color-text-sub);
	}

	h1 {
		margin: 0.5rem 0;
		font-size: var(--font-size-page-title);
	}

	h2 {
		margin: 2rem 0 0.5rem;
		padding: 0.5rem 0.75rem;
		border-left: 4px solid var(--color-base);
		background: var(--color-surface);
		font-size: var(--font-size-body);
	}

	.toc {
		margin: 1rem 0;
		padding: 0 1rem 0.5rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-l);
	}

	.toc-title {
		margin: 0.75rem 0 0;
		font-weight: bold;
	}

	.toc a {
		display: inline-block;
		min-height: var(--tap-min);
		line-height: var(--tap-min);
	}

	li {
		margin: 0.25rem 0;
		line-height: var(--line-height-law);
	}

	section {
		scroll-margin-top: 1rem;
	}

	figure {
		margin: 0.75rem 0;
	}

	figcaption {
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	pre {
		margin: 0.25rem 0 0;
		padding: 0.75rem 1rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-m);
		background: var(--color-surface);
		font: inherit;
		line-height: var(--line-height-law);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.start {
		margin-top: 2rem;
		font-weight: bold;
	}

	.asobikata a,
	.to-issues {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap-min);
	}
</style>
