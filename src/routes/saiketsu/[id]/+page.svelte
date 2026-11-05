<script lang="ts">
	// 投票の画面。SvelteKit は番号だけが変わる移動でコンポーネントを作り直さないので、選んだ票と「一覧を見た」印を別の法案に残さないよう、法案ごとに作り直す
	import { ja } from '#lib/copy/ja.ts';
	import type { PageProps } from './$types';
	import VoteBill from './VoteBill.svelte';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>{ja.vote.pageTitle(data.bill.title)}</title>
</svelte:head>

{#key data.bill.id}
	<VoteBill {data} {form} />
{/key}
