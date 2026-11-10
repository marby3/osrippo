<script lang="ts">
	import Crumbs from '#lib/components/Crumbs.svelte';
	import { ja, jaDate } from '#lib/copy/ja.ts';
	import { fullYears } from '#lib/domain/law/display.ts';
	import DiffText from '#lib/components/DiffText.svelte';
	import DisplaySettings from '#lib/components/DisplaySettings.svelte';
	import LawParagraphs from '#lib/components/LawParagraphs.svelte';
	import LawTitle from '#lib/components/LawTitle.svelte';
	import LawSwitch from '#lib/components/LawSwitch.svelte';
	import LawToc from '#lib/components/LawToc.svelte';
	import { changedLines, type DiffPart } from '#lib/domain/law/compare.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	type ArticleRecord = {
		label: string;
		latest: DiffPart[];
		amendments: { date: string; lawNum: string; then: string | null }[];
		baseline: { then: string | null } | null;
		enacted: { date: string; then: string | null } | null;
	};

	/** 開いている条の番号と、その条の変わった記録（押したときに読み込む） */
	let openNum = $state<string | null>(null);
	let record = $state<ArticleRecord | null>(null);
	let failed = $state(false);

	/** PC は右の欄、スマホは条の下に開く */
	let wide = $state(false);
	$effect(() => {
		const query = matchMedia('(min-width: 64rem)');
		wide = query.matches;
		const update = () => (wide = query.matches);
		query.addEventListener('change', update);
		return () => query.removeEventListener('change', update);
	});

	async function toggle(num: string) {
		if (openNum === num) {
			openNum = null;
			return;
		}
		openNum = num;
		record = null;
		failed = false;
		try {
			const res = await fetch(`/hourei/${data.law.id}/kiroku/${encodeURIComponent(num)}`);
			const body: ArticleRecord | null = res.ok ? await res.json() : null;
			// 待っている間に別の条が押されたら、古い応答は捨てる
			if (openNum !== num) return;
			record = body;
			failed = !body;
		} catch {
			if (openNum === num) failed = true;
		}
	}
</script>

{#snippet recordPanel(r: ArticleRecord)}
	<section class="record" id="record" aria-labelledby="record-title">
		<h3 id="record-title">{ja.law.recordTitle(r.label)}</h3>
		<!-- 長い条でも読めるよう、最新の改正で変わった行だけを出す -->
		{#each changedLines(r.latest) as line}
			{#if line.gap}<p class="gap" aria-hidden="true">…</p>{/if}
			<DiffText parts={line.parts} />
		{/each}
		<ol class="entries">
			{#each r.amendments as a}
				<li>
					<strong>{ja.law.enforcedOn(a.date)}</strong>{#if a.then}<span>{ja.law.then(a.then)}</span>{/if}
					{#if a.lawNum}<span class="sub">{a.lawNum}</span>{/if}
				</li>
			{/each}
			{#if r.enacted}
				<li>
					<strong>{ja.law.enactedOn(r.enacted.date)}</strong>{#if r.enacted.then}<span>{ja.law.then(r.enacted.then)}</span>{/if}
				</li>
			{:else if r.baseline}
				<li>
					<strong>{ja.law.recordBeforeBaseline}</strong>{#if r.baseline.then}<span>{ja.law.then(r.baseline.then)}</span>{/if}
					<span class="sub">{ja.law.recordPreparing}</span>
				</li>
			{/if}
		</ol>
	</section>
{/snippet}

<svelte:head>
	<title>{ja.law.pageTitle(data.law.title)}</title>
</svelte:head>

<main class="frame">
	<Crumbs current={data.law.title} />
	<!-- 切り替えは、スマホは法令名の上、PC は法令名の行の右（SpLaw・PcLaw、Issue #124） -->
	<div class="law-top">
		<LawSwitch lawId={data.law.id} current="real" />
		<header class="law-head">
			<!-- 法令名の行の右に「表示の設定」（SpLaw・PcLaw、Issue #129） -->
			<div class="title-row">
				<h1><LawTitle title={data.law.title} kana={data.law.titleKana} /></h1>
				<DisplaySettings />
			</div>
			<p class="sub">{ja.law.meta(data.law.lawNum, data.current.enforcementDate)}</p>
			<p><a href="/hourei/{data.law.id}/hikaku">{ja.law.compareLink}</a></p>
			<!-- 全文検索の入口（設計書 docs/spec/38.md 決めたこと7） -->
			<p><a href="/kensaku">{ja.search.entry}</a></p>
		</header>
	</div>

	<div class="layout">
	{#if data.toc.length}<LawToc items={data.toc} />{/if}
	<div>
	{#each data.articles as article (article.num)}
		{#if article.band}<h2 class="band">{ja.law.band(article.band)}</h2>{/if}
		<article id="jo-{article.num}" aria-labelledby="article-{article.num}" class:selected={openNum === article.num}>
			<h3><span id="article-{article.num}">{article.label}</span><span class="caption">{article.caption}</span></h3>
			<LawParagraphs paragraphs={article.paragraphs} />
			<p class="amended">
				{#if article.lastAmended}
					<strong>{ja.law.amended(article.lastAmended, fullYears(article.lastAmended, data.today))}</strong>
				{:else if article.enacted}
					{ja.law.enacted(article.enacted, fullYears(article.enacted, data.today))}
				{:else}
					{ja.law.unchangedSinceBaseline}
				{/if}
			</p>
			{#if article.lastAmended}
				<button
					class="open"
					aria-expanded={openNum === article.num}
					aria-controls={openNum === article.num ? 'record' : undefined}
					onclick={() => toggle(article.num)}
				>
					{ja.law.openRecord}
				</button>
				{#if !wide && openNum === article.num}
					{#if record}{@render recordPanel(record)}{:else if failed}<p role="alert">{ja.law.recordFailed}</p>{/if}
				{/if}
			{/if}
		</article>
	{/each}
	</div>
	<aside>
		{#if wide && openNum}
			{#if record}{@render recordPanel(record)}{:else if failed}<p role="alert">{ja.law.recordFailed}</p>{/if}
		{/if}
	</aside>
	</div>

	<section aria-labelledby="history">
		<h2 id="history">{ja.law.history}</h2>
		{#if data.scheduled.length}
			<h3 id="scheduled">{ja.law.scheduled}</h3>
			<ul aria-labelledby="scheduled" class="revisions">
				{#each data.scheduled as r}
					<li><span class="date">{jaDate(r.date)}</span>{r.title}</li>
				{/each}
			</ul>
		{/if}
		<h3 id="enforced">{ja.law.enforced}</h3>
		<ol aria-labelledby="enforced" class="revisions">
			{#each data.enforced as r}
				<li><span class="date">{jaDate(r.date)}</span>{r.title}</li>
			{/each}
			{#if data.enacted}
				<li><span class="date">{jaDate(data.enacted)}</span>{ja.law.enactment}</li>
			{/if}
		</ol>
		{#if !data.enacted}
			<p class="sub">{ja.law.beforeBaseline}</p>
		{/if}
	</section>
</main>

<style>
	.title-row {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}

	main {
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

	article h3 {
		margin: 0 0 0.25rem;
		font-size: var(--font-size-body);
	}

	.caption {
		margin-left: 0.5em;
		color: var(--color-text-sub);
		font-weight: normal;
	}

	section {
		border-top: 1px solid var(--color-divider);
		margin-top: 2rem;
	}

	h3 {
		font-size: var(--font-size-sub);
		margin-bottom: 0.25rem;
	}

	/* 見出しの帯（「第二章　…／第二節　…」） */
	.band {
		margin: 1.5rem 0 1rem;
		font-size: var(--font-size-body);
		padding: 0.5rem 0.75rem;
		border-left: 4px solid var(--color-base);
		background: var(--color-surface);
		font-weight: bold;
	}

	article {
		scroll-margin-top: 1rem;
	}

	/* 開くと「⌄」が上を向く */
	.open::after {
		content: '⌄';
		float: right;
	}

	.open[aria-expanded='true']::after {
		transform: rotate(180deg);
	}

	.open {
		min-height: var(--tap-min);
		width: 100%;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-m);
		background: var(--color-bg);
		color: var(--color-text);
		font: inherit;
		text-align: left;
		padding: 0 1rem;
	}

	.record {
		margin-top: 0.75rem;
		padding: 0 1rem 0.5rem;
		border-radius: var(--radius-l);
		background: var(--color-surface);
	}

	.record h3 {
		padding-top: 1rem;
		font-size: var(--font-size-body);
	}

	.gap {
		margin: 0;
		color: var(--color-text-sub);
	}

	.entries {
		margin: 0;
		padding-left: 0.75rem;
		border-left: 2px solid var(--color-text-sub);
		list-style: none;
	}

	.entries li {
		padding: 0.25rem 0;
	}

	.entries .sub {
		display: block;
	}

	/* PC：記録は右の欄に出す */
	@media (min-width: 64rem) {
		/* 切り替えは法令名の行の右 */
		.law-top {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			column-gap: 2rem;
			align-items: start;
		}

		.law-top > :global(nav) {
			grid-area: 1 / 2;
		}

		.law-head {
			grid-area: 1 / 1;
		}

		.layout {
			display: grid;
			grid-template-columns: 13rem minmax(0, 1fr) 20rem;
			gap: 2.5rem;
			align-items: start;
		}

		aside {
			position: sticky;
			top: 1rem;
		}

		.record {
			margin-top: 0;
		}

		/* 右の欄に記録を出している条を枠で示す */
		article.selected {
			border: 2px solid var(--color-base);
			border-radius: var(--radius-l);
			padding: 0 1rem 1rem;
		}
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
