<script lang="ts">
	// 統計ページ（Issue #154）。会期の選択は JavaScript がなくても動く GET のフォーム。人数と「考えが変わった」の数は出さない
	import { ja } from '#lib/copy/ja.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const t = ja.toukei;
</script>

<svelte:head>
	<title>{t.pageTitle}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="frame">
	<h1>{t.heading}</h1>
	<p class="lead">{t.lead}</p>

	{#if data.session === null}
		<p class="empty">{t.noSessions}</p>
	{:else}
		{#if data.options.length}
			<form method="get" class="choose">
				<label for="toukei-session">{t.sessionLabel}</label>
				<select id="toukei-session" name="kaiki">
					{#each data.options as key (key)}<option value={key} selected={key === data.session}>{t.session(key)}</option>{/each}
					{#if !data.options.includes(data.session)}<option value={data.session} selected>{t.session(data.session)}</option>{/if}
				</select>
				<button>{t.show}</button>
			</form>
		{/if}

		<section aria-labelledby="toukei-results">
			<h2 id="toukei-results">{t.resultsHeading(t.session(data.session))}</h2>
			<p class="replay"><a href="/kaiki/{data.session}">{t.replayLink}</a></p>
			{#if data.results?.length}
				<div class="scroll">
					<table>
						<thead>
							<tr>
								<th scope="col">{t.columns.title}</th>
								<th scope="col">{t.columns.outcome}</th>
								<th scope="col">{t.columns.yes}</th>
								<th scope="col">{t.columns.no}</th>
								<th scope="col">{t.columns.abstain}</th>
							</tr>
						</thead>
						<tbody>
							{#each data.results as r (r.billId)}
								<tr>
									<td class="title"><a href="/saiketsu/{r.billId}/kekka">{r.title}</a></td>
									{#if r.state === 'reviewing'}
										<td colspan="4">{t.reviewing}</td>
									{:else}
										<td>{t.outcomes[r.state]}</td>
										<td class="num">{r.yes}</td>
										<td class="num">{r.no}</td>
										<td class="num">{r.abstain}</td>
									{/if}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{:else}
				<p class="empty">{t.noBills}</p>
			{/if}
		</section>

		<section aria-labelledby="toukei-bridge">
			<h2 id="toukei-bridge">{t.bridgeHeading}</h2>
			<p class="lead">{t.bridgeNote}</p>
			{#if data.bridges?.length}
				<ol>
					{#each data.bridges as b (b.billId)}
						<li><a href="/saiketsu/{b.billId}/kekka">{b.title}</a><span class="ratio">{t.bridgeRatio(b.ratio)}</span></li>
					{/each}
				</ol>
			{:else}
				<p class="empty">{data.results?.length ? t.bridgeNone : t.noBills}</p>
			{/if}
		</section>

		<section aria-labelledby="toukei-changed">
			<h2 id="toukei-changed">{t.changedHeading}</h2>
			<p class="lead">{t.changedNote}</p>
			{#if data.rethink?.length}
				<ol>
					{#each data.rethink as c (c.postId)}
						<li>
							<span class="kind">{t.changedKinds[c.kind]}</span>
							<a href="/houan/{c.billId}/shitsugi#shitsugi-{c.questionId}">{c.excerpt}</a>
							<span class="bill">{c.billTitle}</span>
						</li>
					{/each}
				</ol>
			{:else}
				<p class="empty">{data.results?.length ? t.changedNone : t.noBills}</p>
			{/if}
		</section>
	{/if}
</main>

<style>
	main {
		padding: 1rem;
	}

	h1 {
		font-size: var(--font-size-page-title);
	}

	h2 {
		margin-top: 2rem;
		font-size: var(--font-size-heading);
	}

	.lead,
	.empty,
	.bill {
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	.choose {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}

	select,
	button {
		min-height: var(--tap-min);
		padding: 0 0.75rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-m);
		background: var(--color-bg);
		color: var(--color-text);
		font: inherit;
	}

	select {
		max-width: 100%;
	}

	.scroll {
		overflow-x: auto;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--font-size-sub);
	}

	th,
	td {
		padding: 0.5rem 0.25rem;
		border-bottom: 1px solid var(--color-divider);
		text-align: left;
	}

	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	td.title {
		min-width: 10em;
	}

	ol {
		margin: 0.5rem 0 0;
		padding-left: 1.5rem;
	}

	li {
		padding: 0.5rem 0;
		border-bottom: 1px solid var(--color-divider);
		overflow-wrap: anywhere;
	}

	li a,
	.replay a {
		color: var(--color-link);
	}

	.ratio {
		display: block;
		font-weight: bold;
	}

	.kind {
		display: inline-block;
		margin-right: 0.5rem;
		font-size: var(--font-size-sub);
		font-weight: bold;
	}

	.bill {
		display: block;
	}
</style>
