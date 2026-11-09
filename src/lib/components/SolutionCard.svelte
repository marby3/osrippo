<script lang="ts">
	// 解決策1件（設計書 docs/spec/34.md 決めたこと3〜5、docs/spec/36.md 決めたこと1・4・7）。課題のページと解決策の一覧で使う
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import { ja } from '#lib/copy/ja.ts';
	import { SOLUTION_REPORT_REASONS } from '#lib/domain/reports.ts';
	import { REACTIONS } from '#lib/domain/solutions.ts';

	type Solution = {
		id: number;
		body: string;
		support: number;
		changed: number;
		mine?: boolean;
		pressed?: { support: boolean; changed: boolean };
	};
	let {
		solution,
		loggedIn,
		readonly = false,
		back,
		message,
		done,
		notice,
		reported = false,
		staff = false
	}: {
		solution: Solution;
		loggedIn: boolean;
		/** 非表示の課題・解決策を本人・運営が見るとき：ボタンの代わりに数だけ、通報のボタンも出さない */
		readonly?: boolean;
		/** ログインしていないとき、ログインのあとに戻るパス */
		back: string;
		/** この解決策への操作を断った理由 */
		message?: string;
		/** 通報を受け付けた知らせ（断った理由とは分けて、警告ではない形で出す） */
		done?: string;
		/** 非表示になっていることの知らせ（本人・運営に見せるとき） */
		notice?: string;
		/** 見ている人が通報済みか */
		reported?: boolean;
		/** 見ている人が運営・運営協力者か */
		staff?: boolean;
	} = $props();

	const label = (kind: (typeof REACTIONS)[number]) =>
		kind === 'support' ? ja.solution.support(solution.support) : ja.solution.changed(solution.changed);

	/** JS がなければ通報の欄を最初から開いておく */
	let js = $state(false);
	let reportOpen = $state(false);
	let reasonChoice = $state('');
	onMount(() => {
		js = true;
	});
</script>

<article id="kaiketsu-{solution.id}">
	{#if notice}<p class="notice">{notice}</p>{/if}
	<div class="text">
		<p id="kaiketsu-body-{solution.id}" class="body">{solution.body}</p>
		<!-- 法案は解決策から書き始める（Issue #46）。非表示のものには出さない -->
		{#if !readonly}<p class="to-bill"><a href="/houan/kaku?kaiketsu={solution.id}">{ja.solution.toBill}</a></p>{/if}
	</div>
	<div class="reactions">
		{#if solution.mine || readonly}
			<!-- 自分の解決策と、非表示のものには押せない。数だけを出す -->
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
					<input type="hidden" name="op" value={solution.pressed?.[kind] ? 'remove' : 'add'} />
					<!-- 課題そのものの「わかる」と区別するため、読み上げだけ「この解決策に」を前に付け、本文を結び付ける -->
					<button aria-pressed={solution.pressed?.[kind] ?? false} aria-describedby="kaiketsu-body-{solution.id}"
						><span class="sr">{ja.solution.srPrefix}</span> {label(kind)}</button
					>
				</form>
			{/each}
		{/if}
	</div>
	{#if message}<p role="alert" class="refused">{message}</p>{/if}

	{#if staff}
		<p><a class="sub" href="/kanri?solution={solution.id}">{ja.solution.staffLink}</a></p>
	{/if}

	<!-- 通報（設計書 docs/spec/36.md 決めたこと1）。自分の解決策と、非表示のものには出さない -->
	{#if !solution.mine && !readonly}
		{#if done}
			<p role="status" class="sub">{done}</p>
		{:else if reported}
			<p class="sub">{ja.solution.reportAlready}</p>
		{:else if !loggedIn}
			<form method="get" action="/login">
				<input type="hidden" name="next" value={back} />
				<button class="link">{ja.solution.reportOpen}</button>
			</form>
		{:else}
			{#if js && !reportOpen}
				<button type="button" class="link" onclick={() => (reportOpen = true)}>{ja.solution.reportOpen}</button>
			{/if}
			{#if !js || reportOpen}
				<form method="post" action="?/reportSolution" use:enhance class="report">
					<input type="hidden" name="solution" value={solution.id} />
					<fieldset>
						<legend>{ja.report.legend}</legend>
						{#each SOLUTION_REPORT_REASONS as reason (reason)}
							<label class="radio">
								<input type="radio" name="reason" value={reason} bind:group={reasonChoice} />
								{ja.report.reasons[reason]}
							</label>
						{/each}
					</fieldset>
					{#if !js || reasonChoice === 'other'}
						<label for="report-note-{solution.id}">{ja.report.noteLabel}</label>
						<textarea id="report-note-{solution.id}" name="note" maxlength="200" rows="3"></textarea>
					{/if}
					<p class="sub">{ja.report.criteria} <a href="/unei">{ja.report.criteriaLink}</a></p>
					<button class="submit">{ja.report.submit}</button>
				</form>
			{/if}
		{/if}
	{/if}
</article>

<style>
	article {
		display: grid;
		gap: 0.5rem;
	}

	/* スマホは1件ずつ枠つきのカード（SpIssue） */
	@media (max-width: 63.99rem) {
		article {
			margin-top: 0.75rem;
			padding: 1rem;
			border: 1px solid var(--color-input-border);
			border-radius: var(--radius-l);
		}
	}

	/* PC は1件を1行：本文（と法案を書くリンク）が左、「わかる」「考えが変わった」が右。行のあいだに区切り線（PcIssue）。
	   断った理由・運営のリンク・通報は本文の下、通報の欄は行の幅いっぱい */
	@media (min-width: 64rem) {
		article {
			grid-template-columns: minmax(0, 1fr) auto;
			column-gap: 1.5rem;
			padding: 1rem 0;
			border-bottom: 1px solid var(--color-divider);
		}

		article > * {
			grid-column: 1;
		}

		article > .notice,
		article > .report {
			grid-column: 1 / -1;
		}

		article > .reactions {
			grid-column: 2;
			align-self: start;
			flex-wrap: nowrap;
		}
	}

	.text {
		display: grid;
		gap: 0.5rem;
	}

	.body {
		margin: 0;
		white-space: pre-wrap;
	}

	.notice {
		margin: 0;
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius-m);
		background: var(--color-caution-bg);
		color: var(--color-caution);
		font-size: var(--font-size-sub);
	}

	.reactions,
	.reactions form {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.reactions button,
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

	.reactions button[aria-pressed='true'] {
		border-color: var(--color-base);
		background: var(--color-base);
		color: var(--color-bg);
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
		justify-self: start;
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

	.to-bill {
		margin: 0.25rem 0 0;
		font-size: var(--font-size-sub);
	}

	.to-bill a {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap-min);
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
