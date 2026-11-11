<script lang="ts">
	import { ja, jaDate, jaDateTimeFull } from '#lib/copy/ja.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	/** 4つの記録は別々にページを送る。1つを送っても、ほかの位置を保つ */
	const hrefOf = (page: number, kakunin: number, shitsugi: number, ninsho = data.verifyPage, hirotta = data.hirottaPage) => {
		const params = new URLSearchParams();
		if (page > 1) params.set('page', String(page));
		if (kakunin > 1) params.set('kakunin', String(kakunin));
		if (shitsugi > 1) params.set('shitsugi', String(shitsugi));
		if (ninsho > 1) params.set('ninsho', String(ninsho));
		if (hirotta > 1) params.set('hirotta', String(hirotta));
		const query = params.toString();
		return query ? `/unei?${query}` : '/unei';
	};
	const pageHref = (page: number) => hrefOf(page, data.reviewPage, data.postPage);
	const reviewHref = (kakunin: number) => hrefOf(data.page, kakunin, data.postPage);
	const postHref = (shitsugi: number) => hrefOf(data.page, data.reviewPage, shitsugi);
	const verifyHref = (ninsho: number) => hrefOf(data.page, data.reviewPage, data.postPage, ninsho);
	const hirottaHref = (hirotta: number) => hrefOf(data.page, data.reviewPage, data.postPage, data.verifyPage, hirotta);
</script>

<svelte:head>
	<title>{ja.unei.pageTitle}</title>
</svelte:head>

<main>
	<h1>{ja.unei.heading}</h1>

	<h2>{ja.unei.criteriaHeading}</h2>
	<ul>
		{#each ja.unei.criteria as line (line)}<li>{line}</li>{/each}
	</ul>

	<h2>{ja.unei.logHeading}</h2>
	{#if data.rows.length === 0}
		<p>{ja.unei.empty}</p>
	{:else}
		<table>
			<thead>
				<tr>
					{#each Object.values(ja.unei.columns) as column (column)}<th scope="col">{column}</th>{/each}
				</tr>
			</thead>
			<tbody>
				{#each data.rows as row (row.id)}
					<tr>
						<td data-label={ja.unei.columns.at}>{jaDateTimeFull(row.createdAt)}</td>
						<!-- 解決策の行は「#[課題] の解決策」。リンクは課題のページへ（解決策の番号は出さない。設計書 docs/spec/36.md 決めたこと6） -->
						<td data-label={ja.unei.columns.issue}
							><a href="/kadai/{row.issueId}">#{row.issueId}</a>{#if row.solutionId !== null}{' '}{ja.unei.solutionOf}{/if}</td
						>
						<td data-label={ja.unei.columns.action}>{ja.unei.actions[row.action]}</td>
						<td data-label={ja.unei.columns.actor}>{ja.unei.actors[row.actor]}</td>
						<td data-label={ja.unei.columns.reason}
							>{#if row.action === 'merge' && row.mergedInto !== null}<a href="/kadai/{row.mergedInto}"
									>{ja.merge.logReason(row.mergedInto)}</a
								>{:else if row.reason}{ja.hideReasons[row.reason]}{/if}</td
						>
						<td data-label={ja.unei.columns.note} class="note">{row.note ?? ''}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}

	{#if data.page > 1 || data.hasNext}
		<nav class="pages">
			{#if data.page > 1}<a href={pageHref(data.page - 1)}>{ja.unei.prevPage}</a>{/if}
			{#if data.hasNext}<a href={pageHref(data.page + 1)}>{ja.unei.nextPage}</a>{/if}
		</nav>
	{/if}

	<h2>{ja.review.logHeading}</h2>
	<p>{ja.review.logCriteria}</p>
	{#if data.reviews.length === 0}
		<p>{ja.review.logEmpty}</p>
	{:else}
		<table>
			<thead>
				<tr>
					{#each Object.values(ja.review.logColumns) as column (column)}<th scope="col">{column}</th>{/each}
				</tr>
			</thead>
			<tbody>
				{#each data.reviews as row (`${row.billId}-${row.createdAt}`)}
					<tr>
						<td data-label={ja.review.logColumns.at}>{jaDateTimeFull(row.createdAt)}</td>
						<td data-label={ja.review.logColumns.bill}><a href="/houan/{row.billId}">{row.title}</a></td>
						<td data-label={ja.review.logColumns.kind}>{row.signals.map((s) => ja.review.signals[s]).join('、')}</td>
						<td data-label={ja.review.logColumns.status}>{ja.review.logStatus[row.status]}</td>
						<td data-label={ja.review.logColumns.decidedAt}>{row.decidedAt === null ? '' : jaDateTimeFull(row.decidedAt)}</td>
						<td data-label={ja.review.logColumns.actor}>{row.role ? ja.unei.actors[row.role] : ''}</td>
						<td data-label={ja.review.logColumns.note} class="note">{row.note ?? ''}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
	{#if data.reviewPage > 1 || data.reviewsHasNext}
		<nav class="pages" aria-label={ja.review.logPages}>
			{#if data.reviewPage > 1}<a href={reviewHref(data.reviewPage - 1)}>{ja.unei.prevPage}</a>{/if}
			{#if data.reviewsHasNext}<a href={reviewHref(data.reviewPage + 1)}>{ja.unei.nextPage}</a>{/if}
		</nav>
	{/if}

	<section aria-labelledby="post-log-heading">
		<h2 id="post-log-heading">{ja.unei.postLogHeading}</h2>
		{#if data.postLogs.length === 0}
			<p>{ja.unei.empty}</p>
		{:else}
			<table>
				<thead>
					<tr>
						{#each Object.values(ja.unei.postColumns) as column (column)}<th scope="col">{column}</th>{/each}
					</tr>
				</thead>
				<tbody>
					{#each data.postLogs as row (row.id)}
						<tr>
							<td data-label={ja.unei.postColumns.at}>{jaDateTimeFull(row.createdAt)}</td>
							<td data-label={ja.unei.postColumns.bill}><a href={row.kind === 'commentary' ? `/houan/${row.billId}` : `/houan/${row.billId}/${row.kind === 'amendment' ? 'shusei' : 'shitsugi'}`}>{row.title}</a></td>
							<td data-label={ja.unei.postColumns.kind}>{ja.unei.logKinds[row.kind]}</td>
							<td data-label={ja.unei.postColumns.action}>{ja.unei.actions[row.action]}</td>
							<td data-label={ja.unei.postColumns.actor}>{ja.unei.actors[row.actor]}</td>
							<td data-label={ja.unei.postColumns.reason}>{#if row.reason}{ja.hideReasons[row.reason]}{/if}</td>
							<td data-label={ja.unei.postColumns.note} class="note">{row.note ?? ''}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
		{#if data.postPage > 1 || data.postLogsHasNext}
			<nav class="pages" aria-label={ja.unei.postLogPages}>
				{#if data.postPage > 1}<a href={postHref(data.postPage - 1)}>{ja.unei.prevPage}</a>{/if}
				{#if data.postLogsHasNext}<a href={postHref(data.postPage + 1)}>{ja.unei.nextPage}</a>{/if}
			</nav>
		{/if}
	</section>

	<!-- 議員・有識者の認証の記録（設計書 docs/spec/157.md の 4）。だれが操作したかは出さない -->
	<section aria-labelledby="verify-log-heading">
		<h2 id="verify-log-heading">{ja.verification.logHeading}</h2>
		{#if data.verifyLogs.length === 0}
			<p>{ja.verification.logEmpty}</p>
		{:else}
			<ul class="verify-log">
				{#each data.verifyLogs as row (row.id)}
					<li>{ja.verification.logLine(row.kind, row.action, row.name, row.field, row.date)}</li>
				{/each}
			</ul>
		{/if}
		{#if data.verifyPage > 1 || data.verifyLogsHasNext}
			<nav class="pages" aria-label={ja.verification.logHeading}>
				{#if data.verifyPage > 1}<a href={verifyHref(data.verifyPage - 1)}>{ja.verification.logPrev}</a>{/if}
				{#if data.verifyLogsHasNext}<a href={verifyHref(data.verifyPage + 1)}>{ja.verification.logNext}</a>{/if}
			</nav>
		{/if}
	</section>

	<!-- 議員の反応の記録（Issue #150）。課題が非表示なら題名を出さない -->
	<section aria-labelledby="hirotta-log-heading">
		<h2 id="hirotta-log-heading">{ja.hirotta.logHeading}</h2>
		{#if data.hirottaLogs.length === 0}
			<p>{ja.hirotta.logEmpty}</p>
		{:else}
			<ul class="verify-log">
				{#each data.hirottaLogs as row (row.id)}
					<li>{ja.hirotta.logActions[`${row.kind}:${row.action}`]}・{row.name}・{#if row.title !== null}<a href="/kadai/{row.issueId}">{row.title}</a>{:else}{ja.hirotta.hiddenTitle}{/if}・{jaDate(row.date)}</li>
				{/each}
			</ul>
		{/if}
		{#if data.hirottaPage > 1 || data.hirottaLogsHasNext}
			<nav class="pages" aria-label={ja.hirotta.logHeading}>
				{#if data.hirottaPage > 1}<a href={hirottaHref(data.hirottaPage - 1)}>{ja.hirotta.logPrev}</a>{/if}
				{#if data.hirottaLogsHasNext}<a href={hirottaHref(data.hirottaPage + 1)}>{ja.hirotta.logNext}</a>{/if}
			</nav>
		{/if}
	</section>
</main>

<style>
	main {
		max-width: 72rem;
		margin: 0 auto;
		padding: 1rem;
	}

	h1 {
		font-size: var(--font-size-page-title);
	}

	h2 {
		font-size: var(--font-size-heading);
		margin-top: 1.5rem;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--font-size-sub);
	}

	th {
		color: var(--color-text-sub);
		font-weight: normal;
		text-align: left;
		border-bottom: 2px solid var(--color-text);
		padding: 0.5rem;
	}

	td {
		border-bottom: 1px solid var(--color-divider);
		padding: 0.5rem;
		vertical-align: top;
	}

	.note {
		white-space: pre-wrap;
	}

	.pages {
		display: flex;
		justify-content: space-between;
		margin-top: 1rem;
	}

	.pages a {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap-min);
	}

	/* スマホは表を縦に積む */
	@media (max-width: 40rem) {
		thead {
			display: none;
		}

		tr {
			display: block;
			border-bottom: 1px solid var(--color-divider);
			padding: 0.5rem 0;
		}

		td {
			display: block;
			border: none;
			padding: 0.125rem 0;
		}

		/* 見出しの代わりに、セルの前にラベルを出す。空のセルは出さない */
		td::before {
			content: attr(data-label) '：';
			color: var(--color-text-sub);
		}

		td:empty {
			display: none;
		}
	}
</style>
