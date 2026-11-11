<!-- 答弁イベントの告知（Issue #153）。議員だけ -->
<script lang="ts">
	import { enhance } from '$app/forms';
	import { ja } from '#lib/copy/ja.ts';
	import { TOBEN_TITLE_MAX } from '#lib/domain/toben.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	type Values = { kind: string | null; target: string | null; title: string | null; starts: string | null; ends: string | null };
	/** 断られたときは入れた値を残す */
	const v = $derived((form && 'values' in form ? form.values : null) as Values | null);
</script>

<svelte:head>
	<title>{ja.toben.announceTitle}</title>
</svelte:head>

<main class="frame">
	<p class="crumb"><a href="/giin">{ja.giin.headerLink}</a></p>
	<h1>{ja.toben.announceLink}</h1>
	<p class="lead">{ja.toben.announceLead}</p>
	{#if data.electionStopped}
		<p class="note">{ja.election.stopped}</p>
	{:else}
		<form method="post" use:enhance={() => async ({ update }) => update({ reset: false })}>
			<fieldset>
				<legend>{ja.toben.kindLegend}</legend>
				<label><input type="radio" name="kind" value="issue" checked={v?.kind !== 'bill'} />{ja.toben.target.issue}</label>
				<label><input type="radio" name="kind" value="bill" checked={v?.kind === 'bill'} />{ja.toben.target.bill}</label>
			</fieldset>
			<label for="toben-target">{ja.toben.targetLabel}</label>
			<input id="toben-target" name="target" inputmode="numeric" value={v?.target ?? ''} />
			<label for="toben-title">{ja.toben.titleLabel}</label>
			<input id="toben-title" name="title" maxlength={TOBEN_TITLE_MAX} value={v?.title ?? ''} />
			<label for="toben-starts">{ja.toben.startsLabel}</label>
			<input id="toben-starts" name="starts" type="datetime-local" value={v?.starts ?? ''} />
			<label for="toben-ends">{ja.toben.endsLabel}</label>
			<input id="toben-ends" name="ends" type="datetime-local" value={v?.ends ?? ''} />
			{#if form && 'message' in form}<p role="alert">{form.message}</p>{/if}
			<button>{ja.toben.announce}</button>
		</form>
	{/if}
</main>

<style>
	main {
		max-width: 40rem;
		padding-top: 1rem;
		padding-bottom: 2rem;
	}

	h1 {
		font-size: var(--font-size-page-title);
	}

	.crumb,
	.lead,
	.note {
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	form {
		display: grid;
		gap: 0.5rem;
	}

	fieldset {
		display: flex;
		gap: 1rem;
		border: none;
		padding: 0;
	}

	fieldset label {
		display: inline-flex;
		gap: 0.25rem;
		align-items: center;
		min-height: var(--tap-min);
	}

	input:not([type='radio']) {
		min-height: var(--tap-min);
		padding: 0 0.5rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-s);
		font: inherit;
	}

	button {
		justify-self: start;
		min-height: var(--tap-primary);
		padding: 0 1.25rem;
		border: none;
		border-radius: var(--radius-m);
		background: var(--color-base);
		color: var(--color-bg);
		font: inherit;
		font-weight: 700;
	}
</style>
