<script lang="ts">
	// 法案のページの概要（SpBillSummary・PcBillSummary）
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { ja } from '#lib/copy/ja.ts';
	import { BILL_PROGRESS_STEP } from '#lib/domain/bills.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const bill = $derived(data.bill);
	const support = $derived(data.support);
	const message = $derived(form && 'message' in form ? form.message : undefined);
	/** 発議にあと何人か（提出者が下書きを見るとき） */
	const remaining = $derived(support.required === null ? null : Math.max(0, support.required - support.count));
	/** いまの段の位置 */
	const current = $derived(BILL_PROGRESS_STEP[data.progress]);
	/** 段の名前：次の段には日付を出し、会期が終わったら最後の段「結果」を可決・否決・廃案にする（docs/spec/50.md 決めたこと6、docs/spec/71.md 決めたこと9） */
	const stageName = (name: string, i: number) => {
		const next = data.next;
		if (next && i === BILL_PROGRESS_STEP[next.stage]) return ja.bill.page.stageFrom(name, next.session, next.at);
		return (data.progress === 'lapsed' || data.progress === 'withdrawn') && i === BILL_PROGRESS_STEP.lapsed ? ja.bill.progress[data.stage] : name;
	};
</script>

<svelte:head>
	<title>{ja.bill.page.pageTitle(bill.title)}</title>
</svelte:head>

<div class="layout">
	<div class="content">
		{#if data.progress === 'vote'}<p class="to-vote"><a href="/saiketsu/{bill.id}">{ja.vote.billLink}</a></p>{/if}
		{#if data.progress === 'lapsed'}<p class="to-vote"><a href="/saiketsu/{bill.id}/kekka">{ja.result.link}</a></p>{/if}
		{#if bill.summary.length}
			<section class="summary">
				<h2>{ja.bill.page.summaryHeading}</h2>
				<ol>
					{#each bill.summary as line, i (i)}<li>{line}</li>{/each}
				</ol>
			</section>
		{/if}
		<div class="pair">
			<section>
				<h2 class="label">{ja.bill.page.affected}</h2>
				<p class="text">{bill.affected}</p>
			</section>
			<section>
				<h2 class="label">{ja.bill.page.sideEffects}</h2>
				<p class="text">{bill.sideEffects}</p>
			</section>
		</div>
		<section class="cited">
			<h2 class="label">{ja.bill.page.solutions}</h2>
			<ul>
				{#each bill.solutions as s (s.id)}
					<li>
						{#if s.body === null}
							<p class="hidden">{ja.bill.page.hiddenSolution}</p>
						{:else}
							<p class="text">{s.body}</p>
							{#if s.issue}<a href="/kadai/{s.issue.id}">{s.issue.title}</a>{/if}
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	</div>

	<aside>
		<!-- 発議していないまま撤回された法案に、質疑を経たような並びを出さない -->
		<section class="stages pc" hidden={data.progress === 'withdrawn' && data.questionCount === null}>
			<h2>{ja.bill.page.stagesHeading}</h2>
			<ol>
				{#each ja.bill.page.stages as stage, i (stage)}
					<li class:done={i < current} class:current={i === current}>
						<span class="dot" aria-hidden="true"></span>{stageName(stage, i)}{#if i === current}{ja.bill.page.here}{/if}
					</li>
				{/each}
			</ol>
		</section>
		<div class="people">
			<p class="author">{ja.bill.page.author(bill.author)}</p>
			{#if data.cosponsors.length}<span class="sep" aria-hidden="true">{ja.bill.support.separator}</span><p class="author">{ja.bill.cosponsor.names(data.cosponsors)}</p>{/if}
			{#if data.coDrafters.length}<p class="author">{ja.bill.page.coDrafters(data.coDrafters)}</p>{/if}
			<span class="sep" aria-hidden="true">{ja.bill.support.separator}</span>
			<p class="supports">{ja.bill.support.count(support.count)}</p>
		</div>
		{#if data.related.length}
			<section class="related" aria-labelledby="related-heading">
				<h2 id="related-heading">{ja.bill.page.relatedHeading}</h2>
				<p class="note">{ja.bill.page.relatedNote}</p>
				<ul>
					{#each data.related as other (other.id)}
						<li><a href="/houan/{other.id}">{other.title}</a></li>
					{/each}
				</ul>
			</section>
		{/if}
		<!-- 共同提出者（docs/spec/76.md 決めたこと8） -->
		{#if data.cosponsor.panel}
			<section class="box" aria-labelledby="cosponsor-heading">
				<h2 id="cosponsor-heading">{ja.bill.cosponsor.heading}</h2>
				{#if data.cosponsor.panel.requests.length}
					<h3>{ja.bill.cosponsor.requestsHeading}</h3>
					<ul>
						{#each data.cosponsor.panel.requests as row (row.id)}
							<li>
								<span>{row.name}</span>
								{#if data.cosponsor.panel.full}
									<p class="note">{ja.bill.cosponsor.fullNote}</p>
								{:else}
									<form method="post" action="?/cosponsor" use:enhance>
										<input type="hidden" name="op" value="accept" />
										<input type="hidden" name="id" value={row.id} />
										<button>{ja.bill.cosponsor.accept}</button>
									</form>
								{/if}
								<form method="post" action="?/cosponsor" use:enhance>
									<input type="hidden" name="op" value="decline" />
									<input type="hidden" name="id" value={row.id} />
									<button>{ja.bill.cosponsor.decline}</button>
								</form>
							</li>
						{/each}
					</ul>
					{#if data.cosponsor.panel.moreRequests}<p class="note">{ja.bill.cosponsor.more(data.cosponsor.panel.moreRequests)}</p>{/if}
				{/if}
				{#if data.cosponsor.panel.members.length}
					<h3>{ja.bill.cosponsor.membersHeading}</h3>
					<ul>
						{#each data.cosponsor.panel.members as row (row.id)}
							<li>
								<span>{row.name}</span>
								<form method="post" action="?/cosponsor" use:enhance>
									<input type="hidden" name="op" value="remove" />
									<input type="hidden" name="id" value={row.id} />
									<label class="check"><input type="checkbox" name="confirm" required />{ja.bill.cosponsor.removeConfirm}</label>
									<button>{ja.bill.cosponsor.remove}</button>
								</form>
							</li>
						{/each}
					</ul>
				{/if}
				{#if !data.cosponsor.panel.requests.length && !data.cosponsor.panel.members.length}<p class="note">{ja.bill.cosponsor.none}</p>{/if}
			</section>
		{:else if data.progress === 'draft' && data.cosponsor.mine === 'accepted'}
			<form method="post" action="?/cosponsor" use:enhance class="act">
				<input type="hidden" name="op" value="leave" />
				<label class="check"><input type="checkbox" name="confirm" required />{ja.bill.cosponsor.leaveConfirm}</label>
				<button>{ja.bill.cosponsor.leave}</button>
			</form>
		{:else if data.progress === 'draft' && data.cosponsor.mine === 'requested'}
			<form method="post" action="?/cosponsor" use:enhance class="act">
				<input type="hidden" name="op" value="cancel" />
				<button>{ja.bill.cosponsor.cancel}</button>
			</form>
		{:else if data.progress === 'draft' && data.cosponsor.mine === 'left'}
			<p class="note">{ja.bill.cosponsor.leftNote}</p>
		{:else if data.progress === 'draft' && data.cosponsor.mine === 'declined'}
			<p class="note">{ja.bill.cosponsor.declinedNote}</p>
		{:else if data.cosponsor.canAsk}
			<form method="post" action="?/cosponsor" use:enhance class="act">
				<input type="hidden" name="op" value="request" />
				<button>{ja.bill.cosponsor.request}</button>
				<p class="note">{ja.bill.cosponsor.requestNote}</p>
			</form>
		{/if}
		<!-- 統合案の同意（docs/spec/76.md 決めたこと14）。統合案のページに出す -->
		{#if data.progress === 'draft' && data.merge.consent}
			<section class="box" aria-labelledby="merge-heading">
				<h2 id="merge-heading">{ja.bill.merge.heading}</h2>
				<p class="note">{ja.bill.merge.progress(data.merge.consent.total, data.merge.consent.consented)}</p>
				{#if data.merge.consent.member}
					{#if data.merge.consent.mine}
						<form method="post" action="?/merge" use:enhance>
							<input type="hidden" name="op" value="revoke" />
							<button>{ja.bill.merge.revoke}</button>
						</form>
					{:else}
						<form method="post" action="?/merge" use:enhance>
							<input type="hidden" name="op" value="consent" />
							<input type="hidden" name="rev" value={support.rev} />
							<p class="note">{ja.bill.merge.consentNote}</p>
							<label class="check"><input type="checkbox" name="confirm" required />{ja.bill.merge.consentConfirm}</label>
							<button>{ja.bill.merge.consent}</button>
						</form>
					{/if}
				{/if}
				{#if support.required !== null}
					<form method="post" action="?/merge" use:enhance>
						<input type="hidden" name="op" value="cancel" />
						<button>{ja.bill.merge.cancel}</button>
					</form>
				{/if}
			</section>
		{/if}
		<!-- 統合案を作る -->
		{#if data.canStartMerge}
			<details class="box">
				<summary>{ja.bill.merge.start}</summary>
				<form method="post" action="?/merge" use:enhance>
					<input type="hidden" name="op" value="create" />
					<label for="merge-with">{ja.bill.merge.withLabel}</label>
					<input id="merge-with" name="with" inputmode="numeric" required />
					<p class="note">{ja.bill.merge.startNote}</p>
					<button>{ja.bill.merge.create}</button>
				</form>
			</details>
		{/if}
		<!-- 撤回（docs/spec/76.md 決めたこと12）。提出者と共同提出者にだけ -->
		{#if data.withdraw?.member}
			<section class="box" aria-labelledby="withdraw-heading">
				<h2 id="withdraw-heading">{ja.bill.withdraw.heading}</h2>
				<p class="note">{ja.bill.withdraw.progress(data.withdraw.total, data.withdraw.consented)}{#if data.withdraw.names.length}{ja.bill.withdraw.names(data.withdraw.names)}{/if}</p>
				{#if data.withdraw.mine}
					<form method="post" action="?/withdraw" use:enhance>
						<input type="hidden" name="op" value="cancel" />
						<button>{ja.bill.withdraw.cancel}</button>
					</form>
				{:else}
					<form method="post" action="?/withdraw" use:enhance>
						<input type="hidden" name="op" value="consent" />
						<label class="check"><input type="checkbox" name="confirm" required />{ja.bill.withdraw.confirm}</label>
						<button>{ja.bill.withdraw.consent}</button>
					</form>
				{/if}
			</section>
		{/if}
		<!-- 出し直し（docs/spec/75.md）。提出者にだけ出る -->
		{#if data.resubmit?.next}
			<p class="act"><a href="/houan/{data.resubmit.next.id}">{ja.bill.resubmit.open}</a></p>
		{:else if data.resubmit?.can}
			<form method="post" action="?/resubmit" use:enhance class="act">
				<button class="primary">{ja.bill.resubmit.button}</button>
				<p class="note">{ja.bill.resubmit.note}</p>
			</form>
		{/if}
		<!-- 賛同と発議（docs/spec/49.md 決めたこと7） -->
		{#if remaining !== null}
			<form method="post" action="?/propose" use:enhance class="act">
				<input type="hidden" name="rev" value={support.rev} />
				<button class="primary" disabled={remaining > 0}>{ja.bill.support.propose}</button>
				{#if remaining > 0}<p class="note">{ja.bill.support.remaining(remaining)}</p>{/if}
			</form>
		{:else if support.open}
			{#if support.waitUntil !== null}
				<p class="note">{ja.bill.support.tooNew(support.waitUntil)}</p>
			{:else if !support.loggedIn}
				<!-- ログインしていなければ、押すとログインの画面へ（JS がなくても動く） -->
				<form method="get" action="/login" class="act">
					<input type="hidden" name="next" value={page.url.pathname} />
					<button class="primary">{ja.bill.support.add}</button>
				</form>
			{:else}
				<form method="post" action="?/support" use:enhance={() => async ({ update }) => update({ reset: false })} class="act">
					<input type="hidden" name="op" value={support.mine ? 'remove' : 'add'} />
					<input type="hidden" name="rev" value={support.rev} />
					<button class={support.mine ? '' : 'primary'}>{support.mine ? ja.bill.support.remove : ja.bill.support.add}</button>
				</form>
			{/if}
		{/if}
		{#if message}<p role="alert" class="alert">{message}</p>{/if}
	</aside>
</div>

<style>
	.box {
		margin-top: 1rem;
		padding: 0.75rem 1rem;
		border: 1px solid var(--color-divider);
		border-radius: var(--radius-m);
		overflow-wrap: anywhere;
	}

	.box h2,
	.box h3 {
		margin: 0 0 0.5rem;
		font-size: var(--font-size-sub);
	}

	.box ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.box li {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		padding: 0.5rem 0;
	}

	.box summary {
		min-height: var(--tap-min);
		cursor: pointer;
	}

	.box input:not([type]),
	.box input[inputmode] {
		display: block;
		width: 100%;
		min-height: var(--tap-min);
	}

	.check {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		margin: 0.25rem 0;
		font-size: var(--font-size-sub);
	}

	.layout {
		display: grid;
		gap: 1.5rem;
		margin-top: 1.5rem;
	}

	h2 {
		margin: 0;
		font-size: var(--font-size-body);
	}

	.to-vote {
		margin: 0 0 1rem;
		font-weight: bold;
	}

	.summary {
		padding: 1rem 1.5rem;
		border-radius: var(--radius-l);
		background: var(--color-surface);
	}

	.summary ol {
		margin: 0.5rem 0 0;
		padding-left: 1.25rem;
	}

	.pair {
		display: grid;
		gap: 1rem;
		margin-top: 1.5rem;
	}

	.label {
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	.text {
		margin: 0.25rem 0 0;
		white-space: pre-line;
	}

	.cited {
		margin-top: 1.5rem;
	}

	.cited ul {
		display: grid;
		gap: 0.75rem;
		margin: 0.5rem 0 0;
		padding: 0;
		list-style: none;
	}

	.cited li {
		padding: 0.75rem 1rem;
		border-radius: var(--radius-l);
		background: var(--color-surface);
	}

	.hidden {
		margin: 0;
		color: var(--color-text-sub);
	}

	/* スマホは「提出者 … ・ 賛同 N人」の1行（SpBillSummary）、PC は2行（PcBillSummary） */
	.people {
		display: flex;
		flex-wrap: wrap;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	.sep {
		white-space: pre-wrap;
	}

	.author,
	.supports {
		margin: 0;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	.act {
		display: grid;
		gap: 0.5rem;
		margin-top: 1rem;
	}

	.act button {
		min-height: var(--tap-primary);
		padding: 0 1.25rem;
		border: 1px solid var(--color-base);
		border-radius: var(--radius-m);
		background: var(--color-bg);
		color: var(--color-base);
		font: inherit;
		font-weight: bold;
	}

	.act .primary {
		background: var(--color-base);
		color: var(--color-bg);
	}

	.act button:disabled {
		opacity: 0.5;
	}

	.note {
		margin: 0.5rem 0 0;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	.alert {
		margin: 0.5rem 0 0;
		color: var(--color-caution);
		font-size: var(--font-size-sub);
	}

	.stages ol {
		margin: 0.5rem 0 1.5rem;
		padding: 0;
		list-style: none;
	}

	.stages li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 2rem;
		color: var(--color-text-sub);
	}

	.dot {
		width: 0.75rem;
		height: 0.75rem;
		border: 2px solid var(--color-text-sub);
		border-radius: var(--radius-pill);
	}

	.stages li.done .dot {
		border-color: var(--color-base);
		background: var(--color-base);
	}

	.stages li.current {
		color: var(--color-text);
		font-weight: bold;
	}

	.stages li.current .dot {
		border-color: var(--color-base);
		background: var(--color-base);
		box-shadow: 0 0 0 2px var(--color-bg), 0 0 0 4px var(--color-base);
	}

	.pc {
		display: none;
	}

	@media (min-width: 64rem) {
		.layout {
			grid-template-columns: minmax(0, 1fr) 18rem;
			column-gap: 3rem;
		}

		.pair {
			grid-template-columns: 1fr 1fr;
			column-gap: 2rem;
		}

		.pc {
			display: block;
		}

		.people {
			display: block;
		}

		.sep {
			display: none;
		}
	}

	.related {
		margin-top: 1.5rem;
	}

	.related ul {
		margin: 0.5rem 0 0;
		padding: 0;
		list-style: none;
	}

	.related li {
		margin-top: 0.25rem;
	}
</style>
