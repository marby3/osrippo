<script lang="ts">
	// IF世界の法律の札（Issue #225）。IF世界の帯（IfBand）と同じ紫の斜線に、「架空」の札。色だけで示さない
	let { title, fictional, note }: { title: string; fictional: string; note?: string } = $props();
</script>

<div class="if" data-lane="if">
	<span class="tag">{fictional}</span>
	<span class="title">{title}</span>
	{#if note}<span class="note">{note}</span>{/if}
</div>

<style>
	.if {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		align-items: center;
		padding: 0.625rem 0.5rem;
		border-radius: var(--radius-m);
		background-image: repeating-linear-gradient(135deg, var(--color-if) 0 12px, var(--color-if-dark) 12px 24px);
		color: var(--color-bg);
		font-weight: bold;
		text-align: center;
		overflow-wrap: anywhere;
	}

	.tag {
		padding: 0 0.5rem;
		border: 1px solid var(--color-bg);
		border-radius: var(--radius-s);
	}

	.title {
		font-size: var(--font-size-body);
	}
</style>
