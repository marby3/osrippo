<script lang="ts">
	// 解決策1件（設計書 docs/spec/34.md 決めたこと3〜5）。課題のページと解決策の一覧で使う
	import { enhance } from '$app/forms';
	import { ja } from '#lib/copy/ja.ts';
	import { REACTIONS } from '#lib/domain/solutions.ts';

	type Solution = {
		id: number;
		body: string;
		support: number;
		changed: number;
		mine: boolean;
		pressed: { support: boolean; changed: boolean };
	};
	let {
		solution,
		loggedIn,
		readonly = false,
		back,
		message
	}: {
		solution: Solution;
		loggedIn: boolean;
		/** 非表示の課題を本人・運営が見るとき：ボタンの代わりに数だけ */
		readonly?: boolean;
		/** ログインしていないとき、ログインのあとに戻るパス */
		back: string;
		/** この解決策への操作を断った理由 */
		message?: string;
	} = $props();

	const label = (kind: (typeof REACTIONS)[number]) =>
		kind === 'support' ? ja.solution.support(solution.support) : ja.solution.changed(solution.changed);
</script>

<article id="kaiketsu-{solution.id}">
	<p id="kaiketsu-body-{solution.id}" class="body">{solution.body}</p>
	<div class="reactions">
		{#if solution.mine || readonly}
			<!-- 自分の解決策には押せない。数だけを出す -->
			{#each REACTIONS as kind (kind)}<span class="count">{label(kind)}</span>{/each}
		{:else if !loggedIn}
			<!-- ログインしていなければ、押すとログインの画面へ（JS がなくても動く） -->
			<form method="get" action="/login">
				<input type="hidden" name="next" value={back} />
				{#each REACTIONS as kind (kind)}
					<button aria-pressed="false" aria-describedby="kaiketsu-body-{solution.id}"
						><span class="sr">{ja.solution.srPrefix}</span> {label(kind)}</button
					>
				{/each}
			</form>
		{:else}
			{#each REACTIONS as kind (kind)}
				<form method="post" action="?/react" use:enhance={() => async ({ update }) => update({ reset: false })}>
					<input type="hidden" name="solution" value={solution.id} />
					<input type="hidden" name="kind" value={kind} />
					<input type="hidden" name="op" value={solution.pressed[kind] ? 'remove' : 'add'} />
					<!-- 課題そのものの「わかる」と区別するため、読み上げだけ「この解決策に」を前に付け、本文を結び付ける -->
					<button aria-pressed={solution.pressed[kind]} aria-describedby="kaiketsu-body-{solution.id}"
						><span class="sr">{ja.solution.srPrefix}</span> {label(kind)}</button
					>
				</form>
			{/each}
		{/if}
	</div>
	{#if message}<p role="alert" class="refused">{message}</p>{/if}
</article>

<style>
	article {
		display: grid;
		gap: 0.5rem;
		padding: 1rem 0;
		border-bottom: 1px solid var(--color-divider);
	}

	.body {
		margin: 0;
		white-space: pre-wrap;
	}

	.reactions,
	.reactions form {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	button,
	.count {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap-min);
		padding: 0 1rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-pill);
		background: var(--color-bg);
		color: var(--color-text);
		font: inherit;
		font-size: var(--font-size-sub);
	}

	.count {
		border-style: dashed;
		color: var(--color-text-sub);
	}

	button[aria-pressed='true'] {
		border-color: var(--color-base);
		background: var(--color-base);
		color: var(--color-bg);
	}

	.refused {
		margin: 0;
		color: var(--color-caution);
		font-size: var(--font-size-sub);
	}

	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
</style>
