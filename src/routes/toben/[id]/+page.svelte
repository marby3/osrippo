<!-- 答弁イベントのページ（Issue #153）。質問と答弁は #181 -->
<script lang="ts">
	import { enhance } from '$app/forms';
	import PersonName from '#lib/components/PersonName.svelte';
	import TobenQuestions from '#lib/components/TobenQuestions.svelte';
	import { ja } from '#lib/copy/ja.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const e = $derived(data.e);
</script>

<svelte:head>
	<title>{ja.toben.pageTitle(e.title)}</title>
</svelte:head>

<main class="frame">
	<p class="crumb"><a href="/toben">{ja.toben.heading}</a></p>
	<h1>{e.title}</h1>
	<p class="state" data-phase={e.state}>{ja.toben.states[e.state]}</p>
	<dl>
		<dt>{ja.toben.legislator}</dt>
		<dd><PersonName person={e.person} /></dd>
		<dt>{ja.toben.target[e.targetKind]}</dt>
		<dd>{#if e.targetTitle}<a href={e.targetKind === 'issue' ? `/kadai/${e.targetId}` : `/houan/${e.targetId}`}>{e.targetTitle}</a>{:else}{ja.toben.targetMissing}{/if}</dd>
		<dt>{ja.toben.dateLabel}</dt>
		<dd>{ja.toben.when(e.startsAt, e.endsAt)}</dd>
	</dl>
	{#if e.cancellable && !data.electionStopped}
		<form method="post" action="?/cancel" use:enhance>
			{#if form && 'message' in form && !('ask' in form) && !('wantQuestion' in form) && !('answerQuestion' in form) && !('reportKind' in form)}<p role="alert">{form.message}</p>{/if}
			<button>{ja.toben.cancel}</button>
		</form>
	{/if}
	<TobenQuestions
		eventId={e.id}
		phase={e.state}
		mine={e.mine}
		electionStopped={data.electionStopped}
		questions={data.questions}
		me={data.me}
		{form}
		questionMax={data.questionMax}
		answerMax={data.answerMax}
		siteKey={data.siteKey}
	/>
</main>

<style>
	main {
		padding-top: 1rem;
		padding-bottom: 2rem;
	}

	h1 {
		font-size: var(--font-size-page-title);
	}

	.crumb,
	dt {
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	.state {
		display: inline-block;
		padding: 0.125rem 0.5rem;
		border-radius: var(--radius-s);
		background: var(--color-surface);
		font-weight: 700;
	}

	dl {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.5rem 1rem;
	}

	dd {
		margin: 0;
	}

	button {
		min-height: var(--tap-min);
		padding: 0 1rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-m);
		background: var(--color-bg);
		font: inherit;
	}
</style>
