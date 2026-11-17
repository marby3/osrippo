<script lang="ts">
	// 法案の書き方「法案ができるまで」の図（Issue #225）：いつでも書ける3つ → 1か月の会期 → IF世界の法律
	import { ja } from '#lib/copy/ja.ts';
	import Arrow from './Arrow.svelte';
	import Figure from './Figure.svelte';
	import IfLaw from './IfLaw.svelte';
	import NodeRow from './NodeRow.svelte';
	import SessionBand from './SessionBand.svelte';

	type Days = { proposeUntil: number; deliberation: number; discussUntil: number; vote: number };
	let { days }: { days: Days } = $props();
	const t = ja.figures.billFlow;
</script>

<Figure label={t.label(days)}>
	<p class="heading">{t.anytime}</p>
	<NodeRow nodes={t.nodes} stack={false} />
	<div class="down"><Arrow down /></div>
	<p class="heading">{t.session}</p>
	<SessionBand {days} current={[0, 1, 2]} heading={false} />
	<div class="down">
		<Arrow down />
		<span>{t.passed}</span>
	</div>
	<div class="if"><IfLaw title={t.ifLaw} fictional={t.fictional} /></div>
</Figure>

<style>
	.heading {
		margin: 0 0 0.5rem;
		color: var(--color-text-sub);
		font-weight: bold;
	}

	.down {
		display: flex;
		gap: 0.25rem;
		align-items: center;
		justify-content: center;
		margin: 0.5rem 0;
		color: var(--color-text-sub);
	}

	.if {
		max-width: 16rem;
		margin: 0 auto;
	}
</style>
