<script lang="ts">
	// 法案のページの概要（SpBillSummary・PcBillSummary）
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { ja } from '#lib/copy/ja.ts';
	import { BILL_PROGRESS_STEP } from '#lib/domain/bills.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const bill = $derived(data.bill);
	const support = $derived(data.support);
	const message = $derived(form && 'message' in form ? form.message : undefined);
	/** 発議にあと何人か（提出者が下書きを見るとき） */
	const remaining = $derived(support.required === null ? null : Math.max(0, support.required - support.count));
	/** いまの段の位置 */
	const current = $derived(BILL_PROGRESS_STEP[data.progress]);
	/** 段の名前：次の段には日付を出し、廃案のときは最後の段「結果」を「廃案」にする（docs/spec/50.md 決めたこと6） */
	const stageName = (name: string, i: number) => {
		const next = data.next;
		if (next && i === BILL_PROGRESS_STEP[next.stage]) return ja.bill.page.stageFrom(name, next.session, next.at);
		return data.progress === 'lapsed' && i === BILL_PROGRESS_STEP.lapsed ? ja.bill.progress.lapsed : name;
	};
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
						<span class="dot" aria-hidden="true"></span>{stageName(stage, i)}{#if i === current}{ja.bill.page.here}{/if}
					</li>
				{/each}
			</ol>
		</section>
		<div class="people">
			<p class="author">{ja.bill.page.author(bill.author)}</p>
			{#if data.coDrafters.length}<p class="author">{ja.bill.page.coDrafters(data.coDrafters)}</p>{/if}
			<span class="sep" aria-hidden="true">{ja.bill.support.separator}</span>
			<p class="supports">{ja.bill.support.count(support.count)}</p>
		</div>
		<!-- 賛同と発議（docs/spec/49.md 決めたこと7） -->
		{#if remaining !== null}
			<form method="post" action="?/propose" use:enhance class="act">
				<button class="primary" disabled={remaining > 0}>{ja.bill.support.propose}</button>
				{#if remaining > 0}<p class="note">{ja.bill.support.remaining(remaining)}</p>{/if}
			</form>
		{:else if support.open}
			{#if support.waitUntil !== null}
				<p class="note">{ja.bill.support.tooNew(support.waitUntil)}</p>
			{:else if !support.loggedIn}
				<!-- ログインしていなければ、押すとログインの画面へ（JS がなくても動く） -->
				<form method="get" action="/login" class="act">
					<input type="hidden" name="next" value={page.url.pathname} />
					<button class="primary">{ja.bill.support.add}</button>
				</form>
			{:else}
				<form method="post" action="?/support" use:enhance={() => async ({ update }) => update({ reset: false })} class="act">
					<input type="hidden" name="op" value={support.mine ? 'remove' : 'add'} />
					<input type="hidden" name="rev" value={support.rev} />
					<button class={support.mine ? '' : 'primary'}>{support.mine ? ja.bill.support.remove : ja.bill.support.add}</button>
				</form>
			{/if}
		{/if}
		{#if message}<p role="alert" class="alert">{message}</p>{/if}
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

	/* スマホは「提出者 … ・ 賛同 N人」の1行（SpBillSummary）、PC は2行（PcBillSummary） */
	.people {
		display: flex;
		flex-wrap: wrap;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	.sep {
		white-space: pre-wrap;
	}

	.author,
	.supports {
		margin: 0;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	.act {
		display: grid;
		gap: 0.5rem;
		margin-top: 1rem;
	}

	.act button {
		min-height: var(--tap-primary);
		padding: 0 1.25rem;
		border: 1px solid var(--color-base);
		border-radius: var(--radius-m);
		background: var(--color-bg);
		color: var(--color-base);
		font: inherit;
		font-weight: bold;
	}

	.act .primary {
		background: var(--color-base);
		color: var(--color-bg);
	}

	.act button:disabled {
		opacity: 0.5;
	}

	.note {
		margin: 0.5rem 0 0;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	.alert {
		margin: 0.5rem 0 0;
		color: var(--color-caution);
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

		.people {
			display: block;
		}

		.sep {
			display: none;
		}
	}
</style>
