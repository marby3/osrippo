<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import Turnstile from '#lib/components/Turnstile.svelte';
	import { ja } from '#lib/copy/ja.ts';
	import { ISSUE_MAX, type IssueError, type IssueField } from '#lib/domain/issues.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/** 欄ごとの段（サーバーで誤りが返ったら、誤りのある最初の欄の段を開く） */
	const STEP_OF: Record<IssueField, number> = { title: 1, affected: 2, example: 2, topic: 2 };
	const MAX: Partial<Record<IssueField, number>> = ISSUE_MAX;

	// svelte-ignore state_referenced_locally
	const initial = form && 'values' in form ? form.values : undefined;
	let title = $state(initial?.title ?? '');
	let affected = $state(initial?.affected ?? '');
	let example = $state(initial?.example ?? '');
	let topic = $state(initial?.topic ?? '');
	let step = $state(1);
	let token = $state('');
	let turnstile: ReturnType<typeof Turnstile> | undefined = $state();
	/** JS がなければ段を分けず、全部を縦に並べる */
	let js = $state(false);
	let sections: HTMLElement[] = $state([]);

	const errors = $derived<Partial<Record<IssueField, IssueError>>>((form && 'errors' in form ? form.errors : undefined) ?? {});
	const message = $derived(form && 'message' in form ? form.message : undefined);
	const errorText = (field: IssueField) => {
		const e = errors[field];
		if (!e) return undefined;
		return e === 'tooLong' ? ja.issue.errors.tooLong(MAX[field] ?? 0) : ja.issue.errors[e];
	};

	onMount(() => {
		js = true;
	});

	// 似た課題（設計書 docs/spec/30.md 決めたこと2）。0.4秒打たなかったら問い合わせ、古い答えは捨てる
	type Similar = { id: number; title: string; supports: number };
	let similar: Similar[] = $state([]);
	let supportError = $state('');
	let asked = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	function findSimilar() {
		clearTimeout(timer);
		const q = title;
		const mine = ++asked;
		timer = setTimeout(async () => {
			if (!q.trim()) {
				similar = [];
				return;
			}
			try {
				const res = await fetch('/kadai/nita', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ q })
				});
				if (mine !== asked) return;
				// 答えを入れ替えたら、前のカードの断り文は消す。失敗したら古い候補も消す（似た課題は出なくても書ける）
				supportError = '';
				similar = res.ok ? ((await res.json()) as { issues: Similar[] }).issues : [];
			} catch {
				if (mine === asked) similar = [];
			}
		}, 400);
	}

	/** 「これに『わかる』を付ける」：その課題の「わかる」を通ったら、その課題のページへ */
	const supportThis = (id: number) => () => async ({ result }: { result: { type: string; data?: Record<string, unknown>; location?: string } }) => {
		if (result.type === 'success') await goto(`/kadai/${id}`);
		else if (result.type === 'redirect' && result.location) await goto(result.location);
		else supportError = String(result.data?.message ?? ja.similar.failed);
	};

	/** その段の欄をブラウザの検証で確かめてから進む */
	function next() {
		const fields = sections[step - 1].querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea');
		for (const f of fields) if (!f.reportValidity()) return;
		step += 1;
	}
</script>

<svelte:head>
	<title>{ja.issue.writePageTitle}</title>
</svelte:head>

<main>
	<h1>{ja.issue.write}</h1>
	<ol class="steps">
		{#each ja.issue.steps as label, i (label)}
			<li aria-current={js && step === i + 1 ? 'step' : undefined}>{i + 1} {label}</li>
		{/each}
	</ol>

	<form
		method="post"
		use:enhance={() =>
			async ({ result, update }) => {
				await update({ reset: false });
				if (result.type === 'failure') {
					const fields = Object.keys(errors) as IssueField[];
					step = fields.length ? Math.min(...fields.map((f) => STEP_OF[f])) : 3;
				}
				// 失敗でも 500 などでも、トークンはサーバーで使い終わっている
				if (result.type !== 'redirect') turnstile?.reset();
			}}
	>
		<section bind:this={sections[0]} hidden={js && step !== 1}>
			<label for="title">{ja.issue.titleLabel}</label>
			<input
				id="title"
				name="title"
				bind:value={title}
				oninput={findSimilar}
				required
				maxlength={ISSUE_MAX.title}
				aria-invalid={errors.title ? 'true' : undefined}
				aria-describedby={errors.title ? 'title-error' : undefined}
			/>
			{#if errors.title}<p id="title-error" class="error">{errorText('title')}</p>{/if}
			{#if js}
				<div class="buttons">
					<button type="button" class={similar.length ? '' : 'primary'} onclick={next}
						>{similar.length ? ja.similar.nextDifferent : ja.issue.next}</button
					>
					<a href="/kadai">{ja.issue.cancel}</a>
				</div>
			{/if}
		</section>

		<section bind:this={sections[1]} hidden={js && step !== 2}>
			<label for="affected">{ja.issue.affectedLabel}</label>
			<input
				id="affected"
				name="affected"
				bind:value={affected}
				required
				maxlength={ISSUE_MAX.affected}
				aria-invalid={errors.affected ? 'true' : undefined}
				aria-describedby={errors.affected ? 'affected-error' : undefined}
			/>
			{#if errors.affected}<p id="affected-error" class="error">{errorText('affected')}</p>{/if}

			<label for="example">{ja.issue.exampleLabel}</label>
			<textarea
				id="example"
				name="example"
				bind:value={example}
				required
				maxlength={ISSUE_MAX.example}
				rows="6"
				aria-invalid={errors.example ? 'true' : undefined}
				aria-describedby={errors.example ? 'example-error' : undefined}
			></textarea>
			{#if errors.example}<p id="example-error" class="error">{errorText('example')}</p>{/if}

			<fieldset aria-describedby={errors.topic ? 'topic-error' : undefined}>
				{#if data.topic}
					<legend>{ja.issue.topicLegend(data.topic.name)}</legend>
					<label class="radio">
						<input type="radio" name="topic" value={String(data.topic.id)} bind:group={topic} required />
						{ja.issue.topicYes(data.topic.name)}
					</label>
				{/if}
				<label class="radio">
					<input type="radio" name="topic" value="none" bind:group={topic} required />
					{ja.issue.topicNo}
				</label>
			</fieldset>
			{#if errors.topic}<p id="topic-error" class="error">{errorText('topic')}</p>{/if}
			{#if js}
				<div class="buttons">
					<button type="button" class="primary" onclick={next}>{ja.issue.next}</button>
					<button type="button" onclick={() => (step = 1)}>{ja.issue.back}</button>
				</div>
			{/if}
		</section>

		<section bind:this={sections[2]} hidden={js && step !== 3}>
			{#if js}
				<p>{ja.issue.confirmLead}</p>
				<dl>
					<dt>{ja.issue.titleLabel}</dt>
					<dd>{title}</dd>
					<dt>{ja.issue.affectedLabel}</dt>
					<dd>{affected}</dd>
					<dt>{ja.issue.exampleLabel}</dt>
					<dd class="example">{example}</dd>
					<dt>{ja.issue.columnTopic}</dt>
					<dd>{data.topic && topic === String(data.topic.id) ? data.topic.name : ja.issue.topicNo}</dd>
				</dl>
			{/if}
			<Turnstile siteKey={data.siteKey} bind:token bind:this={turnstile} />
			{#if message}<p role="alert" class="error">{message}</p>{/if}
			<div class="buttons">
				<button class="primary" disabled={!token}>{ja.issue.submit}</button>
				{#if js}<button type="button" onclick={() => (step = 2)}>{ja.issue.back}</button>{/if}
			</div>
		</section>
	</form>

	<!-- 主のフォームの中にフォームは置けないので、似た課題の欄は外に置く（PC は右に並べる） -->
	<!-- 打っている間に現れるので、読み上げにも知らせる（aria-live の入れ物はいつも置く） -->
	<div class="similar-live" aria-live="polite">
	{#if js && step === 1 && similar.length}
		<aside class="similar">
			<h2>{ja.similar.heading}</h2>
			<p>{ja.similar.lead}</p>
			<ul>
				{#each similar as s, i (s.id)}
					<li class="card" class:top={i === 0}>
						<a href="/kadai/{s.id}">{s.title}</a>
						<p>{ja.similar.supports(s.supports)}</p>
						{#if i === 0}
							<form method="post" action="/kadai/{s.id}?/support" use:enhance={supportThis(s.id)}>
								<input type="hidden" name="op" value="add" />
								<button class="primary">{ja.similar.supportThis}</button>
							</form>
							{#if supportError}<p role="alert" class="error">{supportError}</p>{/if}
						{/if}
					</li>
				{/each}
			</ul>
		</aside>
	{/if}
	</div>
</main>

<style>
	main {
		max-width: 40rem;
		margin: 0 auto;
		padding: 1rem;
	}

	.similar {
		margin-top: 1.5rem;
		padding: 1rem;
		border-radius: var(--radius-l);
		background: var(--color-surface);
	}

	.similar h2 {
		margin: 0;
		font-size: var(--font-size-heading);
	}

	.similar ul {
		display: grid;
		gap: 0.75rem;
		padding: 0;
		list-style: none;
	}

	.card {
		display: grid;
		gap: 0.25rem;
		padding: 1rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-l);
		background: var(--color-bg);
	}

	.card.top {
		border: 2px solid var(--color-base);
	}

	.card a {
		color: var(--color-text);
		font-weight: bold;
	}

	.card p {
		margin: 0;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	.card button {
		width: 100%;
	}

	/* PC は似た課題を右に並べる（PcIssueNew） */
	@media (min-width: 64rem) {
		main {
			display: grid;
			grid-template-columns: minmax(0, 1fr) 24rem;
			column-gap: 3rem;
			max-width: 76rem;
		}

		main > :not(.similar-live) {
			grid-column: 1;
		}

		.similar-live {
			grid-column: 2;
			grid-row: 1 / span 3;
			align-self: start;
			margin-top: 0;
		}
	}

	h1 {
		font-size: var(--font-size-page-title);
	}

	.steps {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.25rem;
		padding: 0;
		list-style: none;
		font-size: var(--font-size-sub);
		color: var(--color-text-sub);
	}

	.steps li {
		border-top: 4px solid var(--color-divider);
		padding-top: 0.25rem;
	}

	.steps li[aria-current='step'] {
		border-color: var(--color-base);
		color: var(--color-text);
		font-weight: bold;
	}

	section {
		display: grid;
		gap: 0.5rem;
	}

	section[hidden] {
		display: none;
	}

	label {
		font-weight: bold;
		margin-top: 0.75rem;
	}

	input:not([type='radio']),
	textarea {
		min-height: var(--tap-min);
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-m);
		font: inherit;
	}

	fieldset {
		margin-top: 0.75rem;
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
		margin: 0;
		font-weight: normal;
	}

	.example {
		white-space: pre-wrap;
	}

	dt {
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	dd {
		margin: 0 0 0.75rem;
	}

	.error {
		margin: 0;
		color: var(--color-caution);
		font-size: var(--font-size-sub);
	}

	.buttons {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-top: 1rem;
	}

	button {
		min-height: var(--tap-secondary);
		padding: 0 1.25rem;
		border: 1px solid var(--color-base);
		border-radius: var(--radius-m);
		background: var(--color-bg);
		color: var(--color-base);
		font: inherit;
		font-weight: bold;
	}

	.primary {
		background: var(--color-base);
		color: var(--color-bg);
	}

	button:disabled {
		opacity: 0.5;
	}
</style>
