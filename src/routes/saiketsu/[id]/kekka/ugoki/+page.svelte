<script lang="ts">
	// 会期中の考えの動き（Issue #87）。週ごとの横の帯（動かない図）と、同じ値の表。図は色だけに頼らず各部分に文字を付け、読み上げは表に任せる
	import Crumbs from '#lib/components/Crumbs.svelte';
	import { ja } from '#lib/copy/ja.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const m = ja.result.motion;
	const STANCES = ['for', 'undecided', 'against'] as const;
</script>

<svelte:head>
	<title>{m.pageTitle(data.bill.title)}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="frame">
	<Crumbs current={m.crumb} keepOnSp />
	<h1>{data.bill.title}</h1>

	{#if data.phase === 'withdrawn'}
		<p class="waiting">{ja.bill.withdraw.result}</p>
	{:else if data.phase === 'before'}
		<p class="waiting">{ja.result.before}</p>
		<p class="deadline">{ja.vote.deadline(data.session)}</p>
	{:else if data.phase === 'counting'}
		<p class="waiting">{ja.result.counting}</p>
	{:else if data.phase === 'reviewing'}
		<p class="waiting">{ja.review.reviewing}</p>
	{:else if data.phase === 'voided'}
		<p class="waiting">{m.voided}</p>
	{:else}
		<section aria-labelledby="motion-heading">
			<h2 id="motion-heading">{m.heading}</h2>
			<p class="lead">{m.lead}</p>
			{#if data.motion}
				<div class="chart" data-motion-chart aria-hidden="true">
					{#each data.motion as row (row.week)}
						<div class="week">
							<span class="label">{m.week(row.week)}</span>
							<!-- 部分の文字は帯の下に並べる（狭い部分でも切れないように）。印は帯の部分と同じ塗り -->
							<div data-motion-week>
								<div class="bar">
									{#each STANCES as stance (stance)}
										{#if row[stance]}<span class={stance} style:flex-grow={row[stance]}></span>{/if}
									{/each}
								</div>
								<p class="parts">
									{#each STANCES as stance (stance)}
										{#if row[stance]}<span class="part"><span class="mark {stance}"></span>{m.part(m.stances[stance], row[stance])}</span>{/if}
									{/each}
								</p>
							</div>
						</div>
					{/each}
				</div>
				<div class="scroll">
					<table>
						<thead>
							<tr>
								<th scope="col">{m.corner}</th>
								{#each STANCES as stance (stance)}<th scope="col">{m.stances[stance]}</th>{/each}
							</tr>
						</thead>
						<tbody>
							{#each data.motion as row (row.week)}
								<tr>
									<th scope="row">{m.week(row.week)}</th>
									{#each STANCES as stance (stance)}<td>{ja.result.percent(row[stance])}</td>{/each}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{:else}
				<p>{m.none}</p>
			{/if}
		</section>
	{/if}

	<ul class="links">
		<li><a href="/saiketsu/{data.bill.id}/kekka">{m.resultLink}</a></li>
		<li><a href="/houan/{data.bill.id}">{ja.result.billLink}</a></li>
	</ul>
</main>

<style>
	main {
		padding: 1rem;
	}

	h1 {
		margin: 0 0 1rem;
		font-size: var(--font-size-page-title);
	}

	h2 {
		font-size: var(--font-size-heading);
	}

	.waiting {
		font-weight: bold;
	}

	.lead,
	.deadline {
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	.chart {
		display: grid;
		gap: 0.75rem;
		margin: 1rem 0;
	}

	.week {
		display: grid;
		grid-template-columns: 4em 1fr;
		gap: 0.5rem;
		align-items: start;
	}

	.label {
		font-size: var(--font-size-sub);
	}

	.bar {
		display: flex;
		height: 1.5rem;
		overflow: hidden;
		border: 1px solid var(--color-text);
		border-radius: var(--radius-s);
	}

	.bar span {
		flex-basis: 0;
	}

	/* 部分のあいだに線を引き、未定の面（地に近い色）も区切りが分かるようにする */
	.bar span + span {
		border-left: 1px solid var(--color-text);
	}

	.for {
		background: var(--color-support);
	}

	/* 反対寄りは結果のページの反対と同じ斜線 */
	.against {
		background-image: repeating-linear-gradient(135deg, var(--color-oppose) 0 6px, var(--color-del-text) 6px 12px);
	}

	.undecided {
		background: var(--color-surface);
	}

	.parts {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1rem;
		margin: 0.25rem 0 0;
		font-size: var(--font-size-sub);
		font-weight: bold;
	}

	.part {
		display: inline-flex;
		gap: 0.25rem;
		align-items: center;
		white-space: nowrap;
	}

	.mark {
		display: inline-block;
		width: 0.75rem;
		height: 0.75rem;
		border: 1px solid var(--color-text);
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
		text-align: right;
	}

	th[scope='row'],
	thead th:first-child {
		text-align: left;
	}

	.links {
		margin: 1.5rem 0 0;
		padding: 0;
		list-style: none;
	}

	.links li {
		border-top: 1px solid var(--color-divider);
	}

	.links a {
		display: flex;
		align-items: center;
		min-height: var(--tap-min);
		color: var(--color-link);
	}
</style>
