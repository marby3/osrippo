<script lang="ts">
	// 投票の画面（SpVote・PcVote）。変更点の一覧はスマホでは閉じ、PC では開いている。票の欄は PC では右に置く。
	// 棄権は一覧を開くまで選べない。この決まりは画面だけで守る（Issue #70 確認の点）
	import Crumbs from '#lib/components/Crumbs.svelte';
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import DiffText from '#lib/components/DiffText.svelte';
	import Turnstile from '#lib/components/Turnstile.svelte';
	import VoteStanding from '#lib/components/VoteStanding.svelte';
	import { ja } from '#lib/copy/ja.ts';
	import { VOTE_CHOICES, type VoteChoice } from '#lib/domain/votes.ts';
	import type { ActionData, PageData } from './$types';

	/** 法案が変わると作り直す（+page.svelte の key） */
	let { data, form }: { data: PageData; form: ActionData } = $props();
	const bill = $derived(data.bill);
	const message = $derived(form && 'message' in form ? form.message : undefined);

	// svelte-ignore state_referenced_locally
	let selected = $state<VoteChoice | null>(data.mine);
	/** 選び直して未保存のあいだは出さない */
	const voted = $derived(Boolean(form && 'voted' in form) && selected === data.mine);
	let token = $state('');
	let turnstile: ReturnType<typeof Turnstile> | undefined = $state();
	/** スマホで一覧を開いているか */
	let expanded = $state(false);
	/** 一度でも一覧を見たか。PC は最初から開いている */
	let seen = $state(false);
	const mayAbstain = $derived(seen || data.mine === 'abstain');

	onMount(() => {
		const wide = matchMedia('(min-width: 64rem)');
		const sync = () => {
			if (wide.matches) seen = true;
		};
		sync();
		wide.addEventListener('change', sync);
		return () => wide.removeEventListener('change', sync);
	});
</script>

<main class="frame">
	<Crumbs current={data.position === null ? ja.vote.otherHeading : ja.vote.position(data.position, data.total)} keepOnSp />
	<h1>{bill.title}</h1>

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

			{#if data.hasPriorAmendment}
				<p class="notice">{ja.vote.amendmentNotice} <a href="/houan/{bill.id}/shusei">{ja.vote.amendmentLink}</a></p>
			{/if}

			<section class="changes">
				<button
					type="button"
					class="opener"
					aria-expanded={expanded}
					aria-controls="vote-changes"
					onclick={() => {
						expanded = !expanded;
						seen = true;
					}}
				>
					<span>{ja.vote.changesCount(bill.changeCount)}{ja.vote.changesOpen}</span>
					<svg class="chevron" class:up={expanded} viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" /></svg>
				</button>
				<h2 class="wide">{ja.vote.changesCount(bill.changeCount)}</h2>
				<div id="vote-changes" class="list" class:expanded>
					{#each bill.repealed as title (title)}
						<p class="row">{ja.bill.page.repeal(title)}</p>
					{/each}
					{#each data.changes as change, i (i)}
						{@const parts = change.after ?? change.before}
						<div class="row">
							<h3>
								{change.op === 'supplementary'
									? ja.bill.page.changeHeading(null, ja.bill.page.supplementary, ja.bill.ops.supplementary)
									: ja.bill.page.changeHeading(null, change.location, ja.bill.ops[change.op])}
							</h3>
							{#if parts}<DiffText {parts} />{/if}
						</div>
					{/each}
				</div>
			</section>

			<p class="read"><a href="/houan/{bill.id}/shitsugi">{ja.vote.readQuestions}</a></p>
		</div>

		<section class="ballot" aria-labelledby="your-vote">
			<h2 id="your-vote">{ja.vote.yourVote}</h2>
			<div class="standing"><VoteStanding eligible={data.eligible} total={data.total} done={data.done} /></div>
			<form
				method="post"
				action="?/vote"
				use:enhance={() =>
					async ({ update }) => {
						await update({ reset: false });
						turnstile?.reset();
					}}
			>
				<div class="choices" role="radiogroup" aria-labelledby="your-vote">
					{#each VOTE_CHOICES as choice (choice)}
						<label class:off={choice === 'abstain' && !mayAbstain}>
							<input type="radio" name="choice" value={choice} bind:group={selected} disabled={choice === 'abstain' && !mayAbstain} />
							{ja.vote.choices[choice]}
						</label>
					{/each}
				</div>
				{#if !mayAbstain}<p class="hint">{ja.vote.abstainHint}</p>{/if}
				<p class="secret">
					<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z" fill="none" stroke="currentColor" stroke-width="2" /></svg>
					{ja.vote.secret}
				</p>
				<Turnstile siteKey={data.siteKey} bind:token bind:this={turnstile} />
				{#if message}<p role="alert" class="error">{message}</p>{/if}
				{#if voted}
					<p role="status" class="done">{ja.vote.done} <a href="/saiketsu">{ja.vote.backToList}</a></p>
				{/if}
				<div class="submit">
					<button class="primary" disabled={!selected || !token}>{!selected ? ja.vote.choose : token ? ja.vote.submit : ja.vote.checking}</button>
				</div>
			</form>
		</section>
	</div>
</main>

<style>
	main {
		padding: 1rem;
	}

	h1 {
		margin: 0.5rem 0 0;
		font-size: var(--font-size-page-title);
		overflow-wrap: anywhere;
	}

	h2 {
		margin: 0;
		font-size: var(--font-size-body);
	}

	.summary {
		margin-top: 1rem;
		padding: 1rem;
		border-radius: var(--radius-l);
		background: var(--color-surface);
	}

	.summary ol {
		margin: 0.5rem 0 0;
		padding-left: 1.5rem;
	}

	.notice {
		margin: 1rem 0 0;
		padding: 0.75rem 1rem;
		border-radius: var(--radius-m);
		background: var(--color-caution-bg);
	}

	.changes {
		margin-top: 1rem;
	}

	.opener {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		min-height: var(--tap-primary);
		padding: 0.75rem 1rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-l);
		background: var(--color-bg);
		color: var(--color-text);
		font: inherit;
		text-align: left;
	}

	.chevron.up {
		transform: rotate(180deg);
	}

	.wide {
		display: none;
	}

	.list {
		display: none;
	}

	.list.expanded {
		display: block;
	}

	.row {
		padding: 0.75rem 0;
		border-bottom: 1px solid var(--color-divider);
		overflow-wrap: anywhere;
	}

	.row h3 {
		margin: 0;
		font-size: var(--font-size-sub);
	}

	.read {
		margin-top: 1rem;
	}

	#your-vote {
		margin-top: 1.5rem;
	}

	.standing {
		margin-top: 0.5rem;
		font-size: var(--font-size-sub);
	}

	.choices {
		display: grid;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}

	.choices label {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		min-height: var(--tap-primary);
		padding: 0.5rem 1rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-m);
	}

	.choices label.off {
		color: var(--color-text-sub);
	}

	.choices input {
		width: 1.25rem;
		height: 1.25rem;
		margin: 0;
	}

	.hint {
		margin: 0.5rem 0 0;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	.secret {
		display: flex;
		gap: 0.25rem;
		align-items: center;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	.error {
		color: var(--color-oppose);
	}

	/* 投票のボタンはスマホでは画面の下に留める（SpVote）。main の外には出ないので、下の注記に重ならない */
	.ballot,
	form {
		display: contents;
	}

	.submit {
		position: sticky;
		bottom: 0;
		padding: 0.75rem 0;
		background: var(--color-bg);
	}

	.primary {
		width: 100%;
		min-height: var(--tap-primary);
		border: none;
		border-radius: var(--radius-m);
		background: var(--color-base);
		color: var(--color-bg);
		font: inherit;
		font-weight: bold;
	}

	.primary:disabled {
		border: 1px dashed var(--color-input-border);
		background: var(--color-surface);
		color: var(--color-text-sub);
	}

	@media (min-width: 64rem) {
		.layout {
			display: grid;
			grid-template-columns: minmax(0, 1fr) 21.25rem;
			gap: 3rem;
			align-items: start;
			margin-top: 1rem;
		}

		.opener {
			display: none;
		}

		.wide,
		.list {
			display: block;
		}

		.wide {
			padding-bottom: 0.75rem;
			border-bottom: 1px solid var(--color-divider);
		}

		#your-vote {
			margin-top: 0;
		}

		.ballot {
			display: block;
			padding: 1.5rem;
			border: 2px solid var(--color-base);
			border-radius: var(--radius-l);
		}

		/* PC は「票の数は…」の注記をボタンの下に置く（PcVote） */
		form {
			display: flex;
			flex-direction: column;
		}

		.secret {
			order: 1;
			margin-bottom: 0;
		}

		.submit {
			position: static;
			padding-bottom: 0;
		}
	}
</style>
