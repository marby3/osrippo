<script lang="ts">
	// 質疑のカード（SpBillQA・PcBillQA）。答弁はスマホでは開くと出て、PC は最初から出ている（ボタンは CSS で隠す）。
	// 答弁と補足の欄はカードの中に開く。失敗したら、そのカードの欄に入力を残して誤りを出す
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { ja } from '../copy/ja';
	import { POST_MAX, type PostRole } from '../domain/posts';
	import type { EvaluationKind } from '../domain/evaluations';
	import type { IssueError } from '../domain/issues';
	import EvaluationButtons from './EvaluationButtons.svelte';
	import { readWhenSeen, type ReadTracker } from './read-tracker';
	import Turnstile from './Turnstile.svelte';

	type Pressed = Record<EvaluationKind, boolean>;
	type Question = {
		id: number;
		billId: number;
		body: string;
		mine: boolean;
		pressed: Pressed;
		answers: { id: number; role: PostRole; body: string; mine: boolean; pressed: Pressed }[];
		supplements: { id: number; body: string }[];
	};
	type Failure = { question: number | null; body: string; error?: IssueError; message?: string };

	let {
		question,
		relatedBill = null,
		role,
		loggedIn,
		waiting,
		canAnswer,
		canSupplement,
		siteKey,
		failure,
		afterReply,
		back,
		evaluationShown,
		evaluationFailure,
		track
	}: {
		question: Question;
		/** 関連法案の質疑のとき、その法案。読むだけで、リンクからその法案へ移って書く */
		relatedBill?: { id: number; title: string } | null;
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
		/** 評価のボタンを出すか（時期の中で、登録から7日未満でない） */
		evaluationShown: boolean;
		evaluationFailure: { post: number; message: string } | null;
		/** 読んだ記録を取るときだけ渡す */
		track: ReadTracker | null;
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
	const messageFor = (id: number) => (evaluationFailure?.post === id ? evaluationFailure.message : undefined);
	/** 読んだ記録を取る投稿。自分の投稿と、答弁のある質疑（押せないので）は取らない */
	const trackIf = (id: number, shouldTrack: boolean) => (track && shouldTrack ? { tracker: track, id } : null);

	function toggleAnswers() {
		answersOpen = !answersOpen;
		// 開いたら、カードの答弁をすぐに読んだことにする
		if (answersOpen && track) for (const a of question.answers) if (!a.mine) track.mark(a.id);
	}
</script>

<article id="shitsugi-{question.id}">
	{#if relatedBill}<p class="from"><a href="/houan/{relatedBill.id}/shitsugi#shitsugi-{question.id}">{ja.post.fromBill(relatedBill.title)}</a></p>{/if}
	<p class="body" use:readWhenSeen={trackIf(question.id, !hasAnswers && !question.mine)}>{question.body}</p>

	{#if evaluationShown && hasAnswers && !question.mine}
		<!-- 答弁がつく前に質疑に押した人が、取り消せるように -->
		<EvaluationButtons postId={question.id} pressed={question.pressed} {loggedIn} onlyPressed {back} message={messageFor(question.id)} />
	{/if}

	{#if hasAnswers}
		<button type="button" class="toggle" aria-expanded={answersOpen} onclick={toggleAnswers}>{toggleLabel}</button>
		<div class="answers" class:open={answersOpen}>
			{#each question.answers as answer (answer.id)}
				<section class="answer" use:readWhenSeen={trackIf(answer.id, !answer.mine)}>
					<h3>{ja.post.answerHeading(ja.post.roles[answer.role])}</h3>
					<p class="body">{answer.body}</p>
					{#if evaluationShown && question.answers.length > 1 && !answer.mine}
						<EvaluationButtons postId={answer.id} pressed={answer.pressed} {loggedIn} {back} message={messageFor(answer.id)} />
					{/if}
				</section>
			{/each}
		</div>
		{#if evaluationShown && question.answers.length === 1 && !question.answers[0].mine}
			<!-- 案のとおり開閉の外に置く。閉じたまま押したら、評価した答弁が読めるように開く -->
			<EvaluationButtons
				postId={question.answers[0].id}
				pressed={question.answers[0].pressed}
				{loggedIn}
				{back}
				message={messageFor(question.answers[0].id)}
				onpress={() => (answersOpen = true)}
			/>
		{/if}
	{:else}
		<p class="waiting">{ja.post.waiting}</p>
		{#if evaluationShown && !question.mine}
			<EvaluationButtons postId={question.id} pressed={question.pressed} {loggedIn} {back} message={messageFor(question.id)} />
		{/if}
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

	.from {
		margin: 0 0 0.5rem;
		font-size: var(--font-size-sub);
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
