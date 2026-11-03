<script lang="ts">
	import { enhance } from '$app/forms';
	import { ja } from '#lib/copy/ja.ts';
	import { HIDE_REASONS, HIDEABLE, LISTED, RESTORABLE, REPORT_REASONS } from '#lib/domain/reports.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const reasons = [...REPORT_REASONS, 'none'] as const;
</script>

<svelte:head>
	<title>{ja.kanri.pageTitle}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main>
	<h1>{ja.kanri.heading}</h1>
	<!-- 断った文言は、その課題のところに出す（どの課題か分からないときだけ上に） -->
	{#if form && 'message' in form && !form.issueId}<p role="alert">{form.message}</p>{/if}
	{#if data.rows.length === 0}
		<p>{ja.kanri.empty}</p>
	{/if}
	{#each data.rows as row (row.id)}
		<article>
			<h2><a href="/kadai/{row.id}">#{row.id} {row.title}</a></h2>
			<p class="status">
				{row.status === 'merged' && row.mergedInto !== null ? ja.merge.status(row.mergedInto) : ja.kanri.statuses[row.status]}
			</p>
			{#if form && 'message' in form && form.issueId === row.id}<p role="alert">{form.message}</p>{/if}
			<p>{ja.kanri.reportCount(row.total, row.counted)}</p>
			<ul class="reasons">
				{#each reasons as reason (reason)}
					{#if row[reason] > 0}<li>{ja.report.reasons[reason]} {row[reason]}</li>{/if}
				{/each}
			</ul>
			{#if row.status === 'restored'}<p>{ja.kanri.afterRestore(row.afterRestore)}</p>{/if}
			{#if row.notes.length}
				<h3>{ja.kanri.notes}</h3>
				<ul class="notes">
					{#each row.notes as note, i (i)}<li>{note}</li>{/each}
				</ul>
			{/if}

			<!-- 統合できないときの理由は、操作の欄を出さない課題（自分の課題、統合した課題）でも出す -->
			{#if data.merge && !data.merge.ok && data.focus === row.id}<p role="alert">{data.merge.error}</p>{/if}
			<!-- 自分の課題と、統合した課題には操作の欄を出さない -->
			{#if !row.mine && row.status !== 'merged'}
				{#if HIDEABLE.includes(row.status)}
					<!-- 送り先にも issue を入れる（JS がなくても、送ったあとに同じ課題を開いたままにする） -->
					<form method="post" action="?issue={row.id}&/hide" use:enhance>
						<input type="hidden" name="issue" value={row.id} />
						<label for="hide-reason-{row.id}">{ja.kanri.hideReason}</label>
						<select id="hide-reason-{row.id}" name="reason" required>
							{#each HIDE_REASONS as reason (reason)}
								<option value={reason}>{ja.hideReasons[reason]}</option>
							{/each}
						</select>
						<label for="hide-note-{row.id}">{ja.kanri.hideNote}</label>
						<textarea id="hide-note-{row.id}" name="note" required maxlength="200" rows="2"></textarea>
						<button>{ja.kanri.hide}</button>
					</form>
				{/if}
				{#if RESTORABLE.includes(row.status)}
					<form method="post" action="?issue={row.id}&/restore" use:enhance>
						<input type="hidden" name="issue" value={row.id} />
						<label for="restore-note-{row.id}">{ja.kanri.restoreNote}</label>
						<textarea id="restore-note-{row.id}" name="note" required maxlength="200" rows="2"></textarea>
						<button>{ja.kanri.restore}</button>
					</form>
				{/if}
				{#if LISTED.includes(row.status)}
					<!-- 統合は取り消せないので、まず確認の欄を開く（GET） -->
					<form method="get" action="/kanri">
						<input type="hidden" name="issue" value={row.id} />
						<label for="merge-target-{row.id}">{ja.merge.target}</label>
						<input id="merge-target-{row.id}" name="merge" inputmode="numeric" pattern="[1-9][0-9]*" required />
						<button>{ja.merge.check}</button>
					</form>
				{/if}
				{#if data.merge?.ok && data.focus === row.id}
					{#if data.merge.ok}
						<form method="post" action="?issue={row.id}&merge={data.merge.targetId}&/merge" use:enhance class="confirm">
							<p>{ja.merge.confirm(row.id, data.merge.source, data.merge.targetId, data.merge.target)}</p>
							<p><strong>{ja.merge.irreversible}</strong></p>
							<p>{ja.merge.supports(data.merge.supports)}</p>
							<input type="hidden" name="issue" value={row.id} />
							<input type="hidden" name="target" value={data.merge.targetId} />
							<label for="merge-note-{row.id}">{ja.merge.note}</label>
							<textarea id="merge-note-{row.id}" name="note" required maxlength="200" rows="2"></textarea>
							<button>{ja.merge.submit}</button>
						</form>
					{/if}
				{/if}
			{/if}
		</article>
	{/each}
</main>

<style>
	main {
		max-width: 48rem;
		margin: 0 auto;
		padding: 1rem;
	}

	h1 {
		font-size: var(--font-size-page-title);
	}

	article {
		border-top: 1px solid var(--color-divider);
		padding: 1rem 0;
	}

	h2 {
		font-size: var(--font-size-heading);
	}

	h3 {
		font-size: var(--font-size-sub);
		color: var(--color-text-sub);
	}

	.status {
		font-weight: bold;
	}

	.reasons,
	.notes {
		font-size: var(--font-size-sub);
	}

	.notes li {
		white-space: pre-wrap;
	}

	form {
		display: grid;
		gap: 0.5rem;
		margin-top: 1rem;
	}

	input,
	select,
	textarea {
		min-height: var(--tap-min);
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-m);
		font: inherit;
	}

	button {
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

	.confirm {
		padding: 1rem;
		border-radius: var(--radius-m);
		background: var(--color-caution-bg);
	}

	[role='alert'] {
		color: var(--color-caution);
	}
</style>
