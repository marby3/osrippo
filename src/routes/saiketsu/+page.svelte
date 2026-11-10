<script lang="ts">
	import LegislatorNote from '#lib/components/LegislatorNote.svelte';
	// 採決の一覧（SpVoteList・PcVoteList）。スマホは「まだ」、PC は「投票する」と出す。進み具合は投票した本数だけ左から埋める
	import VoteStanding from '#lib/components/VoteStanding.svelte';
	import { ja } from '#lib/copy/ja.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const done = $derived(data.open ? data.rows.filter((r) => r.voted).length : 0);
	const total = $derived(data.open ? data.rows.length : 0);
	/** 次に投票する法案を太い枠で示す */
	const nextId = $derived(data.open ? data.rows.find((r) => !r.voted)?.id : undefined);
</script>

<svelte:head>
	<title>{ja.vote.listPageTitle}</title>
</svelte:head>

<main>
	{#if data.open}
		<p class="deadline">{ja.session.name(data.session)}<span class="pc">{ja.vote.ofVote}</span> ・ {ja.vote.deadline(data.session)}</p>
		<h1>{ja.vote.assigned}<span class="count"><span class="done">{done}</span> / {total}</span> {ja.vote.votedSuffix}</h1>
		{#if total}
			<ol class="progress" data-vote-progress aria-hidden="true">
				{#each data.rows as row, i (row.id)}<li data-filled={i < done ? '' : undefined}></li>{/each}
			</ol>
		{/if}
		<div class="standing">{#if data.legislator}<LegislatorNote />{:else}<VoteStanding eligible={data.eligible} {total} {done} />{/if}</div>
		{#if total}
			<ul class="rows">
				{#each data.rows as row (row.id)}
					<li data-assignment class:voted={row.voted} class:next={row.id === nextId}>
						<span class="mark" data-checked={row.voted ? '' : undefined} aria-hidden="true"></span>
						<a href="/saiketsu/{row.id}">{row.title}</a>
						{#if row.voted}
							<span class="state">{ja.vote.voted}</span>
						{:else}
							<span class="state todo"><span class="sp">{ja.vote.notYet}</span><span class="pc">{ja.vote.toVote}</span></span>
							<svg class="chevron" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" /></svg>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
		<p class="other"><a href="/saiketsu/hoka">{ja.vote.other}</a></p>
	{:else}
		<h1>{ja.vote.heading}</h1>
		<p>{ja.vote.before(data.session)}</p>
	{/if}
	<p class="other"><a href="/iinkai">{ja.chair.link}</a></p>
</main>

<style>
	main {
		max-width: 47rem;
		margin: 0 auto;
		padding: 1rem;
	}

	.deadline {
		margin: 0;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	h1 {
		margin: 0.5rem 0 0;
		font-size: var(--font-size-page-title);
	}

	.count {
		margin-left: 0.75rem;
		font-size: var(--font-size-heading);
	}

	.done {
		font-size: var(--font-size-page-title);
	}

	.progress {
		display: flex;
		gap: 0.25rem;
		margin: 0.75rem 0 0;
		padding: 0;
		list-style: none;
	}

	.progress li {
		flex: 1;
		height: 0.5rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-pill);
	}

	.progress li[data-filled] {
		border-color: var(--color-base);
		background: var(--color-base);
	}

	.standing {
		margin-top: 1rem;
	}

	.rows {
		display: grid;
		gap: 0.75rem;
		margin: 1.5rem 0 0;
		padding: 0;
		list-style: none;
	}

	/* カード全体を押せるようにする。リンクの名前は題名だけにする */
	.rows li {
		position: relative;
		display: grid;
		grid-template-columns: auto 1fr auto;
		column-gap: 0.75rem;
		align-items: center;
		min-height: var(--tap-primary);
		padding: 1rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-l);
	}

	.rows li.next {
		border: 2px solid var(--color-base);
	}

	.mark {
		grid-row: span 2;
		width: 1.5rem;
		height: 1.5rem;
		border: 2px solid var(--color-input-border);
		border-radius: 50%;
	}

	/* 色だけで示さない：済んだものには印を入れ、「投票済み」と書く */
	.mark[data-checked] {
		display: grid;
		place-items: center;
		border-color: var(--color-base);
		color: var(--color-base);
	}

	.mark[data-checked]::after {
		content: '✓';
		font-size: var(--font-size-sub);
		font-weight: bold;
	}

	.rows a {
		color: var(--color-text);
		font-weight: bold;
		text-decoration: none;
		overflow-wrap: anywhere;
	}

	.rows a::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: var(--radius-l);
	}

	.rows a:focus-visible::after {
		outline: 3px solid var(--color-focus);
	}

	.rows .voted a {
		font-weight: normal;
	}

	.state {
		grid-column: 2;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	.chevron {
		grid-column: 3;
		grid-row: 1 / span 2;
	}

	.pc {
		display: none;
	}

	.other {
		margin-top: 2rem;
	}

	@media (min-width: 64rem) {
		main {
			padding-top: 2.5rem;
		}

		.rows li {
			grid-template-columns: auto 1fr auto;
			padding: 1.5rem 1.25rem;
		}

		.mark {
			grid-row: auto;
		}

		.state {
			grid-column: 3;
		}

		.todo {
			color: var(--color-text);
			font-weight: bold;
		}

		.sp,
		.chevron {
			display: none;
		}

		.pc {
			display: inline;
		}
	}
</style>
