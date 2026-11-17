<script lang="ts">
	// 遊び方 1 / 3 の図（Issue #225）：課題 →「わかる」→ 解決策
	import { ja } from '#lib/copy/ja.ts';
	import Figure from './Figure.svelte';
	import NodeRow from './NodeRow.svelte';

	const t = ja.figures.issue;
</script>

<Figure label={t.label}>
	<NodeRow nodes={t.nodes} />
</Figure>
