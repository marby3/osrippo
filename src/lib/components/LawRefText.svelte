<script lang="ts">
	// 利用者が書いた本文（課題・解決策・質疑・答弁・補足）。「特商法9条」のような条への言及をリンクにする（Issue #165）。
	// 本文は信頼の境界の外なので、文字とリンクの並び（domain/law/refs.ts）を区切って描く。{@html} は使わない。
	// 引き当ての表はページの load が lawRefs として返す。ないページでは、本文をそのまま出す
	import { page } from '$app/state';
	import { linkLawRefs } from '../domain/law/refs';
	import { openLawCard } from './law-card.svelte';

	let { text }: { text: string } = $props();
	const parts = $derived(page.data.lawRefs ? linkLawRefs(text, page.data.lawRefs) : [{ text, href: undefined }]);
</script>

<!-- 文の中に置くので、要素のあいだに空白や改行を入れない（white-space: pre-wrap の本文がある） -->
{#each parts as part, i (i)}{#if part.href}<a href={part.href} aria-haspopup="dialog" onclick={(e) => openLawCard(e, part.href as string)}>{part.text}</a>{:else}{part.text}{/if}{/each}
