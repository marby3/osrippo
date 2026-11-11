<!-- 専門家の解説（Issue #152）。法案の概要のタブの別欄。評価のボタンと有識者の立場は出さない -->
<script lang="ts">
	import { enhance } from '$app/forms';
	import { ja, jaDate } from '../copy/ja';
	import { tokyoDate } from '../domain/law/display';
	import type { Person } from '../domain/verification';
	import PersonName from './PersonName.svelte';
	import Turnstile from './Turnstile.svelte';

	type Item = { id: number; body: string; createdAt: number; editedAt: number | null; hidden: boolean; mine: boolean; person: Person };
	let {
		data,
		form,
		loggedIn
	}: {
		data: { list: Item[]; open: boolean; expert: 'expert' | 'stopped' | null; mine: { id: number; body: string; status: string } | null; reported: number[]; max: number; siteKey: string };
		form: Record<string, unknown> | null | undefined;
		loggedIn: boolean;
	} = $props();

	const REASONS = ['attack', 'spam', 'other'] as const;
	let editing = $state(false);
	let reporting = $state<number | null>(null);
	let reason = $state('');
	let token = $state('');
	let turnstile: ReturnType<typeof Turnstile> | undefined = $state();
	const day = (ms: number) => jaDate(tokyoDate(ms));
	const failure = $derived(form && 'commentaryBody' in form && typeof form.message === 'string' ? form.message : null);
	/** 書く欄を出すか：有識者で、時期の中で、まだ書いていないか、直すボタンを押した */
	const canWrite = $derived(data.expert === 'expert' && data.open && (data.mine === null || editing));
	const canEdit = $derived(data.expert === 'expert' && data.open && data.mine !== null && !editing && (data.mine.status === 'visible' || data.mine.status === 'restored'));
</script>

<section class="commentary" aria-labelledby="commentary-heading">
	<h2 id="commentary-heading">{ja.commentary.heading}</h2>
	<p class="lead">{ja.commentary.lead}</p>
	{#if data.list.length === 0}
		<p class="empty">{ja.commentary.empty}</p>
	{/if}
	{#each data.list as c (c.id)}
		<article>
			<p class="by"><PersonName person={c.person} /> ・ {day(c.createdAt)}{#if c.editedAt} ・ {ja.commentary.edited(tokyoDate(c.editedAt))}{/if}</p>
			{#if c.hidden}<p class="note">{ja.commentary.hiddenMine}</p>{/if}
			<p class="body">{c.body}</p>
			{#if loggedIn && !c.mine && !c.hidden}
				{#if form && form.reportCommentary === c.id && form.reportDone}
					<p role="status" class="note">{ja.commentary.reportDone}</p>
				{:else if data.reported.includes(c.id)}
					<p class="note">{ja.commentary.reportAlready}</p>
				{:else if reporting === c.id}
					<form method="post" action="?/reportCommentary" use:enhance={() => async ({ update }) => update({ reset: false })} class="report">
						<input type="hidden" name="commentary" value={c.id} />
						<fieldset>
							<legend>{ja.commentary.reportLegend}</legend>
							{#each REASONS as r (r)}
								<label><input type="radio" name="reason" value={r} bind:group={reason} />{ja.report.reasons[r]}</label>
							{/each}
						</fieldset>
						{#if reason === 'other'}
							<label for="commentary-report-note-{c.id}">{ja.commentary.reportNote}</label>
							<textarea id="commentary-report-note-{c.id}" name="note" maxlength="200" rows="2"></textarea>
						{/if}
						{#if form && form.reportCommentary === c.id && typeof form.message === 'string'}<p role="alert">{form.message}</p>{/if}
						<button>{ja.commentary.reportSend}</button>
					</form>
				{:else}
					<button type="button" class="link" onclick={() => (reporting = c.id)}>{ja.commentary.report}</button>
				{/if}
			{/if}
		</article>
	{/each}

	{#if data.expert === 'stopped'}
		<p class="note">{ja.commentary.electionStopped}</p>
	{:else if data.expert === 'expert' && !data.open}
		<p class="note">{ja.commentary.closed}</p>
	{:else if canEdit}
		<button type="button" onclick={() => (editing = true)}>{ja.commentary.edit}</button>
	{:else if canWrite}
		<form
			method="post"
			action="?/commentary"
			use:enhance={() =>
				async ({ result, update }) => {
					await update({ reset: false });
					turnstile?.reset();
					if (result.type === 'success') editing = false;
				}}
		>
			<label for="commentary-body">{ja.commentary.bodyLabel}</label>
			<!-- 送れなかったときは、書いた本文を残す -->
			<textarea id="commentary-body" name="body" required maxlength={data.max} rows="8">{form && typeof form.commentaryBody === 'string' ? form.commentaryBody : (data.mine?.body ?? '')}</textarea>
			<Turnstile siteKey={data.siteKey} bind:token bind:this={turnstile} />
			{#if failure}<p role="alert">{failure}</p>{/if}
			<button class="primary" disabled={!token}>{ja.commentary.send}</button>
		</form>
	{/if}
</section>

<style>
	.commentary {
		margin-top: 2rem;
	}

	h2 {
		font-size: var(--font-size-heading);
	}

	.lead,
	.note,
	.by,
	.empty {
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	article {
		padding: 0.75rem 0;
		border-top: 1px solid var(--color-divider);
	}

	.body {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	form {
		display: grid;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}

	fieldset {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		border: none;
		padding: 0;
	}

	fieldset label {
		display: inline-flex;
		gap: 0.25rem;
		align-items: center;
		min-height: var(--tap-min);
	}

	textarea {
		padding: 0.5rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-m);
		font: inherit;
	}

	button {
		justify-self: start;
		min-height: var(--tap-min);
		padding: 0 1rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-m);
		background: var(--color-bg);
		font: inherit;
	}

	button.primary {
		border-color: var(--color-base);
		background: var(--color-base);
		color: var(--color-bg);
		font-weight: 700;
	}

	button.primary:disabled {
		opacity: 0.5;
	}

	button.link {
		min-height: var(--tap-min);
		padding: 0;
		border: none;
		background: none;
		color: var(--color-link);
		font-size: var(--font-size-sub);
		text-decoration: underline;
	}
</style>
