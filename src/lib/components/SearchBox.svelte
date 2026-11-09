<script lang="ts">
	// 探す欄（案 SpIssues・PcIssues、Issue #120）。ホームと課題の一覧で同じ形にする。
	// 見えるボタンは出さず、キーボードの「検索」キーと Enter で送る。読み上げとキーボードのためにボタンは見えない形で残す
	import { ja } from '../copy/ja';

	let {
		id,
		label,
		action,
		value = '',
		hidden = {}
	}: {
		id: string;
		label: string;
		action: string;
		value?: string;
		/** 一緒に送る値（いまの並びや絞り込み） */
		hidden?: Record<string, string>;
	} = $props();
</script>

<form method="get" {action} class="search">
	{#each Object.entries(hidden) as [name, v] (name)}<input type="hidden" {name} value={v} />{/each}
	<label for={id}>{label}</label>
	<input {id} name="q" type="search" {value} maxlength="60" placeholder={ja.search.placeholder} enterkeyhint="search" />
	<button class="visually-hidden">{ja.search.submit}</button>
</form>

<style>
	.search {
		display: grid;
		gap: 0.25rem;
	}

	label {
		font-size: var(--font-size-sub);
		font-weight: bold;
	}

	input {
		min-height: var(--tap-secondary);
		padding: 0 0.75rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-m);
		font: inherit;
	}

	input::placeholder {
		color: var(--color-text-sub);
	}
</style>
