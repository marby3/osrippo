<script lang="ts">
	let { data } = $props();
	const label = { changed: '変更', added: '新設', removed: 'なくなった条', deleted: '削除', same: '変更なし' } as const;
	const revLabel = (r: { revision_id: string; enforcement_date: string }) => `${r.enforcement_date} 施行（${r.revision_id.split('_')[2]}）`;
</script>

<svelte:head><title>{data.title} の変更点</title></svelte:head>

<main>
	<p><a href="/">← 法令の一覧</a></p>
	<h1>{data.title}</h1>
	<form method="get">
		<label>比べる前の時点
			<select name="from" value={data.from}>
				{#each data.revs as r (r.revision_id)}<option value={r.revision_id}>{revLabel(r)}</option>{/each}
			</select>
		</label>
		<label>後の時点
			<select name="to" value={data.to}>
				{#each data.revs as r (r.revision_id)}<option value={r.revision_id}>{revLabel(r)}</option>{/each}
			</select>
		</label>
		<label><input type="checkbox" name="all" checked={data.all} /> 変更のない条も表示</label>
		<button>比べる</button>
	</form>

	<p class="legend">
		<del><span class="sr">削除：</span>削除された文字</del> は取り消し線、
		<ins><span class="sr">追加：</span>追加された文字</ins> は下線で示します。
		変更のあった条：{data.diffs.filter((d) => d.status !== 'same').length}
	</p>

	{#each data.diffs as d (d.provisionId)}
		<article class="prov {d.status}">
			<h2>
				{d.title}{d.caption}
				<span class="badge">{label[d.status]}</span>
				{#if d.movedFrom}<span class="badge">旧 {d.movedFrom}</span>{/if}
			</h2>
			{#each d.units as u (u.unitId)}
				<p class="unit {u.status}">
					{#if u.label}<span class="num">{u.label}</span>{/if}
					{#each u.segs as s, i (i)}
						{#if s.kind === 'add'}<ins><span class="sr">追加：</span>{s.text}</ins>
						{:else if s.kind === 'del'}<del><span class="sr">削除：</span>{s.text}</del>
						{:else}{s.text}{/if}
					{/each}
				</p>
			{/each}
		</article>
	{:else}
		<p>この2時点の間に変更はありません。</p>
	{/each}
</main>

<style>
	main { max-width: 46rem; margin: 0 auto; padding: 1rem; font-family: system-ui, sans-serif; line-height: 1.9; }
	form { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; align-items: end; }
	label { display: flex; flex-direction: column; font-size: 0.85rem; }
	.prov { border-top: 1px solid #ccc; padding: 0.5rem 0; }
	h2 { font-size: 1rem; margin: 0.5rem 0; }
	.badge { font-size: 0.75rem; border: 1px solid currentColor; border-radius: 0.25rem; padding: 0 0.3rem; margin-left: 0.4rem; }
	.unit { margin: 0.2rem 0; }
	.num { margin-right: 0.5em; font-weight: bold; }
	/* 色だけに頼らない：取り消し線・二重下線と、前後の記号で区別する */
	del { text-decoration: line-through; text-decoration-thickness: 2px; background: #fde2e2; color: #8a1c1c; }
	ins { text-decoration: underline double; background: #dff3e4; color: #10512a; }
	del::before { content: '［−'; } del::after { content: '］'; }
	ins::before { content: '［＋'; } ins::after { content: '］'; }
	.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
	@media (max-width: 30rem) { form { flex-direction: column; align-items: stretch; } }
</style>
