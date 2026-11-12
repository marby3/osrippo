<!-- 答弁イベントの質問と答弁（Issue #181）。評価のボタンは出さない -->
<script lang="ts">
	import { enhance } from '$app/forms';
	import { ja, jaDate } from '../copy/ja';
	import { tokyoDate } from '../domain/law/display';
	import type { TobenState } from '../domain/toben';
	import type { TobenQuestionView } from '../server/toben-questions';
	import PersonName from './PersonName.svelte';
	import Turnstile from './Turnstile.svelte';

	type Me = { asked: boolean; legislator: boolean; waitUntil: number | null; reported: { question: number[]; answer: number[] } } | null;
	let {
		eventId,
		phase,
		mine,
		electionStopped,
		questions,
		me,
		form,
		questionMax,
		answerMax,
		siteKey
	}: {
		eventId: number;
		phase: TobenState;
		/** 見ている人が告知した議員か */
		mine: boolean;
		electionStopped: boolean;
		questions: TobenQuestionView[];
		me: Me;
		form: Record<string, unknown> | null | undefined;
		questionMax: number;
		answerMax: number;
		siteKey: string;
	} = $props();

	const REASONS = ['attack', 'spam', 'other'] as const;
	const t = ja.toben.questions;
	let token = $state('');
	let turnstile: ReturnType<typeof Turnstile> | undefined = $state();
	let editing = $state<number | null>(null);
	let reporting = $state<string | null>(null);
	let reason = $state('');
	const day = (ms: number) => jaDate(tokyoDate(ms));
	const upcoming = $derived(phase === 'upcoming');
	/** 質問を書く欄を出すか */
	const canAsk = $derived(me !== null && !me.legislator && upcoming && !me.asked && me.waitUntil === null);
	/** 「わたしも聞きたい」を押せるか（自分の質問は別に除く） */
	const canWant = $derived(me !== null && !me.legislator && upcoming);
	/** 答弁を書けるか：告知した議員が、開催中に（選挙期間中は書けない） */
	const canAnswer = $derived(mine && phase === 'live' && me !== null && me.legislator && !electionStopped);
	const askFailure = $derived(form && form.ask && typeof form.message === 'string' ? form.message : null);
	const failureFor = (key: string, id: number) => (form && form[key] === id && typeof form.message === 'string' ? form.message : null);
	const reportKey = (kind: 'question' | 'answer', id: number) => `${kind}-${id}`;
	const reportFailure = (kind: 'question' | 'answer', id: number) => (form && form.reportKind === kind && form.reportTarget === id && typeof form.message === 'string' ? form.message : null);
	const reportDone = (kind: 'question' | 'answer', id: number) => Boolean(form && form.reportKind === kind && form.reportTarget === id && form.reportDone);
	const keep = () => async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => update({ reset: false });
</script>

{#snippet report(kind: 'question' | 'answer', id: number)}
	{#if reportDone(kind, id)}
		<p role="status" class="note">{t.reportDone}</p>
	{:else if me?.reported[kind].includes(id)}
		<p class="note">{t.reportAlready}</p>
	{:else if reporting === reportKey(kind, id)}
		<form method="post" action="?/report" use:enhance={keep} class="report">
			<input type="hidden" name="kind" value={kind} />
			<input type="hidden" name="target" value={id} />
			<fieldset>
				<legend>{t.reportLegend}</legend>
				{#each REASONS as r (r)}
					<label><input type="radio" name="reason" value={r} bind:group={reason} />{ja.report.reasons[r]}</label>
				{/each}
			</fieldset>
			{#if reason === 'other'}
				<label for="toben-report-note-{kind}-{id}">{t.reportNote}</label>
				<textarea id="toben-report-note-{kind}-{id}" name="note" maxlength="200" rows="2"></textarea>
			{/if}
			{#if reportFailure(kind, id)}<p role="alert">{reportFailure(kind, id)}</p>{/if}
			<button>{t.reportSend}</button>
		</form>
	{:else}
		<button type="button" class="link" onclick={() => ((reporting = reportKey(kind, id)), (reason = ''))}>{kind === 'question' ? t.reportQuestion : t.reportAnswer}</button>
	{/if}
{/snippet}

<section class="questions" aria-labelledby="toben-questions-heading">
	<h2 id="toben-questions-heading">{t.heading}</h2>
	<p class="lead">{t.lead}</p>

	{#if phase === 'cancelled' || phase === 'stopped'}
		<p class="note">{t.notOpen}</p>
	{:else if !upcoming}
		<p class="note">{t.closed}</p>
	{:else if me === null}
		<p class="note"><a href="/login?next={encodeURIComponent(`/toben/${eventId}`)}">{t.login}</a>{t.loginNote}</p>
	{:else if me.legislator}
		<p class="note">{t.legislator}</p>
	{:else if me.asked}
		<p class="note">{t.asked}</p>
	{:else if me.waitUntil !== null}
		<p class="note">{t.tooNew(me.waitUntil)}</p>
	{:else if canAsk}
		<form
			method="post"
			action="?/ask"
			use:enhance={() =>
				async ({ update }) => {
					await update({ reset: false });
					turnstile?.reset();
				}}
		>
			<label for="toben-question-body">{t.bodyLabel}</label>
			<!-- 送れなかったときは、書いた本文を残す -->
			<textarea id="toben-question-body" name="body" required maxlength={questionMax} rows="4">{form && typeof form.questionBody === 'string' ? form.questionBody : ''}</textarea>
			<p class="note">{t.bodyNote}</p>
			<Turnstile {siteKey} bind:token bind:this={turnstile} />
			{#if askFailure}<p role="alert">{askFailure}</p>{/if}
			<button class="primary" disabled={!token}>{t.send}</button>
		</form>
	{/if}

	{#if questions.length === 0}
		<p class="empty">{t.empty}</p>
	{/if}
	{#each questions as q (q.id)}
		<article data-question={q.id}>
			<p class="by"><PersonName person={q.person} /> ・ {day(q.createdAt)}</p>
			{#if q.hidden}<p class="note">{t.hiddenMine}</p>{/if}
			<p class="body">{q.body}</p>
			<div class="want">
				<p>{t.wantCount(q.wants)}</p>
				{#if canWant && !q.mine && !q.hidden}
					<form method="post" action="?/want" use:enhance={keep}>
						<input type="hidden" name="question" value={q.id} />
						<input type="hidden" name="op" value={q.wanted ? 'remove' : 'add'} />
						<button aria-pressed={q.wanted}>{t.want}</button>
					</form>
				{/if}
			</div>
			{#if failureFor('wantQuestion', q.id)}<p role="alert">{failureFor('wantQuestion', q.id)}</p>{/if}
			{#if me && !q.mine && !q.hidden}{@render report('question', q.id)}{/if}

			{#if q.answer}
				<section class="answer" aria-labelledby="toben-answer-{q.id}">
					<h3 id="toben-answer-{q.id}">{t.answerHeading}</h3>
					<p class="by"><PersonName person={q.answer.person} />{#if q.answer.editedAt} ・ {t.edited(tokyoDate(q.answer.editedAt))}{/if}</p>
					{#if q.answer.hidden}<p class="note">{t.answerHiddenMine}</p>{/if}
					<p class="body">{q.answer.body}</p>
					{#if me && !q.answer.mine && !q.answer.hidden}{@render report('answer', q.answer.id)}{/if}
				</section>
			{/if}
			{#if canAnswer && !q.hidden && !q.answer?.hidden}
				{#if q.answer && editing !== q.id}
					<button type="button" onclick={() => (editing = q.id)}>{t.answerEdit}</button>
				{:else}
					<form
						method="post"
						action="?/answer"
						use:enhance={() =>
							async ({ result, update }) => {
								await update({ reset: false });
								if (result.type === 'success') editing = null;
							}}
					>
						<input type="hidden" name="question" value={q.id} />
						<label for="toben-answer-body-{q.id}">{t.answerLabel}</label>
						<textarea id="toben-answer-body-{q.id}" name="body" required maxlength={answerMax} rows="5"
							>{form && form.answerQuestion === q.id && typeof form.answerBody === 'string' ? form.answerBody : (q.answer?.body ?? '')}</textarea
						>
						{#if failureFor('answerQuestion', q.id)}<p role="alert">{failureFor('answerQuestion', q.id)}</p>{/if}
						<button class="primary">{t.answerSend}</button>
					</form>
				{/if}
			{/if}
		</article>
	{/each}
</section>

<style>
	.questions {
		margin-top: 2rem;
	}

	h2 {
		font-size: var(--font-size-heading);
	}

	h3 {
		margin: 0;
		font-size: var(--font-size-sub);
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

	.want {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		align-items: center;
	}

	.want p {
		margin: 0;
		font-size: var(--font-size-sub);
	}

	.answer {
		margin-top: 0.75rem;
		padding: 0.5rem 0.75rem;
		border-left: 3px solid var(--color-base);
		background: var(--color-surface);
	}

	form {
		display: grid;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}

	.want form {
		margin-top: 0;
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

	button[aria-pressed='true'] {
		border-color: var(--color-base);
		font-weight: 700;
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
