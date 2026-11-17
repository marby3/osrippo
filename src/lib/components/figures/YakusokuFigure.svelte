<script lang="ts">
	// β版のお約束の要点の図（Issue #225）。順番はないので矢印は付けない
	import { ja } from '#lib/copy/ja.ts';
	import Figure from './Figure.svelte';
	import NodeRow from './NodeRow.svelte';

	const t = ja.figures.yakusoku;
</script>

<Figure label={t.label}>
	<NodeRow nodes={t.points} arrows={false} />
</Figure>
