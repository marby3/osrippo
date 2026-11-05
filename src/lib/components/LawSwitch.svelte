<script lang="ts">
	// 現実の法律と IF世界の法律の切り替え（SpLaw・PcLaw）
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
</style>
