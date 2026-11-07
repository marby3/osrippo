<script lang="ts">
	// 修正案のカード。提案者の名前は出さない。押された票の数も出さない
	import { enhance } from '$app/forms';
	import { ja } from '../copy/ja';
	import type { BillProgress } from '../domain/bills';
	import type { VoteChoice } from '../domain/votes';
	import type { AmendmentView } from '../server/amendments';
	import DiffText from './DiffText.svelte';
	import PostReport from './PostReport.svelte';
	import Turnstile from './Turnstile.svelte';

	let {
		amendment,
		progress,
		required,
		isAuthor,
		isSide,
		canAccept,
		loggedIn,
		waiting,
		eligible,
		siteKey,
		updateHref,
		back,
		message,
		staffHere,
		reported,
		reportDone,
		reportMessage
	}: {
		amendment: AmendmentView;
		progress: BillProgress;
		/** 本案より先に採決するのに要る賛同（3週目と4週目だけ） */
		required: number | null;
		isAuthor: boolean;
		/** 提出者、共同提出者、抜けた共同提出者。先議の賛同ができない */
		isSide: boolean;
		canAccept: boolean;
		loggedIn: boolean;
		/** 登録から7日たっていない */
		waiting: boolean;
		/** 投票資格（4週目にログインしているときだけ） */
		eligible: boolean | null;
		siteKey: string;
		updateHref: string;
		back: string;
		message?: string;
		/** 運営として対応できるか（権限があり、この法案の修正案に関わっていない） */
		staffHere: boolean;
		/** 見ている人が通報済みか */
		reported: boolean;
		reportDone?: string;
		reportMessage?: string;
	} = $props();

	const choices: VoteChoice[] = ['yes', 'no', 'abstain'];
	const open = $derived(amendment.status === 'open');
	const current = $derived(open && !amendment.stale);
	const deliberation = $derived(progress === 'deliberation');
	const votable = $derived(progress === 'vote' && amendment.prior);
	const statusText = $derived.by(() => {
		if (!open) return ja.amendment.statuses[amendment.status as Exclude<typeof amendment.status, 'open'>];
		if (deliberation) {
			if (amendment.stale) return ja.amendment.needsUpdate;
			return ja.amendment.supportLine(amendment.supports, Math.max(0, (required ?? 0) - amendment.supports));
		}
		if (progress === 'vote') return votable ? ja.amendment.voting : ja.amendment.notVoted;
		return ja.amendment.awaiting;
	});

	let selected = $state<VoteChoice | null>(null);
	let token = $state('');
	let turnstile: ReturnType<typeof Turnstile> | undefined = $state();
	const shown = $derived(selected ?? amendment.myVote);
</script>

<article id="shusei-{amendment.id}">
	<h2>{amendment.lawTitle ? `${amendment.lawTitle} ` : ''}{amendment.location}</h2>
	<section>
		<h3>{ja.amendment.before}</h3>
		<DiffText parts={amendment.before} show="removed" />
	</section>
	<section>
		<h3>{ja.amendment.after}</h3>
		<DiffText parts={amendment.after} show="added" />
	</section>
	{#if amendment.reason}
		<section>
			<h3>{ja.amendment.reason}</h3>
			<p class="reason">{amendment.reason}</p>
		</section>
	{/if}

	<p class="status">{statusText}</p>
	{#if deliberation && amendment.stale && amendment.mine}
		<p><a href={updateHref}>{ja.amendment.update}</a></p>
	{/if}

	{#if deliberation && current && isAuthor}
		{#if canAccept}
			<form method="post" action="?/accept" use:enhance={() => async ({ update }) => update({ reset: false })}>
				<input type="hidden" name="amendment" value={amendment.id} />
				<input type="hidden" name="revision" value={amendment.revision} />
				<button class="primary">{ja.amendment.accept}</button>
			</form>
		{:else}
			<p class="note">{ja.amendment.acceptDeadline}</p>
		{/if}
	{/if}

	{#if deliberation && open && !amendment.mine && !isSide && !waiting && (current || amendment.supported)}
		{#if loggedIn}
			<form method="post" action="?/support" use:enhance={() => async ({ update }) => update({ reset: false })}>
				<input type="hidden" name="amendment" value={amendment.id} />
				<input type="hidden" name="revision" value={amendment.revision} />
				<input type="hidden" name="op" value={amendment.supported ? 'remove' : 'add'} />
				<button>{amendment.supported ? ja.amendment.supportRemove : ja.amendment.supportAdd}</button>
			</form>
		{:else}
			<form method="get" action="/login">
				<input type="hidden" name="next" value={back} />
				<button>{ja.amendment.supportAdd}</button>
			</form>
		{/if}
	{/if}

	{#if votable}
		<p class="note">{ja.amendment.secret}</p>
		{#if eligible === false}<p class="note">{ja.amendment.reference}</p>{/if}
		<div class="choices">
			{#each choices as choice (choice)}
				{#if loggedIn}
					<button type="button" aria-pressed={shown === choice} onclick={() => (selected = choice)}>{ja.amendment.choices[choice]}</button>
				{:else}
					<form method="get" action="/login">
						<input type="hidden" name="next" value={back} />
						<button aria-pressed="false">{ja.amendment.choices[choice]}</button>
					</form>
				{/if}
			{/each}
		</div>
		{#if selected}
			<form
				method="post"
				action="?/vote"
				class="vote"
				use:enhance={() =>
					async ({ result, update }) => {
						await update({ reset: false });
						if (result.type === 'success') {
							selected = null;
							token = '';
						} else {
							turnstile?.reset();
						}
					}}
			>
				<input type="hidden" name="amendment" value={amendment.id} />
				<input type="hidden" name="choice" value={selected} />
				<Turnstile {siteKey} bind:token bind:this={turnstile} />
				<button class="primary" disabled={!token}>{ja.amendment.vote}</button>
			</form>
		{/if}
	{/if}

	{#if message}<p role="alert" class="error">{message}</p>{/if}

	<!-- 通報と運営の入口。自分のものには出さない。前の会期のカードにも出す -->
	{#if !amendment.mine}
		<PostReport
			post={amendment.id}
			label={ja.amendment.reportOpen}
			{loggedIn}
			{back}
			{reported}
			done={reportDone}
			message={reportMessage}
			action="reportAmendment"
			field="amendment"
			criteria={ja.report.amendmentCriteria}
		/>
		{#if staffHere}<p class="staff"><a href="/kanri?amendment={amendment.id}">{ja.post.staffLink}</a></p>{/if}
	{/if}
</article>

<style>
	article {
		padding: 1rem;
		border: 1px solid var(--color-divider);
		border-radius: var(--radius-l);
	}

	h2 {
		margin: 0;
		font-size: var(--font-size-body);
	}

	section {
		margin-top: 0.75rem;
	}

	h3 {
		margin: 0;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	.staff {
		margin: 0;
		font-size: var(--font-size-sub);
	}

	.staff a {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap-min);
	}

	.reason {
		margin: 0;
		white-space: pre-line;
		overflow-wrap: anywhere;
	}

	.status {
		margin: 0.75rem 0 0;
		font-weight: bold;
	}

	.note {
		margin: 0.5rem 0 0;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	.choices {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.5rem;
		margin-top: 0.75rem;
	}

	.choices button {
		width: 100%;
	}

	.choices button[aria-pressed='true'] {
		border-color: var(--color-base);
		background: var(--color-base);
		color: var(--color-bg);
		font-weight: bold;
	}

	form {
		margin-top: 0.75rem;
	}

	.choices form {
		margin: 0;
	}

	.vote {
		display: grid;
		gap: 0.5rem;
	}

	button {
		min-height: var(--tap-min);
		padding: 0 1rem;
		border: 1px solid var(--color-text-sub);
		border-radius: var(--radius-m);
		background: var(--color-bg);
		color: var(--color-text);
		font: inherit;
	}

	.primary {
		border-color: var(--color-base);
		background: var(--color-base);
		color: var(--color-bg);
		font-weight: bold;
	}

	.primary:disabled {
		opacity: 0.5;
	}

	.error {
		margin: 0.5rem 0 0;
		color: var(--color-caution);
		font-size: var(--font-size-sub);
	}
</style>
