<script lang="ts">
	// 質疑のカード（SpBillQA・PcBillQA）。答弁はスマホでは開くと出て、PC は最初から出ている（ボタンは CSS で隠す）。
	// 答弁と補足の欄はカードの中に開く。失敗したら、そのカードの欄に入力を残して誤りを出す
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { ja } from '../copy/ja';
	import { POST_MAX, type PostRole } from '../domain/posts';
	import type { IssueError } from '../domain/issues';
	import Turnstile from './Turnstile.svelte';

	type Question = {
		id: number;
		body: string;
		mine: boolean;
		answers: { id: number; role: PostRole; body: string }[];
		supplements: { id: number; body: string }[];
	};
	type Failure = { question: number | null; body: string; error?: IssueError; message?: string };

	let {
		question,
		role,
		loggedIn,
		waiting,
		canAnswer,
		canSupplement,
		siteKey,
		failure,
		afterReply,
		back
	}: {
		question: Question;
		role: PostRole | null;
		loggedIn: boolean;
		/** 登録から7日たっていない */
		waiting: boolean;
		canAnswer: boolean;
		canSupplement: boolean;
		siteKey: string;
		failure: Failure | null;
		/** 書けたあとで移る先。なければ今のページを読み直す */
		afterReply: string | null;
		back: string;
	} = $props();

	const failedHere = $derived(failure?.question === question.id);
	const hasAnswers = $derived(question.answers.length > 0);
	// 答弁できる人には答弁、ほかの人には補足。提出者と賛同者は自分の質疑にどちらも書けない
	const kind = $derived(role !== null ? (question.mine || !canAnswer ? null : 'answer') : canSupplement && !waiting ? 'supplement' : null);
	const label = $derived(kind === 'answer' ? ja.post.answerField : ja.post.supplementField);
	const openLabel = $derived(kind === 'answer' ? ja.post.answer : ja.post.supplement);
	const errorText = $derived.by(() => {
		const e = failedHere ? failure?.error : undefined;
		if (!e || !kind) return undefined;
		return e === 'tooLong' ? ja.issue.errors.tooLong(POST_MAX[kind]) : ja.issue.errors[e];
	});

	let answersOpen = $state(false);
	let writing = $state(false);
	let edited = $state<string | null>(null);
	let token = $state('');
	let turnstile: ReturnType<typeof Turnstile> | undefined = $state();
	/** 失敗したカードは欄を開いて入力を残す */
	const open = $derived(writing || failedHere);
	const body = $derived(edited ?? (failedHere ? (failure?.body ?? '') : ''));
	const toggleLabel = $derived(question.answers.length > 1 ? ja.post.readAnswers(question.answers.length) : ja.post.readAnswer(ja.post.roles[question.answers[0]?.role ?? 'author']));
	const fieldId = $derived(`reply-${question.id}`);
</script>

<article id="shitsugi-{question.id}">
	<p class="body">{question.body}</p>

	{#if hasAnswers}
		<button type="button" class="toggle" aria-expanded={answersOpen} onclick={() => (answersOpen = !answersOpen)}>{toggleLabel}</button>
		<div class="answers" class:open={answersOpen}>
			{#each question.answers as answer (answer.id)}
				<section class="answer">
					<h3>{ja.post.answerHeading(ja.post.roles[answer.role])}</h3>
					<p class="body">{answer.body}</p>
				</section>
			{/each}
		</div>
	{:else}
		<p class="waiting">{ja.post.waiting}</p>
	{/if}

	{#each question.supplements as supplement (supplement.id)}
		<section class="supplement">
			<h3>{ja.post.supplementHeading}</h3>
			<p class="body">{supplement.body}</p>
		</section>
	{/each}

	{#if !loggedIn && canSupplement}
		<!-- ログインしていなければ、押すとログインの画面へ -->
		<form method="get" action="/login" class="actions">
			<input type="hidden" name="next" value={back} />
			<button>{ja.post.supplement}</button>
		</form>
	{:else if kind && !waiting}
		{#if open}
			<form
				method="post"
				action="?/{kind}"
				class="reply"
				use:enhance={() =>
					async ({ result, update }) => {
						// トークンは1回しか使えない。書けたら欄を閉じて捨て、断られたら作り直す
						if (result.type === 'success') {
							writing = false;
							edited = null;
							token = '';
							if (afterReply) return goto(afterReply, { invalidateAll: true });
							await update({ reset: false });
						} else {
							await update({ reset: false });
							writing = true;
							turnstile?.reset();
						}
					}}
			>
				<input type="hidden" name="question" value={question.id} />
				<label for={fieldId}>{label}</label>
				<textarea
					id={fieldId}
					name="body"
					rows="4"
					required
					maxlength={POST_MAX[kind]}
					value={body}
					oninput={(e) => (edited = e.currentTarget.value)}
					aria-invalid={errorText ? 'true' : undefined}
					aria-describedby={errorText ? `${fieldId}-error` : undefined}
				></textarea>
				{#if errorText}<p id="{fieldId}-error" class="error">{errorText}</p>{/if}
				<Turnstile {siteKey} bind:token bind:this={turnstile} />
				{#if failedHere && failure?.message}<p role="alert" class="error">{failure.message}</p>{/if}
				<button class="primary" disabled={!token}>{ja.post.send}</button>
			</form>
		{:else}
			<div class="actions">
				<button type="button" onclick={() => (writing = true)}>{openLabel}</button>
			</div>
		{/if}
	{/if}
</article>

<style>
	article {
		padding: 1rem;
		border: 1px solid var(--color-divider);
		border-radius: var(--radius-l);
	}

	.body {
		margin: 0;
		white-space: pre-line;
		overflow-wrap: anywhere;
	}

	h3 {
		margin: 0;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	.waiting {
		margin: 0.75rem 0 0;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
		font-weight: bold;
	}

	.toggle {
		width: 100%;
		min-height: var(--tap-min);
		margin-top: 0.75rem;
		padding: 0 0.75rem;
		border: 0;
		border-radius: var(--radius-m);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		text-align: left;
	}

	/* 案の開閉の印 */
	.toggle::after {
		content: '';
		float: right;
		width: 0.5rem;
		height: 0.5rem;
		margin: 0.5rem 0.25rem 0 0;
		border-right: 2px solid var(--color-text);
		border-bottom: 2px solid var(--color-text);
		transform: rotate(45deg);
	}

	.toggle[aria-expanded='true']::after {
		margin-top: 0.75rem;
		transform: rotate(-135deg);
	}

	.answers {
		display: none;
	}

	.answers.open {
		display: block;
	}

	.answer,
	.supplement {
		margin-top: 0.75rem;
		padding: 0.5rem 1rem;
		border-left: 3px solid var(--color-divider);
		background: var(--color-surface);
	}

	.answer {
		border-left-color: var(--color-base);
	}

	.actions {
		margin-top: 0.75rem;
	}

	.actions button,
	.reply button {
		min-height: var(--tap-min);
		padding: 0 1rem;
		border: 1px solid var(--color-text-sub);
		border-radius: var(--radius-pill);
		background: var(--color-bg);
		color: var(--color-text);
		font: inherit;
	}

	.reply {
		display: grid;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}

	.reply label {
		font-weight: bold;
	}

	.reply textarea {
		width: 100%;
		box-sizing: border-box;
		font: inherit;
	}

	.reply .primary {
		border-color: var(--color-base);
		background: var(--color-base);
		color: var(--color-bg);
		font-weight: bold;
	}

	.reply .primary:disabled {
		opacity: 0.5;
	}

	.error {
		margin: 0;
		color: var(--color-caution);
		font-size: var(--font-size-sub);
	}

	@media (min-width: 64rem) {
		/* PC は案（PcBillQA）のとおり区切り線 */
		article {
			padding: 1rem 0;
			border-width: 0 0 1px;
			border-radius: 0;
		}

		.toggle {
			display: none;
		}

		.answers {
			display: block;
		}
	}
</style>
