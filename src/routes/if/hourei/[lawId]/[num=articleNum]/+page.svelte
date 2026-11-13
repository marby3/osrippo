<script lang="ts">
	// IF世界の条だけのページ（Issue #164）。帯（レイアウトが ifBand で出す）と「架空の法令」、noindex。
	// 改正の記録は出さない（IF世界の法令ページと同じ。docs/spec/72.md の G）
	import ArticlePager from '#lib/components/ArticlePager.svelte';
	import ArticleUrl from '#lib/components/ArticleUrl.svelte';
	import Crumbs from '#lib/components/Crumbs.svelte';
	import DisplaySettings from '#lib/components/DisplaySettings.svelte';
	import LawParagraphs from '#lib/components/LawParagraphs.svelte';
	import { ja } from '#lib/copy/ja.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const lawHref = $derived(`/if/hourei/${data.law.id}`);
</script>

<svelte:head>
	<title>{ja.lawArticle.ifPageTitle(data.law.title, data.article.label)}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="frame">
	<Crumbs current={data.article.label} parent={{ href: lawHref, label: ja.menu.pages.ifLaw(data.law.title) }} />
	<div class="layout">
		<div>
			<p class="fictional">{ja.ifLaw.fictional}</p>
			<div class="title-row">
				<h1>{data.article.label}<span class="caption">{data.article.caption}</span></h1>
				<DisplaySettings />
			</div>
			<p class="sub">{ja.lawArticle.meta([data.law.title, ja.ifLaw.ifWorld])}</p>
			{#if data.repealedBy}<p class="notice">{ja.ifLaw.repealedBy}<a href="/houan/{data.repealedBy.id}">{data.repealedBy.title}</a></p>{/if}
			{#if data.enactedBy}<p class="notice">{ja.ifLaw.enactedBy}<a href="/houan/{data.enactedBy.id}">{data.enactedBy.title}</a></p>{/if}
			{#if data.article.conflict}<p class="conflict-mark">{ja.torikomi.mark}</p>{/if}
			<article aria-label={data.article.label} class:changed={data.article.changedBy}>
				<LawParagraphs paragraphs={data.article.paragraphs} />
				{#if data.article.changedBy}
					<p class="changed-by">{ja.ifLaw.changedBy}<a href="/houan/{data.article.changedBy.id}">{data.article.changedBy.title}</a></p>
				{/if}
			</article>
			<ArticlePager base={lawHref} prev={data.prev} next={data.next} />
		</div>
		<aside>
			<ArticleUrl url={data.shareUrl} />
			<ul class="links">
				<li><a href="{lawHref}#jo-{data.article.num}">{ja.lawArticle.ifWholeLaw}</a></li>
				<!-- 制定の新法には現実の法律がない -->
				<!-- 条の番号は世界のあいだで同じとは限らないので、相手の世界は法令全体の同じ番号の位置へ送る（ない条でも 404 にならない） -->
				{#if data.real}<li><a href="/hourei/{data.law.id}#jo-{data.article.num}">{ja.lawArticle.toReal}</a></li>{/if}
			</ul>
		</aside>
	</div>
</main>

<style>
	.notice {
		margin: 0.75rem 0 0;
		padding: 0.75rem 1rem;
		border-radius: var(--radius-m);
		background: var(--color-if-bg);
		overflow-wrap: anywhere;
	}

	main {
		padding: 1rem;
	}

	.fictional,
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

	.title-row {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}

	h1 {
		margin: 0;
		font-size: var(--font-size-page-title);
		overflow-wrap: anywhere;
	}

	.caption {
		display: block;
		color: var(--color-text-sub);
		font-size: var(--font-size-body);
		font-weight: normal;
	}

	.sub {
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	article {
		overflow-wrap: anywhere;
	}

	article.changed {
		padding: 1rem;
		border: 2px solid var(--color-if);
		border-radius: var(--radius-l);
	}

	.changed-by {
		margin: 0.5rem 0 0;
		font-size: var(--font-size-sub);
	}

	.links {
		margin: 1rem 0 0;
		padding: 0;
		list-style: none;
	}

	.links li {
		margin: 0 0 0.75rem;
	}

	.links a {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap-min);
	}

	@media (min-width: 64rem) {
		.layout {
			display: grid;
			grid-template-columns: minmax(0, 1fr) 20rem;
			gap: 2.5rem;
			align-items: start;
		}

		.caption {
			display: inline;
			margin-left: 0.5em;
		}
	}
</style>
