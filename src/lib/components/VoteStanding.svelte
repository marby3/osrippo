<script lang="ts">
	// 自分の票がどう数えられるかの案内（Issue #70 基準7）。採決の一覧と投票の画面で共通
	import { ja } from '../copy/ja';

	let { eligible, total, done }: { eligible: boolean; total: number; done: number } = $props();
	const parts = $derived(total === 0 ? ja.vote.noAssignment() : done < total ? ja.vote.pending(total) : ja.vote.finished());
</script>

{#if eligible}
	<p>{parts[0]}<strong>{parts[1]}</strong>{parts[2]}</p>
{:else}
	<p>{ja.vote.reference}</p>
{/if}

<style>
	p {
		margin: 0;
		overflow-wrap: anywhere;
	}
</style>
