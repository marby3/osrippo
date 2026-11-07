<script lang="ts">
	// 投稿か修正案1件の通報（設計書 docs/spec/80.md 決めたこと8、docs/spec/103.md 決めたこと7）。カードの件数に上限がないので、水和でレイアウトがずれないよう details で開く（JS がなくても開ける）
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import { ja } from '../copy/ja';
	import { SOLUTION_REPORT_REASONS } from '../domain/reports';

	let {
		target,
		label,
		loggedIn,
		back,
		reported,
		done,
		message,
		action = 'reportPost',
		field = 'post',
		criteria = ja.report.postCriteria
	}: {
		/** 投稿か修正案の番号 */
		target: number;
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
		/** 送り先（修正案は reportAmendment） */
		action?: string;
		/** 番号の欄の名前（修正案は amendment） */
		field?: string;
		/** 非表示の基準の文 */
		criteria?: string;
	} = $props();

	let js = $state(false);
	let reason = $state('');
	/** 通ったときの知らせ。一覧を読み直さず、ほかの投稿を通報してもここに残す */
	let sent = $state<string | undefined>();
	onMount(() => {
		js = true;
	});
</script>

<div class="post-report">
	{#if message}<p role="alert" class="refused">{message}</p>{/if}
	{#if done || sent}
		<p role="status" class="sub">{done ?? sent}</p>
	{:else if reported}
		<p class="sub">{ja.post.reportAlready}</p>
	{:else if !loggedIn}
		<form method="get" action="/login">
			<input type="hidden" name="next" value={back} />
			<button class="link">{label}</button>
		</form>
	{:else}
		<details>
			<summary>{label}</summary>
			<!-- 通っても一覧を読み直さない（2ページ目の最後のカードが消えると、読み直しが 404 になる）。カードは次に開いたときに消える -->
			<form method="post" action="?/{action}" use:enhance={() => async ({ result, update }) => {
					await update({ invalidateAll: false });
					if (result.type === 'success') sent = result.data?.reportMessage as string | undefined;
				}} class="report">
				<input type="hidden" name={field} value={target} />
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
					<label for="{field}-report-note-{target}">{ja.report.noteLabel}</label>
					<textarea id="{field}-report-note-{target}" name="note" maxlength="200" rows="3"></textarea>
				{/if}
				<p class="sub">{criteria} <a href="/unei">{ja.report.criteriaLink}</a></p>
				<button class="submit">{ja.report.submit}</button>
			</form>
		</details>
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

	summary {
		display: flex;
		align-items: center;
		width: fit-content;
		min-height: var(--tap-min);
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
		text-decoration: underline;
		cursor: pointer;
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
