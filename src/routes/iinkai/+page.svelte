<script lang="ts">
	// 委員会のページ（docs/spec/77.md 決めたこと7）。画面の案はないので、採決の画面にそろえる。
	// Turnstile は1つを共有し、立候補、投票、署名のフォームに同じトークンを入れる（1回使うと作り直す）
	import { enhance } from '$app/forms';
	import Turnstile from '#lib/components/Turnstile.svelte';
	import { ja } from '#lib/copy/ja.ts';
	import type { SubmitFunction } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const message = $derived(form && 'message' in form ? form.message : null);
	const election = $derived(data.election);

	const canStand = $derived(data.loggedIn && election.candidacyOpen && !election.isCandidate && data.blocks?.stand === null);
	const canVote = $derived(data.loggedIn && election.open && election.candidates.length > 0 && data.blocks?.vote === null);
	const canSign = $derived(data.loggedIn && data.recall?.open === true && !data.recall.signed && data.blocks?.recall === null);

	let token = $state('');
	let turnstile: ReturnType<typeof Turnstile> | undefined = $state();
	let picked = $state<number | null>(null);
	const selected = $derived(picked ?? election.myVote);

	/** 選び直した候補を残さず、読み直した自分の票を出す */
	const submit: SubmitFunction = () => async ({ update }) => {
		await update({ reset: false });
		picked = null;
		// トークンは1回しか使えない。ウィジェットが消えて reset が届かなくても、使ったトークンを残さない
		token = '';
		turnstile?.reset();
	};
</script>

<svelte:head>
	<title>{ja.chair.pageTitle}</title>
	<!-- 実在の利用者の名前が「委員長」「解任されました」と並ぶので、検索に載せない -->
	<meta name="robots" content="noindex" />
</svelte:head>

<main>
	<h1>{ja.chair.heading}</h1>
	<p class="name">{data.name}</p>
	{#if message}<p role="alert" class="error">{message}</p>{/if}

	<section aria-labelledby="panel-heading">
		<h2 id="panel-heading">{ja.chair.panelHeading}</h2>
		{#if data.panel.settling}
			<p>{ja.chair.settling}</p>
		{:else if !data.panel.chair}
			<p>{ja.chair.none}</p>
		{:else}
			<dl>
				<dt>{ja.chair.chair}</dt>
				<dd>
					{data.panel.chair.name}
					{#if data.panel.recalled}<span class="state">{ja.chair.recalled}</span>{/if}
				</dd>
				{#if data.panel.directors.length}
					<dt>{ja.chair.directors}</dt>
					<dd>
						<ul>
							{#each data.panel.directors as director (director.name)}<li>{director.name}</li>{/each}
						</ul>
					</dd>
				{/if}
			</dl>
			{#if data.panel.acting}<p class="state">{ja.chair.acting}</p>{:else if data.panel.recalled}<p>{ja.chair.backToOffice}</p>{/if}
		{/if}
		{#if data.manage}<p><a href="/kanri">{ja.chair.manage}</a></p>{/if}
	</section>

	{#if !data.loggedIn}
		<p class="login">{ja.chair.loginHint} <a href="/login?next=%2Fiinkai">{ja.chair.login}</a></p>
	{/if}

	<section aria-labelledby="election-heading">
		<h2 id="election-heading">{ja.chair.election.heading}</h2>
		{#if !election.open}
			<p>{ja.chair.election.before(election.voteAt)}</p>
		{:else if election.candidacyOpen}
			<p>{ja.chair.election.period(election.candidacyEnd, election.endsAt)}</p>
		{:else}
			<p>{ja.chair.election.votingOnly(election.endsAt)}</p>
		{/if}
		<p class="sub">{ja.chair.election.rule}</p>

		{#if election.candidacyOpen && data.loggedIn}
			{#if election.isCandidate}
				<p class="sub">{ja.chair.election.withdrawNote}</p>
				<form method="post" action="?/withdraw" use:enhance={submit}>
					<button>{ja.chair.election.withdraw}</button>
				</form>
			{:else if canStand}
				<p class="sub">{ja.chair.election.standHelp}</p>
				<form method="post" action="?/stand" use:enhance={submit}>
					<input type="hidden" name="cf-turnstile-response" value={token} />
					<button class="primary" disabled={!token}>{token ? ja.chair.election.stand : ja.chair.election.checking}</button>
				</form>
			{:else if data.blocks?.stand}
				<p class="sub">{ja.chair.blocks[data.blocks.stand]}</p>
			{/if}
		{/if}

		{#if election.open}
			<h3>{ja.chair.election.candidates}</h3>
			{#if election.candidates.length === 0}
				<p>{ja.chair.election.noCandidates}</p>
			{:else if canVote}
				<form method="post" action="?/vote" use:enhance={submit}>
					<input type="hidden" name="cf-turnstile-response" value={token} />
					<div class="choices">
						{#each election.candidates as candidate (candidate.id)}
							<label>
								<input type="radio" name="candidate" value={candidate.id} checked={selected === candidate.id} onchange={() => (picked = candidate.id)} />
								{candidate.name}
							</label>
						{/each}
					</div>
					<p class="sub">{ja.chair.election.secret}</p>
					{#if form && 'voted' in form}<p role="status" class="done">{ja.chair.election.voted}</p>{:else if election.myVote !== null}<p class="sub">{ja.chair.election.votedAgain}</p>{/if}
					<button class="primary" disabled={selected === null || !token}>{selected === null ? ja.chair.election.choose : token ? ja.chair.election.vote : ja.chair.election.checking}</button>
				</form>
			{:else}
				<ul class="names">
					{#each election.candidates as candidate (candidate.id)}<li>{candidate.name}</li>{/each}
				</ul>
				{#if data.blocks?.vote}<p class="sub">{ja.chair.blocks[data.blocks.vote]}</p>{/if}
			{/if}
		{/if}
	</section>

	{#if data.recall}
		<section aria-labelledby="recall-heading">
			<h2 id="recall-heading">{ja.chair.recall.heading}</h2>
			<p class="sub">{ja.chair.recall.rule}</p>
			<p class="count">{ja.chair.recall.count(data.recall.signatures, data.recall.required)}</p>
			<p class="sub">{ja.chair.recall.secret}</p>
			{#if data.recall.open && data.loggedIn}
				{#if data.recall.signed}
					<p role="status" class="done">{ja.chair.recall.signed}</p>
					<form method="post" action="?/cancelRecall" use:enhance={submit}>
						<button>{ja.chair.recall.cancel}</button>
					</form>
				{:else if canSign}
					<form method="post" action="?/recall" use:enhance={submit}>
						<input type="hidden" name="cf-turnstile-response" value={token} />
						<button disabled={!token}>{token ? ja.chair.recall.sign : ja.chair.election.checking}</button>
					</form>
				{:else if data.blocks?.recall && data.blocks.recall !== 'closed'}
					<p class="sub">{data.blocks.recall === 'ineligible' ? ja.chair.blocks.recallIneligible : ja.chair.blocks[data.blocks.recall]}</p>
				{/if}
			{/if}
		</section>
	{/if}

	{#if canStand || canVote || canSign}
		<Turnstile siteKey={data.siteKey} bind:token bind:this={turnstile} />
	{/if}
</main>

<style>
	main {
		max-width: 47rem;
		margin: 0 auto;
		padding: 1rem;
	}

	h1 {
		margin: 0.5rem 0 0;
		font-size: var(--font-size-page-title);
	}

	.name,
	.sub {
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	section {
		margin-top: 1.5rem;
		padding-top: 1rem;
		border-top: 1px solid var(--color-divider);
	}

	h2 {
		margin: 0 0 0.5rem;
		font-size: var(--font-size-heading);
	}

	h3 {
		margin: 1rem 0 0.5rem;
		font-size: var(--font-size-body);
	}

	dl {
		margin: 0;
	}

	dt {
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	dd {
		margin: 0 0 0.75rem;
	}

	ul {
		margin: 0;
		padding-left: 1.25rem;
	}

	.state {
		font-weight: bold;
	}

	.choices {
		display: grid;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}

	.choices label {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		min-height: var(--tap-primary);
		overflow-wrap: anywhere;
	}

	button {
		min-height: var(--tap-primary);
		padding: 0 1rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-m);
		background: var(--color-bg);
		color: var(--color-text);
		font: inherit;
	}

	.primary {
		width: 100%;
		border: none;
		background: var(--color-base);
		color: var(--color-bg);
		font-weight: bold;
	}

	.primary:disabled {
		border: 1px dashed var(--color-input-border);
		background: var(--color-surface);
		color: var(--color-text-sub);
	}

	@media (min-width: 64rem) {
		.primary {
			width: auto;
			min-width: 16rem;
		}
	}

	.count {
		font-weight: bold;
	}

	.error {
		color: var(--color-oppose);
	}
</style>
