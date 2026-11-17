<script lang="ts">
	// 遊び方 2 / 3 の図（Issue #225）：1か月の会期の帯。この段（発議と質疑）を目立たせる
	import { ja } from '#lib/copy/ja.ts';
	import Figure from './Figure.svelte';
	import SessionBand from './SessionBand.svelte';

	type Days = { proposeUntil: number; deliberation: number; discussUntil: number; vote: number };
	let { days }: { days: Days } = $props();
</script>

<Figure label={ja.figures.session.label(days)}>
	<SessionBand {days} current={[0, 1]} />
</Figure>
