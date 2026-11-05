<script lang="ts">
	// 「筋が通っている」「考えが変わった」（SpBillQA・PcBillQA）。押された数は出さない。
	// ログインしていなければ、押すとログインの画面へ
	import { enhance } from '$app/forms';
	import { ja } from '../copy/ja';
	import { EVALUATION_KINDS, type EvaluationKind } from '../domain/evaluations';

	let {
		postId,
		pressed,
		loggedIn,
		onlyPressed = false,
		back,
		message,
		onpress
	}: {
		postId: number;
		pressed: Record<EvaluationKind, boolean>;
		loggedIn: boolean;
		/** 答弁がついたあとの質疑：押したものだけを出す（取り消せるように） */
		onlyPressed?: boolean;
		back: string;
		message?: string;
		onpress?: () => void;
	} = $props();

	const kinds = $derived(EVALUATION_KINDS.filter((kind) => !onlyPressed || pressed[kind]));
</script>

{#if kinds.length > 0}
	<div class="buttons">
		{#each kinds as kind (kind)}
			{#if loggedIn}
				<form
					method="post"
					action="?/evaluate"
					use:enhance={() => {
						onpress?.();
						return async ({ update }) => update({ reset: false });
					}}
				>
					<input type="hidden" name="post" value={postId} />
					<input type="hidden" name="kind" value={kind} />
					<input type="hidden" name="op" value={pressed[kind] ? 'remove' : 'add'} />
					<button aria-pressed={pressed[kind]}>{ja.post.evaluations[kind]}</button>
				</form>
			{:else}
				<form method="get" action="/login">
					<input type="hidden" name="next" value={back} />
					<button aria-pressed="false">{ja.post.evaluations[kind]}</button>
				</form>
			{/if}
		{/each}
	</div>
	{#if message}<p role="alert" class="error">{message}</p>{/if}
{/if}

<style>
	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}

	button {
		min-height: var(--tap-min);
		padding: 0 1rem;
		border: 1px solid var(--color-text-sub);
		border-radius: var(--radius-pill);
		background: var(--color-bg);
		color: var(--color-text);
		font: inherit;
	}

	button[aria-pressed='true'] {
		border-color: var(--color-base);
		background: var(--color-base);
		color: var(--color-bg);
		font-weight: bold;
	}

	.error {
		margin: 0.5rem 0 0;
		color: var(--color-caution);
		font-size: var(--font-size-sub);
	}
</style>
