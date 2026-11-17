<script lang="ts">
	// 遊び方 3 / 3 の図（Issue #225）：可決 → IF世界の法律は変わる／現実の法律は変わらない（2本の道）
	import { ja } from '#lib/copy/ja.ts';
	import Arrow from './Arrow.svelte';
	import Figure from './Figure.svelte';
	import FigureIcon from './FigureIcon.svelte';
	import IfLaw from './IfLaw.svelte';

	const t = ja.figures.ifWorld;
</script>

<Figure label={t.label}>
	<div class="passed">
		<span class="icon"><FigureIcon name="vote" /></span>
		<span>{t.passed}</span>
	</div>
	<div class="lanes">
		<div class="lane">
			<Arrow down />
			<IfLaw title={t.ifLaw} fictional={t.fictional} note={t.changes} />
		</div>
		<div class="lane">
			<!-- 現実の側は、点線の道の先に×（届かない） -->
			<svg class="blocked" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
				<path class="road" d="M12 1v9" />
				<path d="M8 13l8 8M16 13l-8 8" />
			</svg>
			<div class="real" data-lane="real">
				<span class="title">{t.realLaw}</span>
				<span class="note">{t.unchanged}</span>
			</div>
		</div>
	</div>
</Figure>

<style>
	.passed {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		justify-content: center;
		width: fit-content;
		margin: 0 auto;
		padding: 0.5rem 1rem;
		border: 2px solid var(--color-base);
		border-radius: var(--radius-m);
		background: var(--color-bg);
		font-size: var(--font-size-body);
		font-weight: bold;
	}

	.icon {
		color: var(--color-base);
	}

	.lanes {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}

	.lane {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		align-items: stretch;
		padding-top: 0.375rem;
	}

	.lane > :global(.arrow),
	.blocked {
		align-self: center;
	}

	.blocked {
		width: 1.5rem;
		height: 1.5rem;
		color: var(--color-text-sub);
		stroke-width: 2;
		stroke-linecap: round;
	}

	.road {
		stroke-dasharray: 2 3;
	}

	.lane :global(.arrow) {
		width: 1.5rem;
		height: 1.5rem;
	}

	.real {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		align-items: center;
		padding: 0.625rem 0.5rem;
		border: 2px solid var(--color-input-border);
		border-radius: var(--radius-m);
		background: var(--color-bg);
		text-align: center;
		overflow-wrap: anywhere;
	}

	.title {
		font-size: var(--font-size-body);
		font-weight: bold;
	}
</style>
