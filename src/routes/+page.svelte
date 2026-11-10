<script lang="ts">
	import SearchBox from '#lib/components/SearchBox.svelte';
	import LawText from '#lib/components/LawText.svelte';
	import VoteStanding from '#lib/components/VoteStanding.svelte';
	import { ja } from '#lib/copy/ja.ts';
	import { fullYears } from '#lib/domain/law/index.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const s = $derived(data.session);
	const a = $derived(data.assignment);
	const next = $derived(ja.session.next(s));
	const t = $derived(data.todayArticle);
	/** どれだけ変わっていないか。法令のページの条の下と同じ文（Issue #128 基準2） */
	const age = $derived(
		!t
			? ''
			: t.lastAmended
				? ja.law.amended(t.lastAmended, fullYears(t.lastAmended, data.today))
				: t.enacted
					? ja.law.enacted(t.enacted, fullYears(t.enacted, data.today))
					: ja.law.unchangedSinceBaseline
	);
	/** PC の区切り：発議（1〜2週）・質疑と修正（3週）・採決（4週） */
	const segments = $derived(
		ja.session.segments(s).map((label, i) => ({
			label,
			filled: i <= ['proposal', 'deliberation', 'vote'].indexOf(s.stage),
			current: ['proposal', 'deliberation', 'vote'][i] === s.stage
		}))
	);
</script>

{#snippet today(t: NonNullable<typeof data.todayArticle>, where: 'sp' | 'pc')}
	<!-- 今日の条文（Issue #128）。日本時間の日付で1日1本 -->
	<section class="today" aria-labelledby="today-heading-{where}">
		<h2 id="today-heading-{where}">{ja.today.heading}{ja.today.join}<a href="/hourei/{t.lawId}#jo-{t.num}">{t.lawTitle}{' '}{t.label}</a></h2>
		<p class="text" data-today-text><LawText text={t.text} /></p>
		<p class="age" data-today-age>{age}</p>
	</section>
{/snippet}

<main class="frame home">
	<!-- 見出しは読み上げ用。画面ではメニューのサイト名が代わり（SpHome・PcHome、Issue #120） -->
	<h1 class="visually-hidden">{ja.siteName}</h1>

	<!-- 今の会期（画面の案 SpHome・PcHome）。進み具合は「いまは …」の文でも分かる -->
	<section class="session" aria-labelledby="session-now">
		<p class="name">{ja.session.name(s)}</p>
		<h2 id="session-now">
			{ja.session.now}{' '}{ja.session.stages[s.stage]}<span class="pc">{ja.session.week(s.week)}</span>
		</h2>
		<ol class="bars sp" aria-label={ja.session.progress}>
			{#each [1, 2, 3, 4] as week}
				<!-- 棒は見た目だけ。読み上げでは「1週目（済み）」のように読む -->
				<li data-filled={week <= s.week ? '' : undefined}><span class="hidden">{ja.session.bar(week, week <= s.week)}</span></li>
			{/each}
		</ol>
		<ol class="segments pc" aria-label={ja.session.progress}>
			{#each segments as seg}
				<li data-filled={seg.filled ? '' : undefined} class:current={seg.current}>{seg.label}</li>
			{/each}
		</ol>
		<p class="next sp">{next[0]}{' '}<strong>{next[1]}</strong>{' '}{next[2]}</p>
	</section>

	<!-- PC の右の列（PcHome） -->
	<div class="side">
		{#if a}
			<!-- あなたの割り当て法案（Issue #127）。本数は採決の期間に決まる。スマホは今の会期の下、PC は右の列 -->
			<section class="assignment" aria-labelledby="assignment-heading">
				<h2 id="assignment-heading">{ja.assignment.heading(a.open ? a.total : null)}</h2>
				{#if !a.open}
					<p>{ja.assignment.before}</p>
				{:else}
					{#if a.total > 0}
						<p class="progress">{ja.assignment.progress(a.done, a.total)}</p>
					{/if}
					<VoteStanding eligible={a.eligible} total={a.total} done={a.done} />
					<a class="open" href="/saiketsu">{a.total > 0 ? ja.assignment.open : ja.assignment.list}</a>
				{/if}
			</section>
		{/if}
		{#if t}<div class="pc">{@render today(t, 'pc')}</div>{/if}
	</div>

	{#if data.featured.length}
		<!-- 注目の課題（Issue #130）。課題の一覧の「最近『わかる』が増えている順」の上から。スマホは3件、PC は4件 -->
		<section class="featured" aria-labelledby="featured-heading">
			<div class="featured-head">
				<h2 id="featured-heading">{ja.featured.heading}</h2>
				<a class="pc" href="/kadai?sort=rising">{ja.featured.more}</a>
			</div>
			<ul>
				{#each data.featured as issue, i (issue.id)}
					<li class:fourth={i >= 3}>
						<a href="/kadai/{issue.id}">{issue.title}</a>
						<span class="count">{ja.featured.supports(issue.supports)}</span>
					</li>
				{/each}
			</ul>
			<p class="sp more"><a href="/kadai?sort=rising">{ja.featured.more}</a></p>
		</section>
	{/if}

	<!-- 全文検索の入口（設計書 docs/spec/38.md 決めたこと7）。課題の一覧と同じ形（Issue #120） -->
	<div class="search"><SearchBox id="top-search" label={ja.search.entry} action="/kensaku" /></div>

	<!-- スマホは探す欄の下（SpHome）。見た目の順と読み上げの順をそろえるため、PC とスマホで別の場所に置き、片方は出さない -->
	{#if t}<div class="sp">{@render today(t, 'sp')}</div>{/if}
</main>

<style>
	main {
		padding: 1rem;
	}
	.featured {
		margin-bottom: 1.5rem;
		max-width: 50rem;
	}
	.featured-head h2 {
		margin: 0 0 0.5rem;
		font-size: var(--font-size-heading);
	}
	.featured ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.featured li {
		display: grid;
		gap: 0.25rem;
		padding: 0.75rem 0;
		border-bottom: 1px solid var(--color-divider);
	}
	.featured li a {
		color: var(--color-text);
		font-weight: bold;
		text-decoration: none;
		overflow-wrap: anywhere;
	}
	.featured li a:hover {
		text-decoration: underline;
	}
	.featured .count {
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}
	/* スマホは3件（SpHome） */
	.featured li.fourth {
		display: none;
	}
	.featured .more {
		margin: 0.75rem 0 0;
	}
	.today {
		margin-top: 1.5rem;
		padding: 1rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-l);
	}
	.today h2 {
		margin: 0 0 0.5rem;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
		font-weight: normal;
	}
	.today p {
		margin: 0;
		overflow-wrap: anywhere;
	}
	.today .text {
		line-height: var(--line-height-law);
	}
	.today .age {
		margin-top: 0.5rem;
		font-size: var(--font-size-sub);
		font-weight: bold;
	}
	.search {
		max-width: 50rem;
	}

	.assignment {
		display: grid;
		gap: 0.75rem;
		margin: 0 0 1.5rem;
		padding: 1rem;
		border: 2px solid var(--color-base);
		border-radius: var(--radius-l);
	}
	.assignment h2 {
		margin: 0;
		font-size: var(--font-size-heading);
	}
	.assignment p {
		margin: 0;
	}
	.assignment .progress {
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}
	.open {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: var(--tap-primary);
		padding: 0 1rem;
		border-radius: var(--radius-m);
		background: var(--color-base);
		color: var(--color-bg);
		font-weight: bold;
		text-decoration: none;
	}

	.session {
		margin: 1rem 0 1.5rem;
		max-width: 50rem;
	}
	.name {
		margin: 0;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}
	h2 {
		margin: 0.5rem 0 0.75rem;
		font-size: var(--font-size-page-title);
	}
	ol {
		display: grid;
		gap: 0.375rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.bars {
		grid-template-columns: repeat(4, 1fr);
	}
	.bars li {
		height: 0.5rem;
		border: 1px solid var(--color-base);
		border-radius: var(--radius-pill);
	}
	.bars li[data-filled] {
		background: var(--color-base);
	}
	.segments {
		grid-template-columns: 2fr 1fr 1fr;
	}
	.segments li {
		position: relative;
		padding-top: 1.25rem;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}
	.segments li::before {
		content: '';
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 0.5rem;
		border: 1px solid var(--color-base);
		border-radius: var(--radius-pill);
		box-sizing: border-box;
	}
	.segments li[data-filled]::before {
		background: var(--color-base);
	}
	.segments li.current {
		color: var(--color-text);
		font-weight: 700;
	}
	.hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	.next {
		margin: 0.75rem 0 0;
		font-size: var(--font-size-sub);
	}
	.pc {
		display: none;
	}
	@media (min-width: 64rem) {
		/* PcHome：左に今の会期と探す欄、右の列にカード */
		.home {
			display: grid;
			grid-template-columns: minmax(0, 1fr) 20rem;
			/* 右の列が高くなった分は4段目（空き）が受け持ち、左の列（今の会期・注目の課題・探す欄）は詰めたままにする。
			   読み上げの順は、スマホの見た目の順（今の会期 → 割り当て → 注目の課題）に合わせ、PC では右の列のカードが注目の課題より先になる */
			grid-template-rows: auto auto auto 1fr;
			column-gap: 2.5rem;
			align-content: start;
			align-items: start;
		}
		.home > :not(.side, h1) {
			grid-column: 1;
		}
		/* 左の列は今の会期・注目の課題・探す欄の3段と空きの段。ホームに段を足したら rows も合わせる */
		.side {
			display: grid;
			gap: 1.5rem;
			grid-column: 2;
			grid-row: 1 / -1;
			margin-top: 1rem;
		}
		.assignment,
		.today {
			margin: 0;
		}
		/* PcHome：見出しの行の右に「課題をもっと見る」、行は課題名と「わかる」を左右に、4件 */
		.featured-head {
			display: flex;
			align-items: baseline;
			justify-content: space-between;
			gap: 1rem;
			padding-bottom: 0.75rem;
			border-bottom: 1px solid var(--color-divider);
		}
		.featured-head h2 {
			margin: 0;
		}
		.featured li {
			grid-template-columns: minmax(0, 1fr) auto;
			align-items: center;
			gap: 1rem;
			padding: 1.25rem 0;
		}
		.featured li.fourth {
			display: grid;
		}
		.sp {
			display: none;
		}
		.pc {
			display: revert;
		}
		ol.pc {
			display: grid;
		}
	}
</style>
