<script lang="ts">
	// 表示の設定（Issue #129。SpLaw・PcLaw の「表示の設定」）。文字の大きさとふりがなを選ぶ。
	// 開くのは details、保存はふつうのフォームの POST なので、スクリプトなしでも使える
	import { page } from '$app/state';
	import { ja } from '../copy/ja';
	import { DEFAULT_DISPLAY, TEXT_SIZES } from '../domain/display';

	const current = $derived(page.data.display ?? DEFAULT_DISPLAY);
	// # はサーバーに届かないので、スクリプトが動いたあとの値で足す（開いていた条へ戻る）
	const back = $derived(page.url.pathname + page.url.search + page.url.hash);
</script>

<details class="display">
	<summary>
		<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 7h16M7 12h10M10 17h4" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" /></svg>
		{ja.display.open}
	</summary>
	<form method="post" action="/hyouji">
		<input type="hidden" name="back" value={back} />
		<fieldset>
			<legend>{ja.display.size}</legend>
			{#each TEXT_SIZES as size}
				<label><input type="radio" name="size" value={size} checked={current.size === size} />{ja.display.sizes[size]}</label>
			{/each}
		</fieldset>
		<fieldset>
			<legend>{ja.display.ruby}</legend>
			<label><input type="radio" name="ruby" value="on" checked={current.ruby} />{ja.display.rubyOn}</label>
			<label><input type="radio" name="ruby" value="off" checked={!current.ruby} />{ja.display.rubyOff}</label>
		</fieldset>
		<button type="submit">{ja.display.save}</button>
	</form>
</details>

<style>
	.display {
		position: relative;
	}
	summary {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		min-height: var(--tap-min);
		padding: 0 1rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-pill);
		background: var(--color-bg);
		font-size: var(--font-size-sub);
		cursor: pointer;
		list-style: none;
		white-space: nowrap;
	}
	summary::-webkit-details-marker {
		display: none;
	}
	form {
		position: absolute;
		top: calc(100% + 0.5rem);
		right: 0;
		z-index: 10;
		display: grid;
		gap: 1rem;
		width: max-content;
		max-width: calc(100vw - 2rem);
		padding: 1rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-l);
		background: var(--color-bg);
	}
	fieldset {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1rem;
		margin: 0;
		padding: 0;
		border: 0;
	}
	legend {
		margin-bottom: 0.25rem;
		padding: 0;
		font-weight: bold;
		font-size: var(--font-size-sub);
	}
	label {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		min-height: var(--tap-min);
	}
	button {
		min-height: var(--tap-min);
		border: 0;
		border-radius: var(--radius-m);
		background: var(--color-base);
		color: var(--color-bg);
		font: inherit;
		font-weight: bold;
	}
</style>
