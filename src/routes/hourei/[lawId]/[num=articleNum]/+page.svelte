<script lang="ts">
	// 条だけのページ（Issue #164。案 SpLawArticle・PcLawArticle）。条の表示は法令のページと同じ部品（ふりがなと法令用語の説明）。
	// この条に触れている議論（リンク元。Issue #166）：この条を変える法案（遊べる法律だけ）と、課題・解決策・質疑。0件は「まだありません」
	import ArticlePager from '#lib/components/ArticlePager.svelte';
	import ArticleUrl from '#lib/components/ArticleUrl.svelte';
	import Crumbs from '#lib/components/Crumbs.svelte';
	import DisplaySettings from '#lib/components/DisplaySettings.svelte';
	import LawParagraphs from '#lib/components/LawParagraphs.svelte';
	import { ja } from '#lib/copy/ja.ts';
	import { fullYears } from '#lib/domain/law/display.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const lawHref = $derived(`/hourei/${data.law.id}`);
</script>

<svelte:head>
	<title>{ja.lawArticle.pageTitle(data.law.title, data.article.label)}</title>
</svelte:head>

<main class="frame">
	<Crumbs current={data.article.label} parent={{ href: lawHref, label: data.law.title }} />
	<div class="layout">
		<div>
			<div class="title-row">
				<h1>{data.article.label}<span class="caption">{data.article.caption}</span></h1>
				<DisplaySettings />
			</div>
			{#if data.kind === 'playable'}
				<p class="sub">{ja.lawArticle.meta([data.law.title, ja.lawArticle.real, ja.lawArticle.asOf(data.asOf)])}</p>
			{:else}
				<p class="sub">{data.law.title}</p>
				<p class="label">{ja.law.readable}</p>
			{/if}
			<article aria-label={data.article.label}>
				<LawParagraphs paragraphs={data.article.paragraphs} />
			</article>
			{#if data.kind === 'playable'}
				<p class="amended">
					{#if data.article.lastAmended}
						<strong>{ja.law.amended(data.article.lastAmended, fullYears(data.article.lastAmended, data.today))}</strong>
					{:else if data.article.enacted}
						{ja.law.enacted(data.article.enacted, fullYears(data.article.enacted, data.today))}
					{:else}
						{ja.law.unchangedSinceBaseline}
					{/if}
				</p>
			{/if}
			<ArticlePager base={lawHref} prev={data.prev} next={data.next} />
		</div>
		<aside>
			<ArticleUrl url={data.shareUrl} />
			<ul class="links">
				<li><a href="{lawHref}#jo-{data.article.num}">{ja.lawArticle.wholeLaw}</a></li>
				<!-- IF世界があるのは遊べる法律だけ -->
				<!-- 条の番号は世界のあいだで同じとは限らないので、法令全体の同じ番号の位置へ送る -->
				{#if data.kind === 'playable'}<li><a href="/if/hourei/{data.law.id}#jo-{data.article.num}">{ja.lawArticle.toIf}</a></li>{/if}
			</ul>
			<section class="backlinks" aria-labelledby="backlinks-heading">
				<h2 id="backlinks-heading">{ja.lawArticle.backlinks.heading}</h2>
				{#if data.backlinks.bills}
					<h3 id="backlinks-bills">{ja.lawArticle.backlinks.bills}</h3>
					{#if data.backlinks.bills.length}
						<ul aria-labelledby="backlinks-bills">
							{#each data.backlinks.bills as bill (bill.id)}
								<li>
									<a href="/houan/{bill.id}">{bill.title}</a>
									<p class="meta">
										{ja.lawArticle.backlinks.meta([...(bill.stage ? [ja.bill.list.stages[bill.stage]] : []), ...(bill.session ? [ja.lawArticle.backlinks.session(bill.session)] : [])])}
									</p>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="empty">{ja.lawArticle.backlinks.empty}</p>
					{/if}
				{/if}
				<h3 id="backlinks-discussions">{ja.lawArticle.backlinks.discussions}</h3>
				{#if data.backlinks.discussions.length}
					<ul aria-labelledby="backlinks-discussions">
						{#each data.backlinks.discussions as d (d.href)}
							<li>
								<p class="meta">{ja.lawArticle.backlinks.meta([ja.lawArticle.backlinks.kinds[d.kind], ...(d.context ? [d.context] : [])])}</p>
								<a href={d.href}>{d.text}</a>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="empty">{ja.lawArticle.backlinks.empty}</p>
				{/if}
			</section>
		</aside>
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
		overflow-wrap: anywhere;
	}

	.caption {
		display: block;
		color: var(--color-text-sub);
		font-size: var(--font-size-body);
		font-weight: normal;
	}

	.sub,
	.amended {
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	.amended strong {
		color: var(--color-text);
	}

	/* 「読める法律（最新の版だけ）」：法令のページと同じ札 */
	.label {
		display: inline-block;
		margin: 0 0 0.5rem;
		padding: 0.125rem 0.75rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		color: var(--color-text);
		font-size: var(--font-size-sub);
	}

	article {
		overflow-wrap: anywhere;
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

	/* この条に触れている議論（SpLawArticle・PcLawArticle）：太い線で区切り、行は細い線で区切る */
	.backlinks {
		margin-top: 1.5rem;
		padding-top: 1rem;
		border-top: 2px solid var(--color-text);
	}

	.backlinks h2 {
		margin: 0 0 0.75rem;
		font-size: var(--font-size-heading);
	}

	.backlinks h3 {
		margin: 1.25rem 0 0;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid var(--color-divider);
		color: var(--color-text-sub);
		font-size: var(--font-size-body);
	}

	.backlinks h2 + h3 {
		margin-top: 0;
	}

	.backlinks ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.backlinks li {
		padding: 0.75rem 0;
		border-bottom: 1px solid var(--color-divider);
		overflow-wrap: anywhere;
	}

	.backlinks li a {
		display: inline-block;
		min-height: var(--tap-min);
		color: var(--color-text);
		font-weight: bold;
		line-height: var(--line-height-body);
	}

	.backlinks .meta {
		margin: 0;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	.backlinks .empty {
		margin: 0.75rem 0 0;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	/* PC：URL とリンクは右の欄 */
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
