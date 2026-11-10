<!-- 議員にできない操作の代わりに出す文言（設計書 docs/spec/158.md の 3） -->
<script lang="ts">
	import { ja } from '#lib/copy/ja.ts';
</script>

<p class="legislator-note">{ja.guard.legislator}</p>

<style>
	.legislator-note {
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius-m);
		background: var(--color-surface);
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}
</style>
