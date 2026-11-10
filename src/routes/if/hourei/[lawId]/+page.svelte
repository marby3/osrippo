<script lang="ts">
	// IF世界の法令ページ（SpLaw・PcLaw）。全ページに帯と「架空の法令」、noindex。
	// 改正履歴、変わった記録、2時点の比較は出さない（docs/spec/72.md の G）
	import Crumbs from '#lib/components/Crumbs.svelte';
	import LawParagraphs from '#lib/components/LawParagraphs.svelte';
	import LawSwitch from '#lib/components/LawSwitch.svelte';
	import LawToc from '#lib/components/LawToc.svelte';
	import { ja } from '#lib/copy/ja.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{ja.ifLaw.pageTitle(data.law.title)}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="frame">
	<Crumbs current={ja.menu.pages.ifLaw(data.law.title)} />
	<!-- 切り替えは、スマホは法令名の上、PC は法令名の行の右（SpLaw・PcLaw、Issue #124） -->
	<div class="law-top">
		{#if data.real}<LawSwitch lawId={data.law.id} current="if" />{/if}
		<header>
			<p class="fictional">{ja.ifLaw.fictional}</p>
			<h1>{data.law.title}</h1>
			{#if data.law.lawNum}<p class="sub">{data.law.lawNum}</p>{/if}
			{#if data.repealedBy}<p class="notice">{ja.ifLaw.repealedBy}<a href="/houan/{data.repealedBy.id}">{data.repealedBy.title}</a></p>{/if}
			{#if data.enactedBy}<p class="notice">{ja.ifLaw.enactedBy}<a href="/houan/{data.enactedBy.id}">{data.enactedBy.title}</a></p>{/if}
			{#if data.real}<p class="torikomi"><a href="/if/hourei/{data.law.id}/torikomi">{ja.torikomi.heading}</a></p>{/if}
		</header>
	</div>

	<div class="layout">
		<!-- 目次は現実の法律と同じ部品（スマホは「目次から探す」で開く。Issue #124） -->
		{#if data.toc.length}<LawToc items={data.toc} />{/if}
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

	.layout {
		margin-top: 1rem;
	}

	@media (min-width: 64rem) {
		/* 切り替えは法令名の行の右 */
		.law-top {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			column-gap: 2rem;
			align-items: start;
		}

		/* 「架空の法令」の札の下の法令名の行にそろえるため、header の中身を表の行として並べる */
		header {
			display: contents;
		}

		header > * {
			grid-column: 1;
		}

		.fictional {
			justify-self: start;
		}

		.law-top > :global(nav) {
			grid-area: 2 / 2;
			align-self: center;
		}

		.layout {
			display: grid;
			grid-template-columns: 15rem minmax(0, 1fr);
			gap: 2.5rem;
			margin-top: 1rem;
		}
	}
</style>
