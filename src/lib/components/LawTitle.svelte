<script lang="ts">
	// 法令名。e-Gov の読み仮名（title_kana）があれば上に付ける（Issue #129 基準3）。読み仮名は LawText と同じく CSS で描く
	let { title, kana }: { title: string; kana: string | null } = $props();
</script>

{#if kana}<ruby>{title}<rt data-rt={kana}></rt></ruby>{:else}{title}{/if}
