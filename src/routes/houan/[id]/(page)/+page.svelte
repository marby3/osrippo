<script lang="ts">
	// 法案のページの概要（SpBillSummary・PcBillSummary）
	import { ja } from '#lib/copy/ja.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const bill = $derived(data.bill);
	/** いまの段の位置（v0.3 の下書きは最初の段。発議から先の段は #50） */
	const current = $derived(bill.status === 'draft' ? 0 : 1);
</script>

<svelte:head>
	<title>{ja.bill.page.pageTitle(bill.title)}</title>
</svelte:head>

<div class="layout">
	<div class="content">
		{#if bill.summary.length}
			<section class="summary">
				<h2>{ja.bill.page.summaryHeading}</h2>
				<ol>
					{#each bill.summary as line, i (i)}<li>{line}</li>{/each}
				</ol>
			</section>
		{/if}
		<div class="pair">
			<section>
				<h2 class="label">{ja.bill.page.affected}</h2>
				<p class="text">{bill.affected}</p>
			</section>
			<section>
				<h2 class="label">{ja.bill.page.sideEffects}</h2>
				<p class="text">{bill.sideEffects}</p>
			</section>
		</div>
		<section class="cited">
			<h2 class="label">{ja.bill.page.solutions}</h2>
			<ul>
				{#each bill.solutions as s (s.id)}
					<li>
						{#if s.body === null}
							<p class="hidden">{ja.bill.page.hiddenSolution}</p>
						{:else}
							<p class="text">{s.body}</p>
							{#if s.issue}<a href="/kadai/{s.issue.id}">{s.issue.title}</a>{/if}
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	</div>

	<aside>
		<section class="stages pc">
			<h2>{ja.bill.page.stagesHeading}</h2>
			<ol>
				{#each ja.bill.page.stages as stage, i (stage)}
					<li class:done={i < current} class:current={i === current}>
						<span class="dot" aria-hidden="true"></span>{stage}{#if i === current}{ja.bill.page.here}{/if}
					</li>
				{/each}
			</ol>
		</section>
		<p class="author">{ja.bill.page.author(bill.author)}</p>
	</aside>
</div>

<style>
	.layout {
		display: grid;
		gap: 1.5rem;
		margin-top: 1.5rem;
	}

	h2 {
		margin: 0;
		font-size: var(--font-size-body);
	}

	.summary {
		padding: 1rem 1.5rem;
		border-radius: var(--radius-l);
		background: var(--color-surface);
	}

	.summary ol {
		margin: 0.5rem 0 0;
		padding-left: 1.25rem;
	}

	.pair {
		display: grid;
		gap: 1rem;
		margin-top: 1.5rem;
	}

	.label {
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	.text {
		margin: 0.25rem 0 0;
		white-space: pre-line;
	}

	.cited {
		margin-top: 1.5rem;
	}

	.cited ul {
		display: grid;
		gap: 0.75rem;
		margin: 0.5rem 0 0;
		padding: 0;
		list-style: none;
	}

	.cited li {
		padding: 0.75rem 1rem;
		border-radius: var(--radius-l);
		background: var(--color-surface);
	}

	.hidden {
		margin: 0;
		color: var(--color-text-sub);
	}

	.author {
		margin: 0;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	.stages ol {
		margin: 0.5rem 0 1.5rem;
		padding: 0;
		list-style: none;
	}

	.stages li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 2rem;
		color: var(--color-text-sub);
	}

	.dot {
		width: 0.75rem;
		height: 0.75rem;
		border: 2px solid var(--color-text-sub);
		border-radius: var(--radius-pill);
	}

	.stages li.done .dot {
		border-color: var(--color-base);
		background: var(--color-base);
	}

	.stages li.current {
		color: var(--color-text);
		font-weight: bold;
	}

	.stages li.current .dot {
		border-color: var(--color-base);
		background: var(--color-base);
		box-shadow: 0 0 0 2px var(--color-bg), 0 0 0 4px var(--color-base);
	}

	.pc {
		display: none;
	}

	@media (min-width: 64rem) {
		.layout {
			grid-template-columns: minmax(0, 1fr) 18rem;
			column-gap: 3rem;
		}

		.pair {
			grid-template-columns: 1fr 1fr;
			column-gap: 2rem;
		}

		.pc {
			display: block;
		}
	}
</style>
