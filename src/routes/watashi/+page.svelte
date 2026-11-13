<script lang="ts">
	// わたしの記録：議員としてのキャラクターシート（Issue #171。SpRecord・PcRecord）。
	// スマホは1列（カード → 法案 → 修正案 → 立候補 → リンク）、PC は左にカードとリンク、右に法案・修正案・立候補
	import { ja } from '#lib/copy/ja.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const c = $derived(data.candidacy);
	const stepText = (key: 'post' | 'consecutive' | 'period') => (key === 'period' ? ja.watashi.candidacy.steps.period(c.session) : ja.watashi.candidacy.steps[key]);
	const canStand = $derived(!c.staff && c.steps.every((s) => s.done));
</script>

<svelte:head>
	<title>{ja.watashi.pageTitle}</title>
</svelte:head>

<main class="frame">
	<h1>{ja.watashi.heading}</h1>

	<section class="card" data-profile aria-label={ja.watashi.onlyYou}>
		<p class="only">{ja.watashi.onlyYou}</p>
		<p class="name">{data.name}</p>
		<dl>
			<dt>{ja.watashi.membership}</dt>
			<dd class="strong" data-membership>{data.committee === null ? ja.watashi.notMember : ja.watashi.committee(data.committee)}</dd>
			<dt>{ja.watashi.role}</dt>
			<dd class="strong" data-role>
				{data.role ? ja.watashi.roleIn(ja.watashi.roles[data.role.role], data.role.sessionKey, data.role.recalled) : ja.watashi.noRole}
			</dd>
			<dt>{ja.watashi.registered}</dt>
			<dd>{ja.watashi.registeredMonth(data.registeredAt)}</dd>
		</dl>
		{#if data.committee === null}<p class="sub">{ja.watashi.memberHelp}</p>{/if}
	</section>

	<div class="records">
		<section aria-labelledby="watashi-bills">
			<h2 id="watashi-bills">{ja.watashi.bills.heading}</h2>
			{#if data.bills.rows.length}
				<!-- スマホは CSS で display を変えるので、表として読めるように role を明示する（冗長ではない） -->
				<!-- svelte-ignore a11y_no_redundant_roles -->
				<table role="table">
					<!-- svelte-ignore a11y_no_redundant_roles -->
					<thead role="rowgroup">
						<!-- svelte-ignore a11y_no_redundant_roles -->
						<tr role="row">
							<th role="columnheader">{ja.watashi.bills.bill}</th>
							<th role="columnheader">{ja.watashi.bills.role}</th>
							<th role="columnheader">{ja.watashi.bills.now}</th>
						</tr>
					</thead>
					<!-- svelte-ignore a11y_no_redundant_roles -->
					<tbody role="rowgroup">
						{#each data.bills.rows as bill (bill.id)}
							<!-- svelte-ignore a11y_no_redundant_roles -->
							<tr role="row">
								<td role="cell" class="title"><a href="/houan/{bill.id}">{bill.title}</a></td>
								<td role="cell" class="meta">{ja.watashi.bills.roles[bill.role]}</td>
								<td role="cell" class="meta">
									<span class="separator" aria-hidden="true">{ja.watashi.bills.separator}</span><span class:strong={bill.stage === 'passed' || bill.stage === 'rejected'}
										>{ja.watashi.bills.stage(ja.bill.list.stages[bill.stage], bill.session)}</span
									>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
				{#if data.bills.more}<p class="sub">{ja.watashi.bills.more(data.bills.rows.length)}</p>{/if}
			{:else}
				<p class="empty">{ja.watashi.bills.empty}</p>
			{/if}
		</section>

		<section aria-labelledby="watashi-amendments">
			<h2 id="watashi-amendments">{ja.watashi.amendments.heading}</h2>
			{#if data.amendments.length}
				<ul class="amendments">
					{#each data.amendments as a (a.id)}
						<li>
							<a href="/houan/{a.billId}/shusei">{a.billTitle}</a>
							<span class="meta">{ja.watashi.amendments.meta(a.lawTitle, a.location, ja.amendment.statuses[a.status])}</span>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="empty">{ja.watashi.amendments.empty}</p>
			{/if}
		</section>

		<section aria-labelledby="watashi-candidacy">
			<h2 id="watashi-candidacy">{ja.watashi.candidacy.heading}</h2>
			{#if c.staff}
				<p class="sub">{ja.watashi.candidacy.staff}</p>
			{:else}
				<p class="sub">{ja.watashi.candidacy.lead(c.next, c.session, c.end)}</p>
				<ul class="steps">
					{#each c.steps as step (step.key)}
						<li>
							<span class="mark" class:done={step.done}>{step.done ? ja.watashi.candidacy.done : ja.watashi.candidacy.notYet}</span>
							<span>{stepText(step.key)}</span>
						</li>
					{/each}
				</ul>
				{#if c.closed}<p class="sub">{ja.watashi.candidacy.closed}</p>{/if}
				{#if canStand}<p><a href="/iinkai">{ja.watashi.candidacy.link}</a></p>{/if}
			{/if}
			<p class="sub note">{ja.watashi.note}</p>
		</section>
	</div>

	<nav class="links" aria-label={ja.watashi.heading}>
		<a href="/tsuchi" data-sveltekit-preload-data="off">{ja.notifications.entry(data.unread)}</a>
		<!-- スマホの下のタブに「データ」がないので、ここから行く（Issue #154） -->
		<a href="/toukei">{ja.menu.tabs.toukei}</a>
		<form method="post" action="/logout">
			<button>{ja.watashi.logout}</button>
		</form>
	</nav>
</main>

<style>
	main {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		grid-template-areas: 'title' 'card' 'records' 'links';
		row-gap: 1.5rem;
		padding-top: 1rem;
		padding-bottom: 2rem;
	}

	h1 {
		grid-area: title;
		margin: 0;
		font-size: var(--font-size-page-title);
	}

	h2 {
		margin: 0;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid var(--color-divider);
		font-size: var(--font-size-heading);
	}

	.card {
		grid-area: card;
		align-self: start;
		padding: 1rem;
		border: 2px solid var(--color-base);
		border-radius: var(--radius-l);
	}

	.only,
	.sub,
	.meta,
	.empty {
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	.only {
		margin: 0;
	}

	.name {
		margin: 0.5rem 0;
		font-size: var(--font-size-page-title);
		font-weight: bold;
		overflow-wrap: anywhere;
	}

	dl {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 0.5rem 1rem;
		margin: 0;
	}

	dt {
		color: var(--color-text-sub);
	}

	dd {
		margin: 0;
	}

	.strong {
		font-weight: bold;
	}

	.records {
		grid-area: records;
		display: grid;
		row-gap: 2rem;
	}

	/* スマホ：表を行のカードの並びにする */
	table,
	tbody,
	tr,
	td {
		display: block;
	}

	table {
		width: 100%;
		border-collapse: collapse;
	}

	thead {
		display: none;
	}

	tr {
		padding: 0.75rem 0;
		border-bottom: 1px solid var(--color-divider);
	}

	td {
		padding: 0;
	}

	td.meta {
		display: inline;
	}

	.title a,
	.amendments a {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap-min);
		font-weight: bold;
	}

	.title a {
		color: var(--color-text);
		text-decoration: none;
	}

	.amendments,
	.steps {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.amendments li {
		padding: 0.5rem 0;
		border-bottom: 1px solid var(--color-divider);
	}

	.amendments .meta {
		display: block;
	}

	.steps li {
		display: flex;
		gap: 0.75rem;
		align-items: flex-start;
		margin-top: 0.5rem;
	}

	/* 済みは実線、まだは点線の枠。色だけで分けず、文字でも出す */
	.mark {
		flex: none;
		min-width: 4rem;
		padding: 0 0.5rem;
		border: 1px dashed var(--color-input-border);
		border-radius: var(--radius-s);
		color: var(--color-text-sub);
		font-size: var(--font-size-min);
		text-align: center;
	}

	.mark.done {
		border: 1px solid var(--color-text);
		color: var(--color-text);
		font-weight: bold;
	}

	.note {
		margin-top: 1.5rem;
	}

	.empty {
		margin: 0.75rem 0 0;
	}

	.links {
		grid-area: links;
		display: flex;
		flex-wrap: wrap;
		gap: 0 1.5rem;
		align-items: center;
	}

	.links a {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap-min);
	}

	.links form {
		margin: 0;
	}

	button {
		min-height: var(--tap-min);
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-m);
		background: var(--color-bg);
		color: var(--color-text);
		font: inherit;
		padding: 0 1rem;
	}

	@media (min-width: 64rem) {
		main {
			grid-template-columns: 22rem minmax(0, 1fr);
			grid-template-rows: auto auto 1fr;
			grid-template-areas: 'title title' 'card records' 'links records';
			column-gap: 2rem;
			padding-top: 1.5rem;
		}

		.links {
			flex-direction: column;
			align-items: flex-start;
			align-self: start;
		}

		table {
			display: table;
		}

		thead {
			display: table-header-group;
		}

		tbody {
			display: table-row-group;
		}

		tr {
			display: table-row;
			padding: 0;
		}

		th,
		td,
		td.meta {
			display: table-cell;
			padding: 0.5rem 0.5rem 0.5rem 0;
			border-bottom: 1px solid var(--color-divider);
			text-align: left;
			vertical-align: middle;
		}

		th {
			border-bottom: 2px solid var(--color-text);
			color: var(--color-text-sub);
			font-size: var(--font-size-sub);
			font-weight: normal;
		}

		td.meta {
			color: var(--color-text);
			font-size: var(--font-size-body);
		}

		.separator {
			display: none;
		}

		.title a {
			color: var(--color-link);
			font-weight: normal;
			text-decoration: underline;
		}

		.amendments a {
			font-weight: normal;
		}

		.amendments .meta {
			display: inline;
			margin-left: 0.5rem;
		}
	}
</style>
