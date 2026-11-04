<script lang="ts">
	// 法案を書く・直すフォーム（Issue #46）。キャンバスに案がないので、SpBillChanges の形と Tokens で組む。
	// 変える条を選ぶと、いま施行されている版の見出しと条文を欄に入れる（条文は法令ごとに取りに行く）
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import Turnstile from '#lib/components/Turnstile.svelte';
	import { ja } from '#lib/copy/ja.ts';
	import { BILL_MAX } from '#lib/domain/bills.ts';
	import type { BillFormErrors, BillFormValues, RowField, RowValues } from '#lib/server/bill-form.ts';

	type Article = { num: string; label: string; caption: string; body: string };
	type Articles = { revisionId: string; articles: Article[] };
	let {
		laws,
		candidates,
		initial,
		articles: loaded,
		siteKey,
		edit = null,
		form
	}: {
		laws: { id: string; title: string }[];
		candidates: { id: number; body: string }[];
		initial: BillFormValues;
		articles: Articles | null;
		siteKey: string;
		edit?: { id: number; rev: number } | null;
		form: { values?: BillFormValues; errors?: BillFormErrors; message?: string } | null | undefined;
	} = $props();

	// 断られたときは送った値から始める（JS がなくても入力が残る）
	// svelte-ignore state_referenced_locally
	const start = form?.values ?? initial;
	let key = 0;
	type Row = RowValues & { key: number };
	const toRow = (r: RowValues): Row => ({ ...r, key: key++ });
	let kind = $state(start.kind);
	let title = $state(start.title);
	let law = $state(start.law);
	let base = $state(start.base);
	let affected = $state(start.affected);
	let sideEffects = $state(start.sideEffects);
	let summary = $state(start.summary);
	let supplementary = $state(start.supplementary);
	let chosen = $state<string[]>([...start.solutions]);
	let rows = $state<Row[]>(start.rows.map(toRow));
	// svelte-ignore state_referenced_locally
	let articles = $state<Article[] | null>(loaded && loaded.revisionId ? loaded.articles : null);
	let loading = $state(false);
	let loadFailed = $state(false);
	let token = $state('');
	let turnstile: ReturnType<typeof Turnstile> | undefined = $state();

	const errors = $derived(form?.errors);
	const message = $derived(form?.message);
	const fieldError = (f: keyof BillFormErrors['fields']) => errors?.fields[f];
	const rowError = (i: number, f: RowField) => (errors?.rows[i]?.field === f ? errors.rows[i].message : undefined);
	const byNum = $derived(new Map((articles ?? []).map((a) => [a.num, a])));
	const emptyRow = (): RowValues => ({ op: 'amend', target: '', num: '', caption: '', body: '' });

	/** 法令の条を取りに行く。法令を選び直したときは、その版を基にした版にする */
	let asked = 0;
	async function fetchArticles(lawId: string, setBase: boolean) {
		const mine = ++asked;
		articles = null;
		loadFailed = false;
		if (!lawId) return;
		loading = true;
		try {
			const res = await fetch(`/houan/kaku/joubun?law=${encodeURIComponent(lawId)}`);
			if (mine !== asked) return;
			if (!res.ok) throw new Error(String(res.status));
			const data = (await res.json()) as Articles;
			articles = data.articles;
			if (setBase || !base) base = data.revisionId;
		} catch {
			if (mine === asked) loadFailed = true;
		} finally {
			if (mine === asked) loading = false;
		}
	}

	onMount(() => {
		// 送り直した画面などで条がまだないときは取りに行く（開いたときの版はそのまま）
		if (law && !articles) void fetchArticles(law, false);
	});

	function changeLaw(value: string) {
		law = value;
		base = '';
		// 前の法令の条を指す行は選び直してもらう
		for (const r of rows) if (r.op !== 'add') Object.assign(r, { target: '', caption: '', body: '' });
		void fetchArticles(value, true);
	}

	/** 条を選んだら、その条の見出しと条文を入れる（削除は条文を書かない） */
	function pick(row: Row, num: string) {
		row.target = num;
		const a = byNum.get(num);
		if (a && row.op === 'amend') {
			row.caption = a.caption;
			row.body = a.body;
		}
	}

	function changeOp(row: Row, op: string) {
		row.op = op;
		if (op === 'amend' && row.target && !row.body) pick(row, row.target);
	}

	const optionLabel = (a: Article) => `${a.label}${a.caption}`;
</script>

<form
	method="post"
	use:enhance={() =>
		async ({ result, update }) => {
			await update({ reset: false });
			// 失敗でも 500 などでも、トークンはサーバーで使い終わっている
			if (result.type !== 'redirect') turnstile?.reset();
		}}
>
	{#if edit}<input type="hidden" name="rev" value={edit.rev} />{/if}
	<input type="hidden" name="base" value={base} />

	{#if edit}
		<input type="hidden" name="kind" value={kind} />
		<p class="fixed">{ja.bill.write.kind}：{ja.bill.kinds[kind as 'amend' | 'repeal']}　<span>{ja.bill.write.kindFixed}</span></p>
	{:else}
		<fieldset class="kinds">
			<legend>{ja.bill.write.kind}</legend>
			{#each ['amend', 'repeal'] as const as k (k)}
				<label class="radio"><input type="radio" name="kind" value={k} bind:group={kind} />{ja.bill.kinds[k]}</label>
			{/each}
		</fieldset>
	{/if}
	{#if fieldError('kind')}<p class="error">{fieldError('kind')}</p>{/if}

	<label for="bill-title">{ja.bill.write.title}</label>
	<p class="hint" id="bill-title-hint">{ja.bill.write.titleHint}</p>
	<input
		id="bill-title"
		name="title"
		bind:value={title}
		required
		maxlength={BILL_MAX.title}
		aria-describedby={fieldError('title') ? 'bill-title-hint bill-title-error' : 'bill-title-hint'}
		aria-invalid={fieldError('title') ? 'true' : undefined}
	/>
	{#if fieldError('title')}<p class="error" id="bill-title-error">{fieldError('title')}</p>{/if}

	<label for="bill-law">{ja.bill.write.law}</label>
	<select
		id="bill-law"
		name="law"
		value={law}
		onchange={(e) => changeLaw(e.currentTarget.value)}
		required
		aria-invalid={fieldError('laws') ? 'true' : undefined}
		aria-describedby={fieldError('laws') ? 'bill-law-error' : undefined}
	>
		<option value="">{ja.bill.write.lawPlaceholder}</option>
		{#each laws as l (l.id)}<option value={l.id}>{l.title}</option>{/each}
	</select>
	{#if fieldError('laws')}<p class="error" id="bill-law-error">{fieldError('laws')}</p>{/if}

	{#if kind === 'repeal'}
		<p class="note">{ja.bill.write.repealNote}</p>
		{#if errors?.changes}<p class="error">{errors.changes}</p>{/if}
	{:else}
		<div class="changes">
			<h2>{ja.bill.write.changes}</h2>
			<p class="hint">{ja.bill.write.changesHint}</p>
			{#if !law}<p class="hint">{ja.bill.write.chooseLawFirst}</p>{/if}
			{#if loading}<p class="hint" role="status">{ja.bill.write.loading}</p>{/if}
			{#if loadFailed}<p class="error">{ja.bill.write.loadFailed}</p>{/if}
			{#each rows as row, i (row.key)}
				<fieldset class="row">
					<legend>{ja.bill.write.row(i + 1)}</legend>
					<label for="op-{row.key}">{ja.bill.write.op}</label>
					<select id="op-{row.key}" name="op.{i}" value={row.op} onchange={(e) => changeOp(row, e.currentTarget.value)}>
						{#each ['amend', 'add', 'delete'] as const as op (op)}<option value={op}>{ja.bill.ops[op]}</option>{/each}
					</select>

					{#if row.op === 'add'}
						<label for="num-{row.key}">{ja.bill.write.num}</label>
						<p class="hint" id="num-hint-{row.key}">{ja.bill.write.numHint}</p>
						<input
							id="num-{row.key}"
							name="num.{i}"
							bind:value={row.num}
							required
							maxlength="30"
							aria-describedby="num-hint-{row.key}{rowError(i, 'num') ? ` num-error-${row.key}` : ''}"
							aria-invalid={rowError(i, 'num') ? 'true' : undefined}
						/>
						{#if rowError(i, 'num')}<p class="error" id="num-error-{row.key}">{rowError(i, 'num')}</p>{/if}
					{:else}
						<label for="target-{row.key}">{ja.bill.write.target}</label>
						<select
							id="target-{row.key}"
							name="target.{i}"
							value={row.target}
							onchange={(e) => pick(row, e.currentTarget.value)}
							required
							aria-invalid={rowError(i, 'target') ? 'true' : undefined}
							aria-describedby={rowError(i, 'target') ? `target-error-${row.key}` : undefined}
						>
							<option value="">{ja.bill.write.targetPlaceholder}</option>
							{#each articles ?? [] as a (a.num)}<option value={a.num}>{optionLabel(a)}</option>{/each}
							{#if !articles && row.target}<option value={row.target}>{row.target}</option>{/if}
						</select>
						{#if rowError(i, 'target')}<p class="error" id="target-error-{row.key}">{rowError(i, 'target')}</p>{/if}
					{/if}

					{#if row.op !== 'delete'}
						<label for="caption-{row.key}">{ja.bill.write.caption}</label>
						<input
							id="caption-{row.key}"
							name="caption.{i}"
							bind:value={row.caption}
							maxlength={BILL_MAX.caption}
							aria-invalid={rowError(i, 'caption') ? 'true' : undefined}
							aria-describedby={rowError(i, 'caption') ? `caption-error-${row.key}` : undefined}
						/>
						{#if rowError(i, 'caption')}<p class="error" id="caption-error-{row.key}">{rowError(i, 'caption')}</p>{/if}

						<label for="body-{row.key}">{ja.bill.write.body}</label>
						<p class="hint" id="body-hint-{row.key}">{ja.bill.write.bodyHint}</p>
						<textarea
							id="body-{row.key}"
							name="body.{i}"
							bind:value={row.body}
							required
							rows="8"
							maxlength={BILL_MAX.body}
							aria-describedby="body-hint-{row.key}{rowError(i, 'body') ? ` body-error-${row.key}` : ''}"
							aria-invalid={rowError(i, 'body') ? 'true' : undefined}
						></textarea>
						{#if rowError(i, 'body')}<p class="error" id="body-error-{row.key}">{rowError(i, 'body')}</p>{/if}
					{/if}
					<button type="button" class="link" onclick={() => (rows = rows.filter((r) => r !== row))}>{ja.bill.write.removeRow}</button>
				</fieldset>
			{/each}
			{#if errors?.changes}<p class="error">{errors.changes}</p>{/if}
			{#if rows.length < BILL_MAX.changes}
				<button type="button" onclick={() => rows.push(toRow(emptyRow()))}>{ja.bill.write.addRow}</button>
			{/if}
		</div>
	{/if}

	<label for="bill-affected">{ja.bill.write.affected}</label>
	<textarea
		id="bill-affected"
		name="affected"
		bind:value={affected}
		required
		rows="3"
		maxlength={BILL_MAX.affected}
		aria-invalid={fieldError('affected') ? 'true' : undefined}
		aria-describedby={fieldError('affected') ? 'bill-affected-error' : undefined}
	></textarea>
	{#if fieldError('affected')}<p class="error" id="bill-affected-error">{fieldError('affected')}</p>{/if}

	<label for="bill-side">{ja.bill.write.sideEffects}</label>
	<textarea
		id="bill-side"
		name="sideEffects"
		bind:value={sideEffects}
		required
		rows="4"
		maxlength={BILL_MAX.sideEffects}
		aria-invalid={fieldError('sideEffects') ? 'true' : undefined}
		aria-describedby={fieldError('sideEffects') ? 'bill-side-error' : undefined}
	></textarea>
	{#if fieldError('sideEffects')}<p class="error" id="bill-side-error">{fieldError('sideEffects')}</p>{/if}

	<label for="bill-summary">{ja.bill.write.summary}</label>
	<p class="hint" id="bill-summary-hint">{ja.bill.write.summaryHint}</p>
	<textarea
		id="bill-summary"
		name="summary"
		bind:value={summary}
		rows="3"
		aria-describedby={fieldError('summary') ? 'bill-summary-hint bill-summary-error' : 'bill-summary-hint'}
		aria-invalid={fieldError('summary') ? 'true' : undefined}
	></textarea>
	{#if fieldError('summary')}<p class="error" id="bill-summary-error">{fieldError('summary')}</p>{/if}

	<label for="bill-suppl">{ja.bill.write.supplementary}</label>
	<p class="hint" id="bill-suppl-hint">{ja.bill.write.supplementaryHint}</p>
	<textarea
		id="bill-suppl"
		name="supplementary"
		bind:value={supplementary}
		rows="3"
		maxlength={BILL_MAX.supplementary}
		aria-describedby={fieldError('supplementary') ? 'bill-suppl-hint bill-suppl-error' : 'bill-suppl-hint'}
		aria-invalid={fieldError('supplementary') ? 'true' : undefined}
	></textarea>
	{#if fieldError('supplementary')}<p class="error" id="bill-suppl-error">{fieldError('supplementary')}</p>{/if}

	<fieldset class="solutions" aria-describedby={fieldError('solutions') ? 'bill-solutions-error' : undefined}>
		<legend>{ja.bill.write.solutions}</legend>
		<p class="hint">{ja.bill.write.solutionsHint}</p>
		{#each candidates as c (c.id)}
			<label class="check">
				<input
					type="checkbox"
					name="solution"
					value={String(c.id)}
					bind:group={chosen}
					disabled={!chosen.includes(String(c.id)) && chosen.length >= BILL_MAX.solutions}
				/>
				<span>{c.body}</span>
			</label>
		{/each}
	</fieldset>
	{#if fieldError('solutions')}<p class="error" id="bill-solutions-error">{fieldError('solutions')}</p>{/if}

	<Turnstile {siteKey} bind:token bind:this={turnstile} />
	{#if message}<p role="alert" class="error">{message}</p>{/if}
	<div class="buttons">
		<!-- 条文を読み込むまでは、基にした版が決まらないので送らない -->
		<button class="primary" disabled={!token || (law !== '' && base === '')}>{ja.bill.write.submit}</button>
		<a href={edit ? `/houan/${edit.id}` : '/kadai'}>{ja.bill.write.cancel}</a>
	</div>
</form>

<style>
	form {
		display: grid;
		gap: 0.5rem;
	}

	label,
	legend,
	h2 {
		margin-top: 0.75rem;
		font-weight: bold;
		font-size: var(--font-size-body);
	}

	h2 {
		margin-bottom: 0;
	}

	.hint,
	.fixed span,
	.note {
		margin: 0;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	input:not([type='radio'], [type='checkbox']),
	select,
	textarea {
		min-height: var(--tap-min);
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-m);
		background: var(--color-bg);
		color: var(--color-text);
		font: inherit;
	}

	textarea {
		line-height: var(--line-height-law);
	}

	fieldset {
		display: grid;
		gap: 0.5rem;
		margin: 0;
		border: none;
		padding: 0;
	}

	.kinds {
		display: flex;
		flex-wrap: wrap;
		gap: 0 1.5rem;
	}

	.kinds legend {
		width: 100%;
	}

	.changes {
		display: grid;
		gap: 0.75rem;
	}

	/* SpBillChanges の条のカード */
	.row {
		padding: 0 1rem 1rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-l);
	}

	.row legend {
		padding: 0 0.25rem;
	}

	.radio,
	.check {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: var(--tap-min);
		margin: 0;
		font-weight: normal;
	}

	.check {
		align-items: flex-start;
		padding: 0.5rem 0;
	}

	.check input {
		margin-top: 0.4rem;
	}

	.error {
		margin: 0;
		color: var(--color-caution);
		font-size: var(--font-size-sub);
	}

	.buttons {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-top: 1rem;
	}

	button {
		min-height: var(--tap-secondary);
		padding: 0 1.25rem;
		border: 1px solid var(--color-base);
		border-radius: var(--radius-m);
		background: var(--color-bg);
		color: var(--color-base);
		font: inherit;
		font-weight: bold;
		justify-self: start;
	}

	.primary {
		min-height: var(--tap-primary);
		background: var(--color-base);
		color: var(--color-bg);
	}

	.link {
		border: none;
		padding: 0;
		min-height: var(--tap-min);
		color: var(--color-link);
		font-weight: normal;
		text-decoration: underline;
	}

	button:disabled {
		opacity: 0.5;
	}
</style>
