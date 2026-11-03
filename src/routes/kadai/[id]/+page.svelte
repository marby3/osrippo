<script lang="ts">
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import { ja } from '#lib/copy/ja.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let reasonChoice = $state('');
	let reportOpen = $state(false);
	/** JS がなければ通報の欄を最初から開いておく */
	let js = $state(false);
	onMount(() => {
		js = true;
	});

	const hiddenMessage = (status: string, reason: string | null) =>
		status === 'auto_hidden'
			? ja.hidden.auto
			: ja.hidden.staff(ja.hideReasons[(reason ?? 'other') as keyof typeof ja.hideReasons]);
	const message = $derived(form && 'message' in form ? form.message : undefined);
	const reportMessage = $derived(form && 'reportMessage' in form ? form.reportMessage : undefined);
</script>

<svelte:head>
	{#if data.view === 'hidden'}
		<title>{ja.hidden.pageTitle}</title>
	{:else}
		<title>{ja.issue.pageTitle(data.issue.title)}</title>
	{/if}
	{#if data.view === 'hidden' || data.hidden}
		<meta name="robots" content="noindex" />
	{/if}
</svelte:head>

<main>
	{#if data.view === 'hidden'}
		<!-- 自分の通報で非表示になったときも、受け付けたことを知らせる -->
		{#if reportMessage}<p role="status">{reportMessage}</p>{/if}
		<h1>{ja.hidden.heading}</h1>
		<p>{hiddenMessage(data.status, data.statusReason)}</p>
		<p><a href="/unei">{ja.hidden.toLog}</a></p>
	{:else}
		{@const issue = data.issue}
		{#if data.hidden}
			<p class="notice" role="status">
				{hiddenMessage(issue.status, issue.statusReason)}
				<a href="/unei">{ja.hidden.toLog}</a>
			</p>
		{/if}
		<h1>{issue.title}</h1>
		{#if issue.topicName}<p class="topic">{ja.issue.topicMark(issue.topicName)}</p>{/if}

		<h2>{ja.issue.affected}</h2>
		<p>{issue.affected}</p>
		<h2>{ja.issue.example}</h2>
		<p class="example">{issue.example}</p>

		{#if !data.hidden}
			<form method="post" action="?/support" use:enhance>
				<input type="hidden" name="op" value={issue.supported ? 'remove' : 'add'} />
				<button class="support" aria-pressed={issue.supported}>
					<svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20">
						<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" />
						<path d="m8 12 3 3 5-6" fill="none" stroke="currentColor" stroke-width="2" />
					</svg>
					{ja.issue.support}
					{issue.supports}
				</button>
				<p class="hint">{ja.issue.supportHint}</p>
				{#if message}<p role="alert">{message}</p>{/if}
			</form>
		{/if}

		{#if data.staff}
			<p><a href="/kanri?issue={issue.id}">{ja.hidden.staffLink}</a></p>
		{/if}

		{#if !data.hidden && !data.mine}
			<section class="report">
				{#if reportMessage}<p role="status">{reportMessage}</p>{/if}
				{#if data.reported}
					{#if reportMessage !== ja.report.already}<p>{ja.report.already}</p>{/if}
				{:else if !data.loggedIn}
					<!-- ログインしていなければ、押すとログインの画面へ（JS がなくても動く） -->
					<form method="get" action="/login">
						<input type="hidden" name="next" value="/kadai/{issue.id}" />
						<button class="link">{ja.report.open}</button>
					</form>
				{:else}
					{#if js && !reportOpen}
						<button type="button" class="link" onclick={() => (reportOpen = true)}>{ja.report.open}</button>
					{/if}
					{#if !js || reportOpen}
						<form method="post" action="?/report" use:enhance>
							<fieldset>
								<legend>{ja.report.legend}</legend>
								{#each ['attack', 'spam', 'duplicate', 'other'] as const as reason (reason)}
									<label class="radio">
										<input type="radio" name="reason" value={reason} bind:group={reasonChoice} />
										{ja.report.reasons[reason]}
									</label>
								{/each}
							</fieldset>
							{#if !js || reasonChoice === 'other'}
								<label for="note">{ja.report.noteLabel}</label>
								<textarea id="note" name="note" maxlength="200" rows="3"></textarea>
							{/if}
							<p class="criteria">{ja.report.criteria} <a href="/unei">{ja.report.criteriaLink}</a></p>
							<button class="submit">{ja.report.submit}</button>
						</form>
					{/if}
				{/if}
			</section>
		{/if}
	{/if}
</main>

<style>
	main {
		max-width: 40rem;
		margin: 0 auto;
		padding: 1rem;
	}

	h1 {
		font-size: var(--font-size-page-title);
	}

	h2 {
		margin: 1rem 0 0;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	h2 + p {
		margin-top: 0.25rem;
	}

	.topic {
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	.example {
		white-space: pre-wrap;
	}

	.notice {
		padding: 0.75rem 1rem;
		border-radius: var(--radius-m);
		background: var(--color-caution-bg);
		color: var(--color-caution);
	}

	form {
		margin-top: 1.5rem;
	}

	.support {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		width: 100%;
		min-height: var(--tap-primary);
		border: 2px solid var(--color-base);
		border-radius: var(--radius-pill);
		background: var(--color-bg);
		color: var(--color-base);
		font: inherit;
		font-weight: bold;
	}

	.support[aria-pressed='true'] {
		background: var(--color-base);
		color: var(--color-bg);
	}

	.hint {
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
		text-align: center;
	}

	[role='alert'] {
		color: var(--color-caution);
	}

	.report {
		margin-top: 2rem;
		font-size: var(--font-size-sub);
	}

	.report form {
		display: grid;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}

	.link {
		min-height: var(--tap-min);
		padding: 0;
		border: none;
		background: none;
		color: var(--color-text-sub);
		font: inherit;
		text-decoration: underline;
	}

	fieldset {
		border: none;
		padding: 0;
	}

	legend {
		font-weight: bold;
	}

	.radio {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: var(--tap-min);
	}

	textarea {
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-m);
		font: inherit;
	}

	.criteria {
		color: var(--color-text-sub);
	}

	.submit {
		justify-self: start;
		min-height: var(--tap-min);
		padding: 0 1.25rem;
		border: 1px solid var(--color-base);
		border-radius: var(--radius-m);
		background: var(--color-bg);
		color: var(--color-base);
		font: inherit;
		font-weight: bold;
	}
</style>
