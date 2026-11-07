<script lang="ts">
	import { enhance } from '$app/forms';
	import { ja } from '#lib/copy/ja.ts';
	import { REVIEW_NOTE_MAX } from '#lib/domain/anomalies.ts';
	import {
		HIDE_REASONS,
		HIDEABLE,
		LISTED,
		RESTORABLE,
		REPORT_REASONS,
		SOLUTION_REPORT_REASONS
	} from '#lib/domain/reports.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const reasons = [...REPORT_REASONS, 'none'] as const;
	const solutionReasons = [...SOLUTION_REPORT_REASONS, 'none'] as const;
	const amendmentAlert = (id: number) => (form && 'message' in form && 'amendmentId' in form && form.amendmentId === id ? form.message : undefined);
	const postAlert = (id: number) => (form && 'message' in form && 'postId' in form && form.postId === id ? form.message : undefined);
	/** 解決策の操作を断った理由は、その解決策のところに出す */
	const solutionAlert = (id: number) =>
		form && 'message' in form && 'solutionId' in form && form.solutionId === id ? form.message : undefined;
</script>

<svelte:head>
	<title>{ja.kanri.pageTitle}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main>
	<h1>{ja.kanri.heading}</h1>
	<!-- 断った文言は、その課題・解決策のところに出す（どれか分からないときだけ上に） -->
	{#if form && 'message' in form && !('issueId' in form && form.issueId) && !('solutionId' in form && form.solutionId) && !('postId' in form && form.postId) && !('amendmentId' in form && form.amendmentId) && !('reviewBill' in form && form.reviewBill && data.reviews.some((r) => r.billId === form.reviewBill))}
		<p role="alert">{form.message}</p>
	{/if}
	{#if data.rows.length === 0}
		<p>{ja.kanri.empty}</p>
	{/if}
	{#each data.rows as row (row.id)}
		<article>
			<h2><a href="/kadai/{row.id}">#{row.id} {row.title}</a></h2>
			<p class="status">
				{row.status === 'merged' && row.mergedInto !== null ? ja.merge.status(row.mergedInto) : ja.kanri.statuses[row.status]}
			</p>
			{#if form && 'message' in form && 'issueId' in form && form.issueId === row.id}<p role="alert">{form.message}</p>{/if}
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

	<section aria-labelledby="reviews-heading">
		<h2 id="reviews-heading" class="section">{ja.review.kanriHeading}</h2>
		{#if data.reviews.length === 0}<p>{ja.review.kanriEmpty}</p>{/if}
		{#each data.reviews as row (row.billId)}
			<article>
				<h3><a href="/houan/{row.billId}">{row.title}</a></h3>
				<ul class="reasons">
					{#each row.signals as signal (signal)}<li>{ja.review.signals[signal]}</li>{/each}
				</ul>
				{#if form && 'reviewBill' in form && form.reviewBill === row.billId}<p role="alert">{form.message}</p>{/if}
				{#if row.involved}
					<p>{ja.review.involved}</p>
				{:else if row.counts && row.detail}
					<p>{ja.review.counts(row.counts.yes, row.counts.no, row.counts.abstain)}</p>
					<p>{ja.review.kanriDetail(row.detail.flagged, row.detail.maxLine, row.detail.longestRun, row.detail.runSeconds)}</p>
					<p>{ja.review.withoutLabel}{ja.review.kanriWithout[row.detail.without]}</p>
					<form method="post" action="?/confirmReview" use:enhance>
						<input type="hidden" name="bill" value={row.billId} />
						<input type="hidden" name="session" value={row.sessionKey} />
						<button>{ja.review.confirm}</button>
					</form>
					<form method="post" action="?/voidReview" use:enhance>
						<input type="hidden" name="bill" value={row.billId} />
						<input type="hidden" name="session" value={row.sessionKey} />
						<label for="review-note-{row.billId}">{ja.review.voidNote}</label>
						<p class="hint">{ja.review.voidHint}</p>
						<textarea id="review-note-{row.billId}" name="note" required maxlength={REVIEW_NOTE_MAX} rows="2"></textarea>
						<button>{ja.review.void}</button>
					</form>
				{/if}
			</article>
		{/each}
	</section>

	<section aria-labelledby="solutions-heading">
		<h2 id="solutions-heading" class="section">{ja.kanri.solutionsHeading}</h2>
		{#if data.solutions.length === 0}<p>{ja.kanri.solutionsEmpty}</p>{/if}
		{#each data.solutions as row (row.id)}
			<article>
				<h3><a href="/kadai/{row.issueId}">#{row.issueId} {row.issueTitle}</a> {ja.unei.solutionOf}</h3>
				<p class="body">{row.body}</p>
				<p class="status">{ja.kanri.statuses[row.status]}</p>
				{#if solutionAlert(row.id)}<p role="alert">{solutionAlert(row.id)}</p>{/if}
				<p>{ja.kanri.reportCount(row.total, row.counted)}</p>
				<ul class="reasons">
					{#each solutionReasons as reason (reason)}
						{#if row[reason] > 0}<li>{ja.report.reasons[reason]} {row[reason]}</li>{/if}
					{/each}
				</ul>
				{#if row.status === 'restored'}<p>{ja.kanri.afterRestore(row.afterRestore)}</p>{/if}
				{#if row.notes.length}
					<h4>{ja.kanri.notes}</h4>
					<ul class="notes">
						{#each row.notes as note, i (i)}<li>{note}</li>{/each}
					</ul>
				{/if}
				<!-- 自分の解決策には操作の欄を出さない。送り先にも solution を入れる（JS がなくても同じ解決策を開いたままにする） -->
				{#if !row.mine}
					{#if HIDEABLE.includes(row.status)}
						<form method="post" action="?solution={row.id}&/hideSolution" use:enhance>
							<input type="hidden" name="solution" value={row.id} />
							<label for="sol-hide-reason-{row.id}">{ja.kanri.hideReason}</label>
							<select id="sol-hide-reason-{row.id}" name="reason" required>
								{#each HIDE_REASONS as reason (reason)}
									<option value={reason}>{ja.hideReasons[reason]}</option>
								{/each}
							</select>
							<label for="sol-hide-note-{row.id}">{ja.kanri.hideNote}</label>
							<textarea id="sol-hide-note-{row.id}" name="note" required maxlength="200" rows="2"></textarea>
							<button>{ja.kanri.hide}</button>
						</form>
					{/if}
					{#if RESTORABLE.includes(row.status)}
						<form method="post" action="?solution={row.id}&/restoreSolution" use:enhance>
							<input type="hidden" name="solution" value={row.id} />
							<label for="sol-restore-note-{row.id}">{ja.kanri.restoreNote}</label>
							<textarea id="sol-restore-note-{row.id}" name="note" required maxlength="200" rows="2"></textarea>
							<button>{ja.kanri.restore}</button>
						</form>
					{/if}
				{/if}
			</article>
		{/each}
	</section>

	<section aria-labelledby="posts-heading">
		<h2 id="posts-heading" class="section">{ja.kanri.postsHeading}</h2>
		{#if data.posts.length === 0}<p>{ja.kanri.postsEmpty}</p>{/if}
		{#each data.posts as row (row.id)}
			<article>
				<h3><a href="/houan/{row.billId}/shitsugi">{row.billTitle}</a> {ja.kanri.postOf(ja.post.kinds[row.kind])}</h3>
				<p class="body">{row.body}</p>
				<p class="status">{ja.kanri.statuses[row.status]}</p>
				{#if row.parentHidden}<p>{ja.post.parentHidden}</p>{/if}
				{#if postAlert(row.id)}<p role="alert">{postAlert(row.id)}</p>{/if}
				<p>{ja.kanri.reportCount(row.total, row.counted)}</p>
				<ul class="reasons">
					{#each solutionReasons as reason (reason)}
						{#if row[reason] > 0}<li>{ja.report.reasons[reason]} {row[reason]}</li>{/if}
					{/each}
				</ul>
				{#if row.status === 'restored'}<p>{ja.kanri.afterRestore(row.afterRestore)}</p>{/if}
				{#if row.notes.length}
					<h4>{ja.kanri.notes}</h4>
					<ul class="notes">
						{#each row.notes as note, i (i)}<li>{note}</li>{/each}
					</ul>
				{/if}
				<!-- 送り先にも post を入れる（JS がなくても同じ投稿を開いたままにする） -->
				{#if HIDEABLE.includes(row.status)}
					<form method="post" action="?post={row.id}&/hidePost" use:enhance>
						<input type="hidden" name="post" value={row.id} />
						<label for="post-hide-reason-{row.id}">{ja.kanri.hideReason}</label>
						<select id="post-hide-reason-{row.id}" name="reason" required>
							{#each HIDE_REASONS as reason (reason)}
								<option value={reason}>{ja.hideReasons[reason]}</option>
							{/each}
						</select>
						<label for="post-hide-note-{row.id}">{ja.kanri.hideNote}</label>
						<textarea id="post-hide-note-{row.id}" name="note" required maxlength="200" rows="2"></textarea>
						<button>{ja.kanri.hide}</button>
					</form>
				{/if}
				{#if RESTORABLE.includes(row.status)}
					<form method="post" action="?post={row.id}&/restorePost" use:enhance>
						<input type="hidden" name="post" value={row.id} />
						<label for="post-restore-note-{row.id}">{ja.kanri.restoreNote}</label>
						<textarea id="post-restore-note-{row.id}" name="note" required maxlength="200" rows="2"></textarea>
						<button>{ja.kanri.restore}</button>
					</form>
				{/if}
				<!-- 似た質疑をまとめる（?post= で指した質疑に、候補があるときだけ。docs/spec/104.md の決定V） -->
				{#if data.justMerged && data.focusPost === row.id}<p role="status">{ja.kanri.mergeDone}</p>{/if}
				{#if data.focusPost === row.id && row.kind === 'question' && LISTED.includes(row.status) && data.mergeCandidates.length === 0}
					<p>{data.mergeOpen ? ja.kanri.mergeNoCandidates : ja.kanri.mergeClosed}</p>
				{/if}
				{#if data.focusPost === row.id && data.mergeCandidates.length}
					<section aria-labelledby="merge-heading-{row.id}" class="merge">
						<h4 id="merge-heading-{row.id}">{ja.kanri.mergeHeading}</h4>
						<p><strong>{ja.kanri.mergeIrreversible}</strong></p>
						<form method="post" action="?post={row.id}&/mergeQuestion" use:enhance>
							<input type="hidden" name="post" value={row.id} />
							<fieldset>
								<legend>{ja.kanri.mergeTarget}</legend>
								{#each data.mergeCandidates as candidate (candidate.id)}
									<label class="candidate"><input type="radio" name="target" value={candidate.id} required /> {candidate.body}</label>
								{/each}
							</fieldset>
							<label for="merge-note-post-{row.id}">{ja.kanri.mergeNote}</label>
							<textarea id="merge-note-post-{row.id}" name="note" required maxlength="200" rows="2"></textarea>
							<button>{ja.kanri.mergeSubmit}</button>
						</form>
					</section>
				{/if}
			</article>
		{/each}
	</section>

	<section aria-labelledby="amendments-heading">
		<h2 id="amendments-heading" class="section">{ja.kanri.amendmentsHeading}</h2>
		{#if data.amendments.length === 0}<p>{ja.kanri.amendmentsEmpty}</p>{/if}
		{#each data.amendments as row (row.id)}
			<article>
				<h3><a href="/houan/{row.billId}/shusei">{row.billTitle}</a> {ja.kanri.amendmentOf(row.location)}</h3>
				<p class="body">{row.body}</p>
				{#if row.reason}<p class="body">{ja.amendment.reason}：{row.reason}</p>{/if}
				<p class="status">{ja.kanri.statuses[row.moderationStatus]}</p>
				{#if row.status !== 'open'}<p>{ja.amendment.statuses[row.status]}</p>{/if}
				{#if row.updatedAfterReport}<p>{ja.kanri.updatedAfterReport}</p>{/if}
				{#if amendmentAlert(row.id)}<p role="alert">{amendmentAlert(row.id)}</p>{/if}
				<p>{ja.kanri.reportCount(row.total, row.counted)}</p>
				<ul class="reasons">
					{#each solutionReasons as reason (reason)}
						{#if row[reason] > 0}<li>{ja.report.reasons[reason]} {row[reason]}</li>{/if}
					{/each}
				</ul>
				{#if row.moderationStatus === 'restored'}<p>{ja.kanri.afterRestore(row.afterRestore)}</p>{/if}
				{#if row.notes.length}
					<h4>{ja.kanri.notes}</h4>
					<ul class="notes">
						{#each row.notes as note, i (i)}<li>{note}</li>{/each}
					</ul>
				{/if}
				{#if HIDEABLE.includes(row.moderationStatus)}
					<form method="post" action="?amendment={row.id}&/hideAmendment" use:enhance>
						<input type="hidden" name="amendment" value={row.id} />
						<label for="amendment-hide-reason-{row.id}">{ja.kanri.hideReason}</label>
						<select id="amendment-hide-reason-{row.id}" name="reason" required>
							{#each HIDE_REASONS as reason (reason)}
								<option value={reason}>{ja.hideReasons[reason]}</option>
							{/each}
						</select>
						<label for="amendment-hide-note-{row.id}">{ja.kanri.hideNote}</label>
						<textarea id="amendment-hide-note-{row.id}" name="note" required maxlength="200" rows="2"></textarea>
						<button>{ja.kanri.hide}</button>
					</form>
				{/if}
				{#if RESTORABLE.includes(row.moderationStatus)}
					<form method="post" action="?amendment={row.id}&/restoreAmendment" use:enhance>
						<input type="hidden" name="amendment" value={row.id} />
						<label for="amendment-restore-note-{row.id}">{ja.kanri.restoreNote}</label>
						<textarea id="amendment-restore-note-{row.id}" name="note" required maxlength="200" rows="2"></textarea>
						<button>{ja.kanri.restore}</button>
					</form>
				{/if}
			</article>
		{/each}
	</section>
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

	.merge fieldset {
		border: none;
		padding: 0;
	}

	.candidate {
		display: flex;
		gap: 0.5rem;
		align-items: flex-start;
		min-height: var(--tap-min);
		overflow-wrap: anywhere;
	}

	article {
		border-top: 1px solid var(--color-divider);
		padding: 1rem 0;
	}

	h2 {
		font-size: var(--font-size-heading);
	}

	h3,
	h4 {
		font-size: var(--font-size-sub);
		color: var(--color-text-sub);
	}

	.section {
		margin-top: 2rem;
		font-size: var(--font-size-page-title);
	}

	.body {
		white-space: pre-wrap;
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
