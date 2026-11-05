<script lang="ts">
	// IF世界の帯（Tokens の紫の斜線）。スマホは短く、PC は長く書く（SpResult・PcResult）。#72 の法令のページも使う
	import { ja } from '../copy/ja';
</script>

<div class="band" data-if-band>
	<span class="label">{ja.ifBand.label}</span>
	<span class="short">{ja.ifBand.short}</span>
	<span class="long">{ja.ifBand.long}</span>
</div>

<style>
	.band {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		justify-content: center;
		min-height: 2.75rem;
		padding: 0.5rem 1rem;
		background-image: repeating-linear-gradient(135deg, var(--color-if) 0 12px, var(--color-if-dark) 12px 24px);
		color: var(--color-bg);
		font-size: var(--font-size-sub);
		font-weight: bold;
	}

	.label {
		padding: 0 0.5rem;
		border: 1px solid var(--color-bg);
		border-radius: var(--radius-s);
		white-space: nowrap;
	}

	.long {
		display: none;
	}

	@media (min-width: 64rem) {
		.short {
			display: none;
		}

		.long {
			display: inline;
		}
	}
</style>
