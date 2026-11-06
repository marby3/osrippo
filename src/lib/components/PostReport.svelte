<script lang="ts">
	// 投稿1件の通報（設計書 docs/spec/80.md 決めたこと8）。開き方は解決策と同じで、JS がなければ欄を最初から開く
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import { ja } from '../copy/ja';
	import { SOLUTION_REPORT_REASONS } from '../domain/reports';

	let {
		post,
		label,
		loggedIn,
		back,
		reported,
		done,
		message
	}: {
		post: number;
		/** 開くボタンの名前（この質疑を通報する、など） */
		label: string;
		loggedIn: boolean;
		/** ログインしていないとき、ログインのあとに戻るパス */
		back: string;
		/** 見ている人が通報済みか */
		reported: boolean;
		/** 受け付けた知らせ */
		done?: string;
		/** 断った理由 */
		message?: string;
	} = $props();

	let js = $state(false);
	let open = $state(false);
	let reason = $state('');
	onMount(() => {
		js = true;
	});
</script>

<div class="post-report">
	{#if message}<p role="alert" class="refused">{message}</p>{/if}
	{#if done}
		<p role="status" class="sub">{done}</p>
	{:else if reported}
		<p class="sub">{ja.post.reportAlready}</p>
	{:else if !loggedIn}
		<form method="get" action="/login">
			<input type="hidden" name="next" value={back} />
			<button class="link">{label}</button>
		</form>
	{:else}
		{#if js && !open}
			<button type="button" class="link" onclick={() => (open = true)}>{label}</button>
		{/if}
		{#if !js || open}
			<form method="post" action="?/reportPost" use:enhance class="report">
				<input type="hidden" name="post" value={post} />
				<fieldset>
					<legend>{ja.report.legend}</legend>
					{#each SOLUTION_REPORT_REASONS as value (value)}
						<label class="radio">
							<input type="radio" name="reason" {value} bind:group={reason} />
							{ja.report.reasons[value]}
						</label>
					{/each}
				</fieldset>
				{#if !js || reason === 'other'}
					<label for="post-report-note-{post}">{ja.report.noteLabel}</label>
					<textarea id="post-report-note-{post}" name="note" maxlength="200" rows="3"></textarea>
				{/if}
				<p class="sub">{ja.report.postCriteria} <a href="/unei">{ja.report.criteriaLink}</a></p>
				<button class="submit">{ja.report.submit}</button>
			</form>
		{/if}
	{/if}
</div>

<style>
	.post-report {
		margin-top: 0.25rem;
	}

	.refused {
		margin: 0;
		color: var(--color-caution);
		font-size: var(--font-size-sub);
	}

	.sub {
		margin: 0;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	.link {
		min-height: var(--tap-min);
		padding: 0;
		border: none;
		background: none;
		color: var(--color-text-sub);
		font: inherit;
		font-size: var(--font-size-sub);
		text-decoration: underline;
	}

	.report {
		display: grid;
		gap: 0.5rem;
		font-size: var(--font-size-sub);
	}

	fieldset {
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
	}

	textarea {
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-m);
		font: inherit;
	}

	.submit {
		justify-self: start;
		min-height: var(--tap-min);
		padding: 0 1.25rem;
		border: 1px solid var(--color-base);
		border-radius: var(--radius-m);
		background: var(--color-bg);
		color: var(--color-base);
		font: inherit;
		font-weight: bold;
	}
</style>
