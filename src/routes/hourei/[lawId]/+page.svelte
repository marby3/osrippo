<script lang="ts">
	import { ja, jaDate } from '#lib/copy/ja.ts';
	import { fullYears, itemLabel } from '#lib/domain/law/display.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{data.law.title}｜{ja.siteName}</title>
</svelte:head>

<main>
	<header class="law-head">
		<h1>{data.law.title}</h1>
		<p class="sub">{data.law.lawNum} ・ {ja.law.asOf(data.current.enforcementDate)}</p>
	</header>

	{#each data.articles as article (article.num)}
		<article aria-labelledby="article-{article.num}">
			<h2><span id="article-{article.num}">{article.label}</span><span class="caption">{article.caption}</span></h2>
			{#each article.paragraphs as paragraph, i (paragraph.num)}
				<div class="paragraph">
					<p>{#if i > 0}<span class="num">{paragraph.num}</span>{/if}{paragraph.text}</p>
					{#if paragraph.items.length}
						<ol>
							{#each paragraph.items as item (item.num)}
								<li><span class="num">{itemLabel(item.num)}</span>{item.text}</li>
							{/each}
						</ol>
					{/if}
				</div>
			{/each}
			<p class="amended">
				{#if article.lastAmended}
					<strong>{ja.law.amended(article.lastAmended, fullYears(article.lastAmended, data.today))}</strong>
				{:else}
					{ja.law.unchangedSinceBaseline}
				{/if}
			</p>
		</article>
	{/each}

	<section aria-labelledby="history">
		<h2 id="history">{ja.law.history}</h2>
		{#if data.scheduled.length}
			<h3 id="scheduled">{ja.law.scheduled}</h3>
			<ul aria-labelledby="scheduled" class="revisions">
				{#each data.scheduled as r, i (i)}
					<li><span class="date">{jaDate(r.date)}</span>{r.title}</li>
				{/each}
			</ul>
		{/if}
		<h3 id="enforced">{ja.law.enforced}</h3>
		<ol aria-labelledby="enforced" class="revisions">
			{#each data.enforced as r, i (i)}
				<li><span class="date">{jaDate(r.date)}</span>{r.title}</li>
			{/each}
		</ol>
		<p class="sub">{ja.law.beforeBaseline}</p>
	</section>
</main>

<style>
	main {
		max-width: 52rem;
		margin: 0 auto;
		padding: 1rem;
	}

	h1 {
		margin: 0;
		font-size: var(--font-size-page-title);
	}

	h2 {
		font-size: var(--font-size-body);
	}

	.law-head {
		margin-bottom: 1.5rem;
	}

	.sub,
	.amended {
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	.amended strong {
		color: var(--color-text);
	}

	article {
		margin-bottom: 1.5rem;
	}

	article h2 {
		margin: 0 0 0.25rem;
	}

	.caption {
		margin-left: 0.5em;
		color: var(--color-text-sub);
		font-weight: normal;
	}

	.paragraph p,
	.paragraph li {
		margin: 0;
		line-height: var(--line-height-law);
		/* 号の細分（イ、ロ、ハ）は改行して出す */
		white-space: pre-line;
	}

	.paragraph ol {
		margin: 0;
		padding-left: 1em;
		list-style: none;
	}

	.num {
		margin-right: 1em;
	}

	section {
		border-top: 1px solid var(--color-divider);
		margin-top: 2rem;
	}

	h3 {
		font-size: var(--font-size-sub);
		margin-bottom: 0.25rem;
	}

	.revisions {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.revisions li {
		padding: 0.5rem 0;
		border-bottom: 1px solid var(--color-surface);
	}

	.date {
		display: block;
		font-weight: bold;
	}
</style>
