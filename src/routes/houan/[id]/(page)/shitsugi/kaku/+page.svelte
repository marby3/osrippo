<script lang="ts">
	import { enhance } from '$app/forms';
	import Turnstile from '#lib/components/Turnstile.svelte';
	import { ja } from '#lib/copy/ja.ts';
	import { POST_MAX } from '#lib/domain/posts.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// svelte-ignore state_referenced_locally
	let body = $state(form && 'body' in form ? (form.body ?? '') : '');
	let token = $state('');
	let turnstile: ReturnType<typeof Turnstile> | undefined = $state();

	const error = $derived(form && 'error' in form ? form.error : undefined);
	const message = $derived(form && 'message' in form ? form.message : undefined);
	const errorText = $derived(error === 'tooLong' ? ja.issue.errors.tooLong(POST_MAX.question) : error ? ja.issue.errors[error] : undefined);
</script>

<svelte:head>
	<title>{ja.post.writePageTitle(data.bill.title)}</title>
</svelte:head>

<div class="write">
	<h2>{ja.post.writeQuestion}</h2>
	{#if data.electionStopped}
		<p class="note">{ja.election.stopped}</p>
	{:else if data.waitUntil !== null}
		<p class="note">{ja.post.tooNew(data.waitUntil)}</p>
	{:else if !data.open}
		<p class="note">{ja.post.closed}</p>
	{:else}
		<form
			method="post"
			use:enhance={() =>
				async ({ result, update }) => {
					await update({ reset: false });
					// トークンは1回しか使えないので、断られたら作り直す
					if (result.type !== 'redirect') turnstile?.reset();
				}}
		>
			<label for="body">{ja.post.questionField}</label>
			<textarea
				id="body"
				name="body"
				bind:value={body}
				required
				maxlength={POST_MAX.question}
				rows="6"
				aria-invalid={error ? 'true' : undefined}
				aria-describedby={error ? 'body-error' : undefined}
			></textarea>
			{#if errorText}<p id="body-error" class="error">{errorText}</p>{/if}
			<Turnstile siteKey={data.siteKey} bind:token bind:this={turnstile} />
			{#if message}<p role="alert" class="error">{message}</p>{/if}
			<button disabled={!token}>{ja.post.send}</button>
		</form>
	{/if}
	<p class="back"><a href="/houan/{data.bill.id}/shitsugi">{ja.post.back}</a></p>
</div>

<style>
	.write {
		max-width: 40rem;
		margin-top: 1.5rem;
	}

	h2 {
		margin: 0 0 0.75rem;
		font-size: var(--font-size-body);
	}

	form {
		display: grid;
		gap: 0.5rem;
	}

	label {
		font-weight: bold;
	}

	textarea {
		width: 100%;
		box-sizing: border-box;
		font: inherit;
	}

	button {
		min-height: var(--tap-primary);
		border: 0;
		border-radius: var(--radius-m);
		background: var(--color-base);
		color: var(--color-bg);
		font: inherit;
		font-weight: bold;
	}

	button:disabled {
		opacity: 0.5;
	}

	.note {
		color: var(--color-text-sub);
	}

	.error {
		margin: 0;
		color: var(--color-caution);
		font-size: var(--font-size-sub);
	}

	.back {
		margin: 1rem 0 0;
	}
</style>
