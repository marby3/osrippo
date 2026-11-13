<script lang="ts">
	// 会期のリプレイ（SpReplay・PcReplay、Issue #170）。課題 → 法案 → 質疑の要点 → 採決 → IF世界で変わった条文の順。
	// 採決は票の数だけ（個人の票と立場別の区分は出さない）。IF世界の条文の節には帯を付ける。変更点は色だけで示さない（DiffText）
	import Crumbs from '#lib/components/Crumbs.svelte';
	import DiffText from '#lib/components/DiffText.svelte';
	import IfBand from '#lib/components/IfBand.svelte';
	import { ja } from '#lib/copy/ja.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const t = ja.replay;
	const name = $derived(ja.toukei.session(data.session));
	const keys = ['issues', 'bills', 'points', 'votes', 'ifWorld'] as const;
</script>

<svelte:head>
	<title>{t.pageTitle(name)}</title>
	<!-- 架空の条文を出すので検索に載せない -->
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="frame">
	<Crumbs current={t.crumb} />
	<p class="committee">{data.committee}</p>
	<h1>{name}</h1>

	<!-- PC だけ、節へ移るボタンを並べる（PcReplay） -->
	<nav class="jumps" aria-label={t.jump}>
		<ul>
			{#each keys as key (key)}<li><a href="#kaiki-{key}" class:if={key === 'ifWorld'}>{t.jumps[key]}</a></li>{/each}
		</ul>
	</nav>

	<section id="kaiki-issues" aria-labelledby="kaiki-issues-heading">
		<h2 id="kaiki-issues-heading">{t.headings.issues}</h2>
		{#if data.issues.length}
			<ul class="plain issues">
				{#each data.issues as issue (issue.id)}
					<li><a href="/kadai/{issue.id}">{issue.title}</a> <span class="meta">{t.issueMeta(issue.supports, issue.solutions)}</span></li>
				{/each}
			</ul>
		{:else}
			<p class="empty">{t.noIssues}</p>
		{/if}
	</section>

	<section id="kaiki-bills" aria-labelledby="kaiki-bills-heading">
		<h2 id="kaiki-bills-heading">{t.headings.bills}</h2>
		{#if data.bills.length}
			<p>{t.billsSummary(data.bills.length, data.amended)}</p>
			<ul class="plain bills">
				{#each data.bills as bill (bill.id)}<li><a href="/houan/{bill.id}">{bill.title}</a></li>{/each}
			</ul>
		{:else}
			<p class="empty">{t.noBills}</p>
		{/if}
	</section>

	<section id="kaiki-points" aria-labelledby="kaiki-points-heading">
		<h2 id="kaiki-points-heading">{t.headings.points}</h2>
		<p class="note">{t.pointsNote}</p>
		{#if data.points.length}
			<ul class="plain points">
				{#each data.points as point (point.postId)}
					<li>
						<p class="who"><span class="kind">{t.pointKinds[point.kind]}</span> ・ {point.billTitle}</p>
						<a href="/houan/{point.billId}/shitsugi#shitsugi-{point.questionId}">{point.excerpt}</a>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="empty">{t.noPoints}</p>
		{/if}
	</section>

	<section id="kaiki-votes" aria-labelledby="kaiki-votes-heading">
		<h2 id="kaiki-votes-heading">{t.headings.votes}</h2>
		{#if data.votes.length}
			<!-- PC は表の形にし、見出しの行を出す。各行の「数えた票」「参考の票」は読み上げにだけ残す（PcReplay） -->
			<div class="vote-head" aria-hidden="true">
				<span>{t.columns.bill}</span><span>{t.columns.outcome}</span><span>{t.columns.counted}</span><span>{t.columns.reference}</span>
			</div>
			<ul class="plain votes">
				{#each data.votes as vote (vote.billId)}
					<li>
						<a class="title" href="/saiketsu/{vote.billId}/kekka">{vote.title}</a>
						{#if vote.state === 'reviewing'}
							<p class="reviewing">{ja.toukei.reviewing}</p>
						{:else}
							<p class="word">{ja.result.words[vote.state]}</p>
							<p class="count"><span class="label">{t.counted}</span> {t.line(vote.counted)}</p>
							<p class="count reference"><span class="label">{t.reference}</span> {t.line(vote.reference)}</p>
						{/if}
					</li>
				{/each}
			</ul>
			<p class="note">{ja.result.notice}{t.stanceNote}</p>
		{:else}
			<p class="empty">{t.noBills}</p>
		{/if}
	</section>

	<section id="kaiki-ifWorld" class="if-world" aria-labelledby="kaiki-ifWorld-heading">
		<IfBand short={t.band.short} long={t.band.long} />
		<div class="if-body">
			<h2 id="kaiki-ifWorld-heading">{t.headings.ifWorld}</h2>
			{#each data.ifBills as bill (bill.billId)}
				{#each bill.changes as change, i (i)}
					<article>
						<h3>{change.location}</h3>
						{#if change.parts}<DiffText parts={change.parts} />{/if}
					</article>
				{/each}
				{#each bill.places as place (place.lawId)}
					<p class="to-law"><a href="/if/hourei/{place.lawId}">{bill.places.length > 1 ? ja.ifLaw.toLawNamed(place.title) : ja.ifLaw.toLaw}</a></p>
				{/each}
			{:else}
				<p class="empty">{t.noChanges}</p>
			{/each}
			{#if data.ifMore}<p class="note">{t.moreChanges(data.ifMore)}</p>{/if}
		</div>
	</section>
</main>

<style>
	main {
		padding: 1rem;
	}

	.committee {
		margin: 0;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	h1 {
		margin: 0.25rem 0 0;
		font-size: var(--font-size-page-title);
	}

	section {
		margin-top: 2rem;
	}

	h2 {
		margin: 0 0 0.75rem;
		padding-bottom: 0.5rem;
		border-bottom: 2px solid var(--color-text);
		font-size: var(--font-size-heading);
	}

	h3 {
		margin: 1rem 0 0.25rem;
		font-size: var(--font-size-body);
	}

	a {
		color: var(--color-link);
		overflow-wrap: anywhere;
	}

	.plain {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.note,
	.empty,
	.meta {
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	.jumps {
		display: none;
	}

	.issues li,
	.bills li {
		padding: 0.5rem 0;
	}

	.issues a,
	.bills a {
		font-weight: bold;
	}

	.issues .meta {
		display: block;
	}

	.points li {
		margin-top: 0.75rem;
		padding: 0.75rem 1rem;
		border-left: 4px solid var(--color-base);
		background: var(--color-surface);
	}

	.who {
		margin: 0 0 0.25rem;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	.kind {
		color: var(--color-text);
		font-weight: bold;
	}

	.vote-head {
		display: none;
	}

	.votes li {
		margin-top: 0.75rem;
		padding: 1rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-l);
	}

	.votes .title {
		font-weight: bold;
	}

	.word {
		margin: 0.25rem 0;
		font-size: var(--font-size-page-title);
		font-weight: bold;
	}

	.reviewing {
		margin: 0.25rem 0 0;
		font-weight: bold;
	}

	.count {
		margin: 0;
		font-size: var(--font-size-sub);
	}

	.reference {
		color: var(--color-text-sub);
	}

	.if-world {
		overflow: hidden;
		border: 1px solid var(--color-if);
		border-radius: var(--radius-l);
	}

	.if-body {
		padding: 0 1rem 1rem;
	}

	.if-body h2 {
		margin-top: 1rem;
		border-bottom: none;
	}

	.to-law {
		margin: 0.5rem 0 0;
	}

	@media (min-width: 64rem) {
		.committee {
			margin-top: 0.5rem;
		}

		.jumps {
			display: block;
			margin-top: 2rem;
		}

		.jumps ul {
			display: grid;
			grid-template-columns: repeat(5, minmax(0, 1fr));
			gap: 0.5rem;
			margin: 0;
			padding: 0;
			list-style: none;
		}

		.jumps a {
			display: flex;
			align-items: center;
			justify-content: center;
			min-height: var(--tap-min);
			border: 1px solid var(--color-input-border);
			border-radius: var(--radius-m);
			color: var(--color-text);
			font-size: var(--font-size-sub);
			text-decoration: none;
		}

		.jumps a.if {
			border-color: var(--color-if);
			background: var(--color-if-bg);
			color: var(--color-if);
		}

		.issues li,
		.bills li {
			padding: 0.25rem 0;
		}

		.issues .meta {
			display: inline;
		}

		/* PC は1行に、法案・結果・数えた票・参考の票（PcReplay の表） */
		.vote-head,
		.votes li {
			display: grid;
			grid-template-columns: minmax(0, 2fr) 4rem minmax(0, 1.5fr) minmax(0, 1.5fr);
			gap: 1rem;
			align-items: baseline;
			margin: 0;
			padding: 0.75rem 0;
			border: none;
			border-bottom: 1px solid var(--color-divider);
			border-radius: 0;
		}

		.vote-head {
			padding-bottom: 0.5rem;
			border-bottom: 2px solid var(--color-text);
			color: var(--color-text-sub);
			font-size: var(--font-size-sub);
		}

		.votes .title {
			font-weight: normal;
		}

		/* 見出しの行があるので、各行の見出しは読み上げにだけ残す（.visually-hidden と同じ形） */
		.count .label {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}

		.word {
			margin: 0;
			font-size: var(--font-size-body);
		}

		.reviewing {
			grid-column: 2 / -1;
			margin: 0;
		}
	}
</style>
