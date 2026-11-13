<script lang="ts">
	import TobenItem from '#lib/components/TobenItem.svelte';
	import { tokyoDate } from '#lib/domain/law/display.ts';
	import { KOKKAI_URL_MAX } from '#lib/domain/hirotta.ts';
	import LegislatorNote from '#lib/components/LegislatorNote.svelte';
	import Crumbs from '#lib/components/Crumbs.svelte';
	import { enhance } from '$app/forms';
	import { afterNavigate, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import SolutionCard from '#lib/components/SolutionCard.svelte';
	import LawRefText from '#lib/components/LawRefText.svelte';
	import { ja, jaDate } from '#lib/copy/ja.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let reasonChoice = $state('');
	let reportOpen = $state(false);
	/** JS がなければ通報の欄を最初から開いておく */
	let js = $state(false);
	onMount(() => {
		js = true;
	});
	// 案内を出したら URL から from を消す（読み直しで何度も出さないように）。
	// ルーターの準備が済んでから呼ぶため、onMount ではなく afterNavigate（最初の読み込みのあとにも呼ばれる）で行う
	afterNavigate(() => {
		if (!page.url.searchParams.has('from')) return;
		const url = new URL(page.url.href);
		url.searchParams.delete('from');
		replaceState(url, page.state);
	});

	const hiddenMessage = (status: string, reason: string | null) =>
		status === 'auto_hidden'
			? ja.hidden.auto
			: ja.hidden.staff(ja.hideReasons[(reason ?? 'other') as keyof typeof ja.hideReasons]);
	// 解決策への操作を断った理由は、その解決策のところに出す
	const refusedSolution = $derived(form && 'solution' in form ? form.solution : null);
	const message = $derived(form && 'message' in form && refusedSolution === null ? form.message : undefined);
	// 課題の通報の知らせ（解決策の通報の知らせは、その解決策のところに出す）
	const reportMessage = $derived(
		form && 'reportMessage' in form && refusedSolution === null ? form.reportMessage : undefined
	);
	/** 解決策への操作を断った理由 */
	const solutionMessage = (id: number) =>
		form && refusedSolution === id && 'message' in form ? form.message : undefined;
	/** 解決策の通報を受け付けた知らせ（「通報済み」の知らせも含む） */
	const solutionDone = (id: number) =>
		form && refusedSolution === id && 'reportMessage' in form ? form.reportMessage : undefined;
</script>

<svelte:head>
	{#if data.view === 'merged'}
		<title>{ja.merge.pageTitle(data.mergedInto)}</title>
	{:else if data.view === 'hidden'}
		<title>{ja.hidden.pageTitle}</title>
	{:else}
		<title>{ja.issue.pageTitle(data.issue.title)}</title>
	{/if}
	{#if data.view !== 'full' || data.hidden}
		<meta name="robots" content="noindex" />
	{/if}
</svelte:head>

<main class="frame">
	<Crumbs current={ja.menu.pages.issue} />
	{#if data.view === 'merged'}
		<!-- 統合された課題への操作を断ったあと（POST）だけここに来る。GET は統合先へ転送する -->
		<p><a href="/kadai/{data.mergedInto}">{ja.merge.mergedInto(data.mergedInto)}</a></p>
		{#if message}<p role="alert">{message}</p>{/if}
	{:else if data.view === 'hidden'}
		<!-- 自分の通報で非表示になったときも、受け付けたことを知らせる -->
		{#if reportMessage}<p role="status">{reportMessage}</p>{/if}
		<h1>{ja.hidden.heading}</h1>
		<p>{hiddenMessage(data.status, data.statusReason)}</p>
		<p><a href="/unei">{ja.hidden.toLog}</a></p>
	{:else}
		{@const issue = data.issue}
		<!-- PC は左に本文と解決策、右の列に「わかる」の枠と通報（PcIssue）。スマホは並べた順の1列（SpIssue）。
		     左の本文と解決策が1つの列に続くよう、本文の行の高さは本文と「わかる」の枠の高いほうで決まり、残りは下の行に入る -->
		<!-- 知らせは2列の上に横いっぱいで出し、右の列が見出しの高さから始まるようにする -->
		{#if data.fromSimilar && !data.legislator}
			<p class="from-similar" role="status">
				{ja.solution.fromSimilar}
				<a href="/kadai/{issue.id}/kaiketsu/kaku">{ja.solution.write}</a>
			</p>
		{/if}
		{#if data.hidden}
			<p class="notice" role="status">
				{hiddenMessage(issue.status, issue.statusReason)}
				<a href="/unei">{ja.hidden.toLog}</a>
			</p>
		{/if}
		<!-- 非表示の課題は「わかる」も通報も出さないので、右の列を空けずに1列にする -->
		<div class="layout" class:single={data.hidden}>
			<div class="head">
				<h1>{issue.title}</h1>
				{#if issue.topicName}<p class="topic">{ja.issue.topicMark(issue.topicName)}</p>{/if}

				<h2>{ja.issue.affected}</h2>
				<p><LawRefText text={issue.affected} /></p>
				<h2>{ja.issue.example}</h2>
				<p class="example"><LawRefText text={issue.example} /></p>
			</div>

			{#if !data.hidden && data.legislator}
				<div class="support-box">
					<p class="count">{ja.issue.support} {issue.supports}</p>
					<LegislatorNote />
				</div>
			{:else if !data.hidden}
				<form class="support-box" method="post" action="?/support" use:enhance>
					<input type="hidden" name="op" value={issue.supported ? 'remove' : 'add'} />
					<button class="support" aria-pressed={issue.supported}>
						<svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20">
							<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" />
							<path d="m8 12 3 3 5-6" fill="none" stroke="currentColor" stroke-width="2" />
						</svg>
						{ja.issue.support}
						{issue.supports}
					</button>
					<p class="hint">{ja.issue.supportHint}</p>
					{#if message}<p role="alert">{message}</p>{/if}
				</form>
			{/if}

			<div class="rest">
				<!-- 「解決策を書く」は並びのあと（スマホは並びの下に横いっぱい）。PC は見出しの右に置く（PcIssue） -->
				<section class="solutions" aria-labelledby="solutions-heading">
					<h2 id="solutions-heading">{ja.solution.heading} <span>{ja.solution.count(data.solutionCount)}</span></h2>
					{#if data.solutions.length === 0}
						<p class="empty">{ja.solution.empty}</p>
					{/if}
					{#each data.solutions as solution (solution.id)}
						<SolutionCard
							{solution}
							loggedIn={data.loggedIn}
							readonly={data.hidden}
							back="/kadai/{issue.id}"
							message={solutionMessage(solution.id)}
							done={solutionDone(solution.id)}
							reported={data.reportedSolutions.includes(solution.id)}
							staff={data.staff}
							legislator={data.legislator}
						/>
					{/each}
					{#if data.solutionCount > data.solutions.length}
						<p class="more"><a href="/kadai/{issue.id}/kaiketsu">{ja.solution.all(data.solutionCount)}</a></p>
					{:else if data.hasHiddenSolutions}
						<!-- 本人・運営に見せられる非表示の解決策は、解決策の一覧の最後に出す（設計書 docs/spec/36.md 決めたこと4） -->
						<p class="more"><a href="/kadai/{issue.id}/kaiketsu">{ja.solution.showHidden}</a></p>
					{/if}
					{#if !data.hidden && !data.legislator}<a class="write" href="/kadai/{issue.id}/kaiketsu/kaku">{ja.solution.write}</a>{/if}
				</section>

				{#if data.sources.length}
					<h2>{ja.merge.sourcesHeading}</h2>
					<!-- 元の URL は統合先（このページ）へ転送されるので、リンクにしない -->
					<ul class="sources">
						{#each data.sources as source (source.id)}<li>{source.title}</li>{/each}
					</ul>
				{/if}

				{#if data.staff}
					<p><a href="/kanri?issue={issue.id}">{ja.hidden.staffLink}</a></p>
				{/if}
			</div>

			<!-- 右の列の下の段（PC）。スマホは解決策のあと。「この課題から生まれた法案」は通報より上（SpIssue・PcIssue、Issue #125） -->
			{#if !data.hidden && (data.billCount > 0 || !data.mine || data.hirotta.length > 0 || data.legislator || data.toben.length > 0)}
				<div class="side-bottom">
					{#if data.toben.length}
						<!-- これからと開催中の答弁イベント（Issue #153） -->
						<section class="toben" aria-labelledby="toben-heading">
							<h2 id="toben-heading">{ja.toben.forTarget}</h2>
							<ul>
								{#each data.toben as e (e.id)}<TobenItem {e} />{/each}
							</ul>
							<p class="to-list"><a href="/toben">{ja.toben.toList}</a></p>
						</section>
					{/if}
				<!-- 議員の反応（Issue #150）。だれでも見られる。反応がなければ、議員にだけ出す（押すため） -->
				{#if !data.hidden && (data.hirotta.length > 0 || data.legislator)}
					<section class="hirotta" id="hirotta" aria-labelledby="hirotta-heading">
						<h2 id="hirotta-heading">{ja.hirotta.heading}</h2>
						{#if data.hirotta.length}
							<ul>
								{#each data.hirotta as r, i (i)}
									<li>
										{ja.hirotta.line(r.kind, r.name, r.hidden)}{#if r.url}・<a href={r.url} rel="noopener noreferrer">{ja.hirotta.record}</a>{/if}
										・<span class="date">{jaDate(tokyoDate(r.createdAt))}</span>
									</li>
								{/each}
							</ul>
						{/if}
						{#if data.legislator && data.electionStopped}
							<p>{ja.election.stopped}</p>
						{:else if data.legislator && data.myHirotta}
							{#if form && 'hirottaIssue' in form && 'message' in form}<p role="alert">{form.message}</p>{/if}
							<form method="post" action="?/hirotta" use:enhance>
								<input type="hidden" name="kind" value="considering" />
								<input type="hidden" name="op" value={data.myHirotta.considering ? 'remove' : 'add'} />
								<button>{data.myHirotta.considering ? ja.hirotta.unconsider : ja.hirotta.consider}</button>
							</form>
							{#if data.myHirotta.questioned}
								<form method="post" action="?/hirotta" use:enhance>
									<input type="hidden" name="kind" value="questioned" />
									<input type="hidden" name="op" value="remove" />
									<button>{ja.hirotta.unquestion}</button>
								</form>
							{:else}
								<form method="post" action="?/hirotta" use:enhance={() => async ({ update }) => update({ reset: false })} class="question">
									<input type="hidden" name="kind" value="questioned" />
									<input type="hidden" name="op" value="add" />
									<label for="hirotta-url">{ja.hirotta.urlLabel}</label>
									<input id="hirotta-url" name="url" type="url" inputmode="url" maxlength={KOKKAI_URL_MAX} aria-describedby="hirotta-url-hint" />
									<p id="hirotta-url-hint" class="hint">{ja.hirotta.urlHint}</p>
									<button>{ja.hirotta.questioned}</button>
								</form>
							{/if}
						{/if}
					</section>
				{/if}
					{#if data.billCount > 0}
						<a class="bills" href="/kadai/{issue.id}/houan"
							>{ja.issue.billsRow(data.billCount)}<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"
								><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" /></svg
							></a
						>
					{/if}
					{#if !data.mine}
						<section class="report">
							{#if reportMessage}<p role="status">{reportMessage}</p>{/if}
							{#if data.reported}
								{#if reportMessage !== ja.report.already}<p>{ja.report.already}</p>{/if}
							{:else if !data.loggedIn}
								<!-- ログインしていなければ、押すとログインの画面へ（JS がなくても動く） -->
								<form method="get" action="/login">
									<input type="hidden" name="next" value="/kadai/{issue.id}" />
									<button class="link">{ja.report.open}</button>
								</form>
							{:else}
								{#if js && !reportOpen}
									<button type="button" class="link" onclick={() => (reportOpen = true)}>{ja.report.open}</button>
								{/if}
								{#if !js || reportOpen}
									<form method="post" action="?/report" use:enhance>
										<fieldset>
											<legend>{ja.report.legend}</legend>
											{#each ['attack', 'spam', 'duplicate', 'other'] as const as reason (reason)}
												<label class="radio">
													<input type="radio" name="reason" value={reason} bind:group={reasonChoice} />
													{ja.report.reasons[reason]}
												</label>
											{/each}
										</fieldset>
										{#if !js || reasonChoice === 'other'}
											<label for="note">{ja.report.noteLabel}</label>
											<textarea id="note" name="note" maxlength="200" rows="3"></textarea>
										{/if}
										<p class="criteria">{ja.report.criteria} <a href="/unei">{ja.report.criteriaLink}</a></p>
										<button class="submit">{ja.report.submit}</button>
									</form>
								{/if}
							{/if}
						</section>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</main>

<style>
	main {
		padding: 1rem;
	}

	h1 {
		font-size: var(--font-size-page-title);
	}

	h2 {
		margin: 1rem 0 0;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	h2 + p {
		margin-top: 0.25rem;
	}

	.topic {
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	.example {
		white-space: pre-wrap;
	}

	.from-similar {
		padding: 0.75rem 1rem;
		border-radius: var(--radius-m);
		background: var(--color-surface);
	}

	.solutions {
		margin-top: 2rem;
	}

	.solutions h2 {
		margin: 0;
		color: var(--color-text);
		font-size: var(--font-size-heading);
	}

	.solutions h2 span {
		color: var(--color-text-sub);
		font-weight: normal;
	}

	/* スマホは解決策の並びの下に横いっぱい（SpIssue）。PC は見出しの右（下の @media） */
	.solutions .write {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: var(--tap-secondary);
		margin-top: 1rem;
		padding: 0 1rem;
		border: 1px solid var(--color-base);
		border-radius: var(--radius-m);
		color: var(--color-base);
		font-weight: bold;
		text-decoration: none;
	}

	.empty {
		color: var(--color-text-sub);
	}

	.notice {
		padding: 0.75rem 1rem;
		border-radius: var(--radius-m);
		background: var(--color-caution-bg);
		color: var(--color-caution);
	}

	form {
		margin-top: 1.5rem;
	}

	/* 議員の反応（Issue #150） */
	.hirotta {
		margin-top: 1rem;
		padding: 0.75rem 1rem;
		border: 1px solid var(--color-divider);
		border-radius: var(--radius-m);
	}

	.hirotta h2 {
		margin: 0 0 0.5rem;
		font-size: var(--font-size-sub);
	}

	/* 答弁イベント（Issue #153） */
	.toben {
		margin-top: 1rem;
		padding: 0.75rem 1rem;
		border: 1px solid var(--color-divider);
		border-radius: var(--radius-m);
	}

	.toben h2 {
		margin: 0;
		font-size: var(--font-size-sub);
	}

	.toben ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.toben .to-list {
		margin: 0.5rem 0 0;
		font-size: var(--font-size-sub);
	}

	.hirotta ul {
		margin: 0 0 0.5rem;
		padding-left: 1.25rem;
	}

	.hirotta .date,
	.hirotta .hint {
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	.hirotta form {
		margin-top: 0.5rem;
	}

	.hirotta .question {
		display: grid;
		gap: 0.25rem;
	}

	.hirotta input[type='url'] {
		min-height: var(--tap-min);
		padding: 0 0.5rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-s);
		font: inherit;
	}

	.hirotta button {
		min-height: var(--tap-min);
		padding: 0 1rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-m);
		background: var(--color-bg);
		font: inherit;
		justify-self: start;
	}

	.support {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		width: 100%;
		min-height: var(--tap-primary);
		border: 2px solid var(--color-base);
		border-radius: var(--radius-pill);
		background: var(--color-bg);
		color: var(--color-base);
		font: inherit;
		font-weight: bold;
	}

	.support[aria-pressed='true'] {
		background: var(--color-base);
		color: var(--color-bg);
	}

	.hint {
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
		text-align: center;
	}

	[role='alert'] {
		color: var(--color-caution);
	}

	.side-bottom {
		margin-top: 2rem;
	}

	/* 「この課題から生まれた法案 N本 ›」：灰色の行全体が押せる */
	.bills {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		min-height: var(--tap-primary);
		padding: 0 1rem;
		border-radius: var(--radius-m);
		background: var(--color-surface);
		color: var(--color-text);
		text-decoration: none;
	}

	.bills svg {
		flex: none;
	}

	.bills + .report {
		margin-top: 1.5rem;
	}

	.report {
		font-size: var(--font-size-sub);
	}

	.report form {
		display: grid;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}

	.link {
		min-height: var(--tap-min);
		padding: 0;
		border: none;
		background: none;
		color: var(--color-text-sub);
		font: inherit;
		text-decoration: underline;
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

	.criteria {
		color: var(--color-text-sub);
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

	/* PC：左に本文と解決策、右の列に「わかる」の枠と通報（PcIssue）。
	   本文の行の高さは本文と枠の高いほうで決まり、解決策と通報は下の行に入る（右の列の高さで左に空きができない） */
	@media (min-width: 64rem) {
		.layout {
			display: grid;
			grid-template-columns: minmax(0, 1fr) 18.75rem;
			grid-template-rows: auto 1fr;
			column-gap: 3rem;
			align-items: start;
		}

		.head {
			grid-area: 1 / 1;
		}

		.layout.single {
			grid-template-columns: minmax(0, 1fr);
		}

		.head > h1 {
			margin-top: 0;
		}

		.support-box {
			grid-area: 1 / 2;
			margin-top: 0;
			padding: 1.25rem;
			border: 1px solid var(--color-input-border);
			border-radius: var(--radius-l);
		}

		.support-box .hint {
			margin-bottom: 0;
		}

		.rest {
			grid-area: 2 / 1;
		}

		.side-bottom {
			grid-area: 2 / 2;
		}

		/* 解決策の見出しの右に「解決策を書く」。下の区切り線のあとに1行ずつ並べる */
		.solutions {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			align-items: center;
			column-gap: 1rem;
		}

		.solutions > :global(*) {
			grid-column: 1 / -1;
		}

		.solutions > h2 {
			grid-area: 1 / 1;
			padding-bottom: 0.75rem;
		}

		.solutions > .write {
			grid-area: 1 / 2;
			margin: 0 0 0.75rem;
		}

		.solutions > h2 + :global(*) {
			border-top: 1px solid var(--color-divider);
		}
	}
</style>
