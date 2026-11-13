<script lang="ts">
	// 読める法律のページ（Issue #162、設計書 docs/spec/162.md 決めたこと4）。最新の版の条文だけを出す。
	// 版の履歴がないので、改正の記録、比較へのリンク、条ごとの「N年変わっていない」、IF世界へのリンクは出さない
	import Crumbs from '#lib/components/Crumbs.svelte';
	import { ja } from '#lib/copy/ja.ts';
	import DisplaySettings from '#lib/components/DisplaySettings.svelte';
	import LawParagraphs from '#lib/components/LawParagraphs.svelte';
	import LawTitle from '#lib/components/LawTitle.svelte';
	import LawToc from '#lib/components/LawToc.svelte';
	import type { readableLawPage } from '#lib/server/law.ts';

	let { data }: { data: NonNullable<Awaited<ReturnType<typeof readableLawPage>>> } = $props();
</script>

<main class="frame">
	<Crumbs current={data.law.title} />
	<header class="law-head">
		<div class="title-row">
			<h1><LawTitle title={data.law.title} kana={data.law.titleKana} /></h1>
			<DisplaySettings />
		</div>
		<p class="label">{ja.law.readable}</p>
		<p class="sub">{ja.law.readableMeta(data.law.lawNum, data.lastAmended, data.promulgationDate)}</p>
	</header>

	<div class="layout">
		{#if data.toc.length}<LawToc items={data.toc} />{/if}
		<div>
			{#each data.articles as article (article.num)}
				{#if article.band}<h2 class="band">{ja.law.band(article.band)}</h2>{/if}
				<article id="jo-{article.num}" aria-labelledby="article-{article.num}">
					<h3><span id="article-{article.num}">{article.label}</span><span class="caption">{article.caption}</span></h3>
					<LawParagraphs paragraphs={article.paragraphs} />
				</article>
			{/each}
		</div>
	</div>
</main>

<style>
	main {
		padding: 1rem;
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
	}

	.law-head {
		margin-bottom: 1.5rem;
	}

	/* 「読める法律（最新の版だけ）」：色だけに頼らず、文字で示す */
	.label {
		display: inline-block;
		margin: 0.5rem 0 0;
		padding: 0.125rem 0.75rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		color: var(--color-text);
		font-size: var(--font-size-sub);
	}

	.sub {
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	article {
		margin-bottom: 1.5rem;
		scroll-margin-top: 1rem;
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

	/* 見出しの帯（遊べる法律のページと同じ） */
	.band {
		margin: 1.5rem 0 1rem;
		font-size: var(--font-size-body);
		padding: 0.5rem 0.75rem;
		border-left: 4px solid var(--color-base);
		background: var(--color-surface);
		font-weight: bold;
	}

	/* PC：目次は左の欄 */
	@media (min-width: 64rem) {
		.layout {
			display: grid;
			grid-template-columns: 13rem minmax(0, 1fr);
			gap: 2.5rem;
			align-items: start;
		}
	}
</style>
