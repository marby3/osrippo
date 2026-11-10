<script lang="ts">
	import LegislatorNote from '#lib/components/LegislatorNote.svelte';
	import { enhance } from '$app/forms';
	import Turnstile from '#lib/components/Turnstile.svelte';
	import { ja } from '#lib/copy/ja.ts';
	import { AMENDMENT_REASON_MAX } from '#lib/domain/amendments.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// svelte-ignore state_referenced_locally
	let article = $state(form?.article ?? '');
	// svelte-ignore state_referenced_locally
	let body = $state(form?.body ?? data.update?.body ?? '');
	// svelte-ignore state_referenced_locally
	let reason = $state(form?.reason ?? data.update?.reason ?? '');
	let token = $state('');
	let turnstile: ReturnType<typeof Turnstile> | undefined = $state();

	const lawTitles = $derived([...new Set(data.articles.map((a) => a.lawTitle))]);
	const heading = $derived(data.update ? ja.amendment.updateHeading(data.update.label) : ja.amendment.write);
	const errorText = $derived.by(() => {
		const e = form?.error;
		if (!e) return undefined;
		if (e === 'unchanged') return form?.updating ? ja.amendment.unchangedOnUpdate : ja.amendment.unchanged;
		if (e === 'sameAsBase') return ja.amendment.sameAsBase;
		return form?.line ? ja.bill.bodyErrorAt(form.line, ja.bill.bodyErrors[e]) : ja.bill.bodyErrors[e];
	});

	/** 条を選ぶと、いまの本案の本文を入れる */
	function pick() {
		const chosen = data.articles.find((a) => a.key === article);
		if (chosen) body = chosen.body;
	}
</script>

<svelte:head>
	<title>{ja.amendment.writePageTitle(data.bill.title)}</title>
</svelte:head>

<div class="write">
	<h2>{heading}</h2>
	{#if data.legislator}
		<!-- 議員は修正案を出せない（docs/spec/158.md の 3） -->
		<LegislatorNote />
	{:else if data.blocked}
		<p class="note">{data.blocked}</p>
	{:else}
		<p class="note">{ja.amendment.coDrafterNotice}</p>
		<p class="note">{ja.ifLaw.formNote}</p>
		{#if data.update?.current}
			<section class="current">
				<h3>{ja.amendment.currentBill}</h3>
				<p>{data.update.current}</p>
			</section>
		{/if}
		<form
			method="post"
			use:enhance={() =>
				async ({ result, update }) => {
					await update({ reset: false });
					// トークンは1回しか使えないので、断られたら作り直す
					if (result.type !== 'redirect') turnstile?.reset();
				}}
		>
			<input type="hidden" name="rev" value={data.rev} />
			{#if !data.update}
				<label for="article">{ja.amendment.articleField}</label>
				<select id="article" name="article" required bind:value={article} onchange={pick}>
					<option value="">{ja.amendment.articlePlaceholder}</option>
					{#if data.multipleLaws}
						{#each lawTitles as title (title)}
							<optgroup label={title}>
								{#each data.articles.filter((a) => a.lawTitle === title) as a (a.key)}<option value={a.key}>{a.label}</option>{/each}
							</optgroup>
						{/each}
					{:else}
						{#each data.articles as a (a.key)}<option value={a.key}>{a.label}</option>{/each}
					{/if}
				</select>
			{/if}
			<label for="body">{ja.amendment.bodyField}</label>
			<textarea id="body" name="body" bind:value={body} required rows="8" aria-invalid={errorText ? 'true' : undefined} aria-describedby={errorText ? 'body-error' : undefined}></textarea>
			{#if errorText}<p id="body-error" class="error">{errorText}</p>{/if}
			<label for="reason">{ja.amendment.reasonField}</label>
			<textarea id="reason" name="reason" bind:value={reason} rows="3" maxlength={AMENDMENT_REASON_MAX}></textarea>
			{#if form?.reasonError}<p class="error">{form.reasonError}</p>{/if}
			{#if form?.ruleError}<p class="error">{form.ruleError}</p>{/if}
			<Turnstile siteKey={data.siteKey} bind:token bind:this={turnstile} />
			{#if form?.message}<p role="alert" class="error">{form.message}</p>{/if}
			<button disabled={!token}>{data.update ? ja.amendment.update : ja.amendment.write}</button>
		</form>
	{/if}
	<p class="back"><a href="/houan/{data.bill.id}/shusei">{ja.amendment.back}</a></p>
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
		margin-top: 0.75rem;
	}

	label {
		font-weight: bold;
	}

	select,
	textarea {
		width: 100%;
		box-sizing: border-box;
		font: inherit;
	}

	select {
		min-height: var(--tap-min);
	}

	.current {
		margin-top: 0.75rem;
		padding: 0.5rem 1rem;
		border-left: 3px solid var(--color-divider);
		background: var(--color-surface);
	}

	.current h3 {
		margin: 0;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	.current p {
		margin: 0;
		white-space: pre-line;
		overflow-wrap: anywhere;
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

	.note,
	.error {
		margin: 0;
		font-size: var(--font-size-sub);
	}

	.note {
		color: var(--color-text-sub);
	}

	.error {
		color: var(--color-caution);
	}

	.back {
		margin: 1rem 0 0;
	}
</style>
