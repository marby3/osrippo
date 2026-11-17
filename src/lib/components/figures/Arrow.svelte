<script lang="ts">
	// 図の矢印（Issue #225）。既定は右向き。down は下向き、up は上向き。読み上げない
	let { down = false, up = false }: { down?: boolean; up?: boolean } = $props();
</script>

<svg class="arrow" class:down class:up viewBox="0 0 16 16" aria-hidden="true" focusable="false">
	<path d="M2 8h11M9 4l4 4-4 4" />
</svg>

<style>
	.arrow {
		display: block;
		flex: none;
		width: 1rem;
		height: 1rem;
		color: var(--color-text-sub);
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.down {
		transform: rotate(90deg);
	}

	.up {
		transform: rotate(-90deg);
	}
</style>
