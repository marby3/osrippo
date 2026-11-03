<script lang="ts">
	import { enhance } from '$app/forms';
	import Turnstile from '#lib/components/Turnstile.svelte';
	import { ja } from '#lib/copy/ja.ts';
	import { SOLUTION_MAX } from '#lib/domain/solutions.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// svelte-ignore state_referenced_locally
	let body = $state(form && 'body' in form ? (form.body ?? '') : '');
	let token = $state('');
	let turnstile: ReturnType<typeof Turnstile> | undefined = $state();

	const error = $derived(form && 'error' in form ? form.error : undefined);
	const message = $derived(form && 'message' in form ? form.message : undefined);
	const errorText = $derived(
		error === 'tooLong' ? ja.issue.errors.tooLong(SOLUTION_MAX) : error ? ja.issue.errors[error] : undefined
	);
</script>

<svelte:head>
	<title>{ja.solution.writePageTitle}</title>
</svelte:head>

<main>
	<p class="issue"><a href="/kadai/{data.issue.id}">{data.issue.title}</a></p>
	<h1>{ja.solution.write}</h1>
	<form
		method="post"
		use:enhance={() =>
			async ({ result, update }) => {
				await update({ reset: false });
				// トークンは1回しか使えないので、断られたら作り直す
				if (result.type !== 'redirect') turnstile?.reset();
			}}
	>
		<label for="body">{ja.solution.label}</label>
		<textarea
			id="body"
			name="body"
			bind:value={body}
			required
			maxlength={SOLUTION_MAX}
			rows="8"
			aria-invalid={error ? 'true' : undefined}
			aria-describedby={error ? 'body-error' : undefined}
		></textarea>
		{#if errorText}<p id="body-error" class="error">{errorText}</p>{/if}
		<Turnstile siteKey={data.siteKey} bind:token bind:this={turnstile} />
		{#if message}<p role="alert" class="error">{message}</p>{/if}
		<button disabled={!token}>{ja.solution.submit}</button>
	</form>
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

	.issue {
		font-size: var(--font-size-sub);
	}

	form {
		display: grid;
		gap: 0.5rem;
	}

	label {
		font-weight: bold;
	}

	textarea {
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-m);
		font: inherit;
	}

	.error {
		margin: 0;
		color: var(--color-caution);
		font-size: var(--font-size-sub);
	}

	button {
		justify-self: start;
		min-height: var(--tap-secondary);
		padding: 0 1.25rem;
		border: 1px solid var(--color-base);
		border-radius: var(--radius-m);
		background: var(--color-base);
		color: var(--color-bg);
		font: inherit;
		font-weight: bold;
	}

	button:disabled {
		opacity: 0.5;
	}
</style>
