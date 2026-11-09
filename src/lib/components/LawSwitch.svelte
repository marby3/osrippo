<script lang="ts">
	// 現実の法律と IF世界の法律の切り替え（SpLaw・PcLaw）。IF世界を開いているときは紫の塗り
	import { ja } from '../copy/ja';

	let { lawId, current }: { lawId: string; current: 'real' | 'if' } = $props();
</script>

<nav class="switch" aria-label={ja.ifLaw.switchLabel}>
	<a href="/hourei/{lawId}" aria-current={current === 'real' ? 'page' : undefined}>{ja.ifLaw.real}</a>
	<a href="/if/hourei/{lawId}" class="if" aria-current={current === 'if' ? 'page' : undefined}>{ja.ifLaw.ifWorld}</a>
</nav>

<style>
	.switch {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
		max-width: 24rem;
		margin-bottom: 1rem;
	}

	a {
		display: grid;
		place-items: center;
		min-height: var(--tap-min);
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-m);
		background: var(--color-bg);
		color: var(--color-text);
		font-weight: bold;
		text-decoration: none;
	}

	a.if {
		border-color: var(--color-if);
		background: var(--color-if-bg);
		color: var(--color-if);
	}

	a[aria-current='page'] {
		border-width: 2px;
		border-color: var(--color-base);
	}

	/* IF世界を開いているときは紫の塗り。現実の法律は白地に灰色の枠（PcCompare・SpCompare、Issue #124） */
	a.if[aria-current='page'] {
		border-color: var(--color-if);
		background: var(--color-if);
		color: var(--color-bg);
	}

	/* PC は法令名の行の右に置く（置き場所はページが決める）。幅は文字に合わせる */
	@media (min-width: 64rem) {
		.switch {
			grid-template-columns: auto auto;
			margin-bottom: 0;
		}

		a {
			padding: 0 1.25rem;
		}
	}
</style>
