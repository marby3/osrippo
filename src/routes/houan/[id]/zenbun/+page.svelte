<script lang="ts">
	// 条文全体のなかで変更点を見る（Issue #54）。キャンバスに案がないので、法令ページ（SpLaw・PcLaw）の形で組む。
	// 変更点は色だけで示さない：削除は取り消し線と「−」、追加は下線と「＋」（DiffText）
	import Crumbs from '#lib/components/Crumbs.svelte';
	import DiffText from '#lib/components/DiffText.svelte';
	import LawParagraphs from '#lib/components/LawParagraphs.svelte';
	import { ja } from '#lib/copy/ja.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const base = $derived(`/houan/${data.bill.id}`);
	const changed = $derived(data.articles.filter((a) => a.op !== null));
</script>

<svelte:head>
	<title>{ja.bill.page.fullTextTitle(data.bill.title, data.law.title)}</title>
	<!-- 架空の条文を出すので検索に載せない（docs/spec/72.md の F） -->
	<meta name="robots" content="noindex" />
</svelte:head>

<main>
	<Crumbs middle={[{ href: base, label: data.bill.title }]} current={ja.bill.page.fullTextCrumb} />
	<h1>{data.law.title}</h1>
	<p class="note">{ja.bill.page.fullTextNote}</p>
	<p class="back"><a href="{base}/henkou">{ja.bill.page.fullTextBack}</a></p>

	{#if data.laws.length > 1}
		<nav class="laws" aria-label={ja.bill.page.fullTextLaws}>
			{#each data.laws as law (law.seq)}
				<a href="{base}/zenbun{law.seq === 0 ? '' : `?hourei=${law.seq}`}" aria-current={law.seq === data.law.seq ? 'page' : undefined}>{law.title}</a>
			{/each}
		</nav>
	{/if}

	{#if data.law.action === 'repeal'}
		<p class="repeal">{ja.bill.page.repeal(data.law.title)}</p>
		<p><a href="/if/hourei/{data.law.lawId}">{ja.ifLaw.toLaw}</a></p>
	{:else}
		{#if changed.length || data.supplementary}
			<nav class="changed-list" aria-labelledby="changed-heading">
				<h2 id="changed-heading">{ja.bill.page.fullTextChanged}</h2>
				<ul>
					{#each changed as a (a.num)}
						<li><a href="#jo-{a.num}">{ja.bill.page.fullTextRow(a.label, ja.bill.ops[a.op ?? 'amend'])}</a></li>
					{/each}
					{#if data.supplementary}<li><a href="#fusoku">{ja.bill.page.fullTextRow(ja.bill.page.supplementary, ja.bill.ops.supplementary)}</a></li>{/if}
				</ul>
			</nav>
		{/if}

		<div class="articles">
			{#each data.articles as article (article.num)}
				{#if article.band}<h2 class="band">{ja.law.band(article.band)}</h2>{/if}
				<article id="jo-{article.num}" aria-labelledby="article-{article.num}" class:changed={article.op}>
					<h3>
						<span id="article-{article.num}">{article.label}</span>
						{#if article.captionBefore !== null}
							<span class="caption">{#if article.captionBefore}<del>−{article.captionBefore}</del>{/if}{#if article.caption}<ins>＋{article.caption}</ins>{/if}</span>
						{:else}
							<span class="caption">{article.caption}</span>
						{/if}
						{#if article.op}<span class="op">{ja.bill.ops[article.op]}</span>{/if}
					</h3>
					{#if article.parts}<DiffText parts={article.parts} />{:else if article.paragraphs}<LawParagraphs paragraphs={article.paragraphs} />{/if}
				</article>
			{/each}
			{#if data.supplementary}
				<article id="fusoku" aria-labelledby="article-fusoku" class="changed">
					<h3><span id="article-fusoku">{ja.bill.page.supplementary}</span><span class="op">{ja.bill.ops.supplementary}</span></h3>
					<DiffText parts={[{ value: data.supplementary, added: true }]} />
				</article>
			{/if}
		</div>
	{/if}
</main>

<style>
	main {
		max-width: 48rem;
		margin: 0 auto;
		padding: 1rem;
	}

	.note,
	.back {
		margin: 0.5rem 0;
		font-size: var(--font-size-sub);
	}

	.note {
		color: var(--color-text-sub);
	}

	h1 {
		margin: 0.5rem 0 0;
		font-size: var(--font-size-page-title);
	}

	.laws {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin: 1rem 0;
	}

	.laws a {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap-min);
		padding: 0 1rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-m);
		color: var(--color-text);
		text-decoration: none;
	}

	.laws a[aria-current='page'] {
		border-color: var(--color-base);
		font-weight: bold;
	}

	.changed-list h2,
	.band {
		margin: 1.5rem 0 0.5rem;
		font-size: var(--font-size-body);
	}

	.changed-list ul {
		margin: 0;
		padding-left: 1.25em;
	}

	.changed-list li a {
		display: inline-block;
		min-height: var(--tap-min);
		line-height: var(--tap-min);
	}

	/* SpLaw の章の帯 */
	.band {
		padding: 0.5rem 0.75rem;
		border-left: 4px solid var(--color-base);
		background: var(--color-surface);
	}

	article {
		margin: 1rem 0;
		scroll-margin-top: 1rem;
	}

	article.changed {
		padding: 0 1rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-l);
	}

	h3 {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0 0.5rem;
		margin: 0.75rem 0 0.25rem;
		font-size: var(--font-size-body);
	}

	.caption {
		color: var(--color-text-sub);
		font-weight: normal;
	}

	.op {
		padding: 0 0.5rem;
		border: 1px solid var(--color-text);
		border-radius: var(--radius-s);
		font-size: var(--font-size-sub);
	}

	del {
		background: var(--color-del-bg);
		color: var(--color-del-text);
		text-decoration: line-through;
	}

	ins {
		background: var(--color-ins-bg);
		color: var(--color-ins-text);
		text-decoration: underline;
	}

	.repeal {
		padding: 1rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-l);
	}
</style>
