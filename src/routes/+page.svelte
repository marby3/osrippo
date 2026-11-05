<script lang="ts">
	import { ja } from '#lib/copy/ja.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const s = $derived(data.session);
	const next = $derived(ja.session.next(s));
	/** PC の区切り：発議（1〜2週）・質疑と修正（3週）・採決（4週） */
	const segments = $derived(
		ja.session.segments(s).map((label, i) => ({
			label,
			filled: i <= ['proposal', 'deliberation', 'vote'].indexOf(s.stage),
			current: ['proposal', 'deliberation', 'vote'][i] === s.stage
		}))
	);
</script>

<main>
	<h1>{ja.siteName}</h1>

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

	<p><a href="/kadai">{ja.issue.topLink}</a></p>
	<p><a href="/houan">{ja.bill.list.topLink}</a></p>
	<p><a href="/saiketsu">{ja.vote.topLink}</a></p>
	<!-- 全文検索の入口（設計書 docs/spec/38.md 決めたこと7） -->
	<form method="get" action="/kensaku">
		<label for="top-search">{ja.search.entry}</label>
		<input id="top-search" name="q" type="search" maxlength="60" />
		<button>{ja.search.submit}</button>
	</form>
</main>

<style>
	main {
		max-width: 84rem;
		margin: 0 auto;
		padding: 1rem;
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
