<script lang="ts">
	// 法案を書く・直すフォーム（Issue #46・#53）。キャンバスに案がないので、SpBillChanges の形と Tokens で組む。
	// 変える条を選ぶと、いま施行されている版の見出しと条文を欄に入れる（条文は法令ごとに取りに行く）。
	// 法令は枠ごとに持ち、2本目からは law.N・base.N・action.N で送る。変更の行は法案全体の通し番号で、どの法令の行かを seq.i で送る（docs/spec/53.md 決めたこと3）
	import { enhance } from '$app/forms';
	import { onMount, tick } from 'svelte';
	import Turnstile from '#lib/components/Turnstile.svelte';
	import { ja } from '#lib/copy/ja.ts';
	import { BILL_MAX, ENACT_PLACEHOLDER, ENACT_PURPOSE_CAPTION } from '#lib/domain/bills.ts';
	import type { BillFormErrors, BillFormValues, RowField, RowValues } from '#lib/server/bill-form.ts';

	type Article = { num: string; label: string; caption: string; body: string };
	type Articles = { revisionId: string; articles: Article[] };
	type Candidate = { id: number; body: string; issueId: number; issueTitle: string };
	type Conflict = { key: string; lawTitle: string | null; num: string; label: string; caption: string; body: string };
	let {
		laws,
		candidates,
		initial,
		articles: loaded,
		siteKey,
		edit = null,
		dropped = 0,
		conflicts = [],
		goneRows = [],
		adjusting = false,
		titleFree = false,
		back,
		form
	}: {
		laws: { id: string; title: string }[];
		candidates: Candidate[];
		initial: BillFormValues;
		/** 法令の位置ごとの条（読んでいなければ null） */
		articles: (Articles | null)[];
		siteKey: string;
		edit?: { id: number; rev: number } | null;
		/** 非表示になって引用から外れる解決策の数（直すとき） */
		dropped?: number;
		/** 基にしたあとで変わった条のいまの条文（docs/spec/72.md の B2） */
		conflicts?: Conflict[];
		/** なくなった条を指している行の位置（docs/spec/95.md 決めたこと4） */
		goneRows?: number[];
		/** 要調整を直す：題名と対象の法令は変えられない。titleFree は法令名の重なりで、法令名は変えられる */
		adjusting?: boolean;
		titleFree?: boolean;
		/** 「やめる」の行き先 */
		back: string;
		form: { values?: BillFormValues; errors?: BillFormErrors; message?: string; conflicts?: Conflict[] } | null | undefined;
	} = $props();

	// 断られた結果を読み込み直したときは、送った値から始める
	// svelte-ignore state_referenced_locally
	const start = form?.values ?? initial;
	const shownConflicts = $derived(form?.conflicts ?? conflicts);
	let key = 0;
	type Row = RowValues & { key: number };
	const toRow = (r: RowValues): Row => ({ ...r, key: key++ });
	let kind = $state(start.kind);
	let title = $state(start.title);
	let newTitle = $state(start.newTitle);
	let affected = $state(start.affected);
	let sideEffects = $state(start.sideEffects);
	let summary = $state(start.summary);
	let supplementary = $state(start.supplementary);
	let chosen = $state<string[]>([...start.solutions]);
	const template = (): RowValues => ({ op: 'add', target: '', num: '', caption: ENACT_PURPOSE_CAPTION, body: ja.bill.write.enactTemplateBody(ENACT_PLACEHOLDER) });
	const emptyRow = (): RowValues => ({ op: 'amend', target: '', num: '', caption: '', body: '' });
	const rowsOf = (seq: number) => start.rows.filter((r) => Number(r.seq || 0) === seq);

	/** 法令の枠。0 が主の法令（制定では使わず、新法の条は enactRows） */
	type Slot = { key: number; law: string; base: string; action: string; articles: Article[] | null; loading: boolean; loadFailed: boolean; asked: number; rows: Row[] };
	let slotKey = 0;
	const toSlot = (law: string, base: string, action: string, got: Articles | null | undefined, rows: RowValues[]): Slot => ({
		key: slotKey++,
		law,
		base,
		action,
		articles: got && got.revisionId ? got.articles : null,
		loading: false,
		loadFailed: false,
		asked: 0,
		rows: rows.map(toRow)
	});
	let slots = $state<Slot[]>([
		// svelte-ignore state_referenced_locally
		toSlot(start.law, start.base, start.kind, loaded[0], start.kind === 'enact' ? [emptyRow()] : rowsOf(0)),
		// svelte-ignore state_referenced_locally
		...start.extras.map((x, i) => toSlot(x.law, x.base, x.action, loaded[i + 1], rowsOf(i + 1)))
	]);
	/** 制定の条。種類を切り替えても、改正の行とは別に残す。第1条はひな形から始める */
	let enactRows = $state<Row[]>((start.kind === 'enact' && rowsOf(0).length ? rowsOf(0) : [template()]).map(toRow));
	let token = $state('');
	let turnstile: ReturnType<typeof Turnstile> | undefined = $state();

	/** 足した法令の扱い。廃止の法案だけ選べ、ほかは改正 */
	const actionOf = (slot: Slot, n: number) => (n === 0 ? kind : kind === 'repeal' ? slot.action : 'amend');
	/** 送る順の変更の行：新法の条か主の法令の行、そのあと足した法令の行 */
	const order = $derived([
		...(kind === 'enact' ? enactRows.map((row) => ({ row, seq: 0, enact: true })) : kind === 'amend' ? slots[0].rows.map((row) => ({ row, seq: 0, enact: false })) : []),
		...slots.slice(1).flatMap((slot, j) => (actionOf(slot, j + 1) === 'amend' && slot.law ? slot.rows.map((row) => ({ row, seq: j + 1, enact: false })) : []))
	]);
	const indexOf = $derived(new Map(order.map((o, i) => [o.row.key, i])));
	/** 「変更 N」の N（新法の条は「第N条」なので数えない） */
	const changeNumber = $derived(new Map(order.filter((o) => !o.enact).map((o, i) => [o.row.key, i + 1])));

	const errors = $derived(form?.errors);
	const message = $derived(form?.message);
	const fieldError = (f: keyof BillFormErrors['fields']) => errors?.fields[f];
	/** 送ったときの行と枠の並び。誤りは送ったときの位置で返るので、外したあとも同じ行と枠に出す */
	// svelte-ignore state_referenced_locally
	let sentKeys = $state(order.map((o) => o.row.key));
	// svelte-ignore state_referenced_locally
	let sentSlots = $state(slots.map((s) => s.key));
	/** なくなった条を指している行（読み込んだときの行）。選び直すと消える（docs/spec/95.md 決めたこと4） */
	// svelte-ignore state_referenced_locally
	const goneKeys = new Set(goneRows.map((i) => sentKeys[i]));
	const rowError = (row: Row, f: RowField) => {
		const e = errors?.rows[sentKeys.indexOf(row.key)];
		if (e?.field === f) return e.message;
		return !form?.errors && f === 'target' && goneKeys.has(row.key) && !row.target ? ja.torikomi.goneRow : undefined;
	};
	const slotError = (slot: Slot) => errors?.laws?.[sentSlots.indexOf(slot.key)];
	/** 欄の誤りだけのときも、押したボタンのそばで知らせる */
	const alertText = $derived(
		message ??
			(errors && (Object.keys(errors.fields).length || Object.keys(errors.rows).length || errors.changes || (errors.laws && Object.keys(errors.laws).length)) ? ja.bill.fixErrors : undefined)
	);
	let formEl: HTMLFormElement;

	/** 法令を使っている枠（制定の主の枠は使わない） */
	const usedSlots = $derived(kind === 'enact' ? slots.slice(1) : slots);
	/** 枠で選べる法令：ほかの枠で選んだ法令は出さない */
	const optionsFor = (slot: Slot) => laws.filter((l) => l.id === slot.law || !usedSlots.some((o) => o !== slot && o.law === l.id));
	const canAddLaw = $derived(!adjusting && slots.length < BILL_MAX.laws && laws.some((l) => !usedSlots.some((o) => o.law === l.id)));

	/** 法令の条を取りに行く。法令を選び直したときは、その版を基にした版にする */
	async function fetchArticles(slot: Slot, setBase: boolean) {
		const mine = ++slot.asked;
		slot.articles = null;
		slot.loadFailed = false;
		if (!slot.law) return;
		slot.loading = true;
		try {
			const res = await fetch(`/houan/kaku/joubun?law=${encodeURIComponent(slot.law)}`);
			if (mine !== slot.asked) return;
			if (!res.ok) throw new Error(String(res.status));
			const data = (await res.json()) as Articles;
			if (mine !== slot.asked) return;
			slot.articles = data.articles;
			if (setBase || !slot.base) slot.base = data.revisionId;
		} catch {
			if (mine === slot.asked) slot.loadFailed = true;
		} finally {
			if (mine === slot.asked) slot.loading = false;
		}
	}

	onMount(() => {
		// 送り直した画面などで条がまだないときは取りに行く（開いたときの版はそのまま）
		for (const slot of slots) if (slot.law && !slot.articles) void fetchArticles(slot, false);
	});

	function changeLaw(slot: Slot, value: string) {
		slot.law = value;
		slot.base = '';
		// 前の法令の条を指す行は選び直してもらう
		for (const r of slot.rows) if (r.op !== 'add') Object.assign(r, { target: '', caption: '', body: '' });
		void fetchArticles(slot, true);
	}

	function addLaw() {
		slots.push(toSlot('', '', 'amend', null, [emptyRow()]));
	}

	/** 条を選んだら、その条の見出しと条文を入れる（削除は条文を書かない） */
	function pick(slot: Slot, row: Row, num: string) {
		row.target = num;
		const a = (slot.articles ?? []).find((x) => x.num === num);
		if (a && row.op === 'amend') {
			row.caption = a.caption;
			row.body = a.body;
		}
	}

	function changeOp(slot: Slot, row: Row, op: string) {
		row.op = op;
		if (op === 'amend' && row.target && !row.body) pick(slot, row, row.target);
	}

	const optionLabel = (a: Article) => `${a.label}${a.caption}`;

	// ---- ほかの課題の解決策を探す（docs/spec/53.md 決めたこと7） ----
	/** 探して足した候補。画面の状態に持つ（送り直しても消えない） */
	let found = $state<Candidate[]>([]);
	const allCandidates = $derived([...candidates, ...found.filter((f) => !candidates.some((c) => c.id === f.id))]);
	const groups = $derived(
		allCandidates.reduce<{ issueId: number; issueTitle: string; items: Candidate[] }[]>((out, c) => {
			const g = out.find((x) => x.issueId === c.issueId);
			if (g) g.items.push(c);
			else out.push({ issueId: c.issueId, issueTitle: c.issueTitle, items: [c] });
			return out;
		}, [])
	);
	let query = $state('');
	let results = $state<{ rows: Candidate[]; more: boolean } | null>(null);
	let searchError = $state<string | null>(null);
	async function search() {
		searchError = null;
		try {
			const res = await fetch(`/houan/kaku/kaiketsu?q=${encodeURIComponent(query)}`);
			if (!res.ok) throw new Error(String(res.status));
			const data = (await res.json()) as { error?: 'short' | 'long' | 'control'; rows?: Candidate[]; more?: boolean };
			if (data.error) {
				results = null;
				searchError = ja.search.errors[data.error];
			} else results = { rows: data.rows ?? [], more: Boolean(data.more) };
		} catch {
			results = null;
			searchError = ja.bill.write.searchFailed;
		}
	}
	function choose(c: Candidate) {
		if (!allCandidates.some((x) => x.id === c.id)) found.push(c);
		if (!chosen.includes(String(c.id)) && chosen.length < BILL_MAX.solutions) chosen.push(String(c.id));
	}
</script>

{#snippet changeRow(slot: Slot, row: Row, seq: number)}
	{@const i = indexOf.get(row.key) ?? 0}
	<fieldset class="row">
		<legend>{ja.bill.write.row(changeNumber.get(row.key) ?? 0)}</legend>
		{#if seq > 0}<input type="hidden" name="seq.{i}" value={seq} />{/if}
		<label for="op-{row.key}">{ja.bill.write.op}</label>
		<select id="op-{row.key}" name="op.{i}" value={row.op} onchange={(e) => changeOp(slot, row, e.currentTarget.value)}>
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
				aria-describedby="num-hint-{row.key}{rowError(row, 'num') ? ` num-error-${row.key}` : ''}"
				aria-invalid={rowError(row, 'num') ? 'true' : undefined}
			/>
			{#if rowError(row, 'num')}<p class="error" id="num-error-{row.key}">{rowError(row, 'num')}</p>{/if}
		{:else}
			<label for="target-{row.key}">{ja.bill.write.target}</label>
			<select
				id="target-{row.key}"
				name="target.{i}"
				value={row.target}
				onchange={(e) => pick(slot, row, e.currentTarget.value)}
				required
				aria-invalid={rowError(row, 'target') ? 'true' : undefined}
				aria-describedby={rowError(row, 'target') ? `target-error-${row.key}` : undefined}
			>
				<option value="">{ja.bill.write.targetPlaceholder}</option>
				{#each slot.articles ?? [] as a (a.num)}<option value={a.num}>{optionLabel(a)}</option>{/each}
				{#if !slot.articles && row.target}<option value={row.target}>{row.target}</option>{/if}
			</select>
			{#if rowError(row, 'target')}<p class="error" id="target-error-{row.key}">{rowError(row, 'target')}</p>{/if}
		{/if}

		{#if row.op !== 'delete'}
			<label for="caption-{row.key}">{ja.bill.write.caption}</label>
			<input
				id="caption-{row.key}"
				name="caption.{i}"
				bind:value={row.caption}
				maxlength={BILL_MAX.caption}
				aria-invalid={rowError(row, 'caption') ? 'true' : undefined}
				aria-describedby={rowError(row, 'caption') ? `caption-error-${row.key}` : undefined}
			/>
			{#if rowError(row, 'caption')}<p class="error" id="caption-error-{row.key}">{rowError(row, 'caption')}</p>{/if}

			<label for="body-{row.key}">{ja.bill.write.body}</label>
			<p class="hint" id="body-hint-{row.key}">{ja.bill.write.bodyHint}</p>
			<textarea
				id="body-{row.key}"
				name="body.{i}"
				bind:value={row.body}
				required
				rows="8"
				maxlength={BILL_MAX.body}
				aria-describedby="body-hint-{row.key}{rowError(row, 'body') ? ` body-error-${row.key}` : ''}"
				aria-invalid={rowError(row, 'body') ? 'true' : undefined}
			></textarea>
			{#if rowError(row, 'body')}<p class="error" id="body-error-{row.key}">{rowError(row, 'body')}</p>{/if}
		{/if}
		<button type="button" class="link" onclick={() => (slot.rows = slot.rows.filter((r) => r !== row))}>{ja.bill.write.removeRow}</button>
	</fieldset>
{/snippet}

{#snippet slotStatus(slot: Slot)}
	{#if slot.loading}<p class="hint" role="status">{ja.bill.write.loading}</p>{/if}
	{#if slot.loadFailed}<p class="error">{ja.bill.write.loadFailed}</p>{/if}
{/snippet}

<form
	method="post"
	bind:this={formEl}
	use:enhance={() => {
		sentKeys = order.map((o) => o.row.key);
		sentSlots = slots.map((s) => s.key);
		return async ({ result, update }) => {
			await update({ reset: false });
			// 失敗でも 500 などでも、トークンはサーバーで使い終わっている
			if (result.type !== 'redirect') turnstile?.reset();
			if (result.type === 'failure') {
				// 長いフォームなので、最初の誤りの欄へ移す
				await tick();
				formEl.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
			}
		};
	}}
>
	{#if edit}<input type="hidden" name="rev" value={edit.rev} />{/if}
	{#if kind !== 'enact'}<input type="hidden" name="base" value={slots[0].base} />{/if}

	{#if edit}
		<input type="hidden" name="kind" value={kind} />
		<p class="fixed">{ja.bill.write.kind}：{ja.bill.kinds[kind as 'amend' | 'repeal' | 'enact']}　<span>{ja.bill.write.kindFixed}</span></p>
	{:else}
		<fieldset class="kinds">
			<legend>{ja.bill.write.kind}</legend>
			{#each ['amend', 'repeal', 'enact'] as const as k (k)}
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
		readonly={adjusting}
		required
		maxlength={BILL_MAX.title}
		aria-describedby={fieldError('title') ? 'bill-title-hint bill-title-error' : 'bill-title-hint'}
		aria-invalid={fieldError('title') ? 'true' : undefined}
	/>
	{#if fieldError('title')}<p class="error" id="bill-title-error">{fieldError('title')}</p>{/if}

	{#if kind === 'enact'}
		<label for="bill-new-title">{ja.bill.write.newTitle}</label>
		<p class="hint" id="bill-new-title-hint">{ja.bill.write.newTitleHint}</p>
		<input
			id="bill-new-title"
			name="newTitle"
			bind:value={newTitle}
			readonly={adjusting && !titleFree}
			required
			maxlength={BILL_MAX.lawTitle}
			aria-describedby={fieldError('newTitle') ? 'bill-new-title-hint bill-new-title-error' : 'bill-new-title-hint'}
			aria-invalid={fieldError('newTitle') ? 'true' : undefined}
		/>
		{#if fieldError('newTitle')}<p class="error" id="bill-new-title-error">{fieldError('newTitle')}</p>{/if}

		<div class="changes">
			<h2>{ja.bill.write.enactHeading}</h2>
			<p class="hint">{ja.bill.write.enactHint}</p>
			{#each enactRows as row, i (row.key)}
				{@const at = indexOf.get(row.key) ?? i}
				<fieldset class="row">
					<legend>{ja.bill.write.article(i + 1)}</legend>
					<input type="hidden" name="op.{at}" value="add" />
					<input type="hidden" name="num.{at}" value={i + 1} />
					<label for="caption-{row.key}">{ja.bill.write.caption}</label>
					<input
						id="caption-{row.key}"
						name="caption.{at}"
						bind:value={row.caption}
						maxlength={BILL_MAX.caption}
						aria-invalid={rowError(row, 'caption') ? 'true' : undefined}
						aria-describedby={rowError(row, 'caption') ? `caption-error-${row.key}` : undefined}
					/>
					{#if rowError(row, 'caption')}<p class="error" id="caption-error-{row.key}">{rowError(row, 'caption')}</p>{/if}

					<label for="body-{row.key}">{ja.bill.write.articleBody}</label>
					<p class="hint" id="body-hint-{row.key}">{ja.bill.write.bodyHint}</p>
					<textarea
						id="body-{row.key}"
						name="body.{at}"
						bind:value={row.body}
						required
						rows="6"
						maxlength={BILL_MAX.body}
						aria-describedby="body-hint-{row.key}{rowError(row, 'body') ? ` body-error-${row.key}` : ''}"
						aria-invalid={rowError(row, 'body') ? 'true' : undefined}
					></textarea>
					{#if rowError(row, 'body')}<p class="error" id="body-error-{row.key}">{rowError(row, 'body')}</p>{/if}
					{#if i > 0}
						<button type="button" class="link" onclick={() => (enactRows = enactRows.filter((r) => r !== row))}>{ja.bill.write.removeArticle}</button>
					{/if}
				</fieldset>
			{/each}
			{#if errors?.changes}<p class="error">{errors.changes}</p>{/if}
			{#if order.length < BILL_MAX.changes}
				<button type="button" onclick={() => enactRows.push(toRow({ op: 'add', target: '', num: '', caption: '', body: '' }))}>{ja.bill.write.addArticle}</button>
			{/if}
		</div>
	{:else}
		<label for="bill-law">{ja.bill.write.law}</label>
		<select
			id="bill-law"
			name="law"
			value={slots[0].law}
			onchange={(e) => changeLaw(slots[0], e.currentTarget.value)}
			disabled={adjusting}
			required
			aria-invalid={fieldError('laws') ? 'true' : undefined}
			aria-describedby={fieldError('laws') ? 'bill-law-error' : undefined}
		>
			<option value="">{ja.bill.write.lawPlaceholder}</option>
			{#each optionsFor(slots[0]) as l (l.id)}<option value={l.id}>{l.title}</option>{/each}
		</select>
		{#if adjusting}<input type="hidden" name="law" value={slots[0].law} />{/if}
		{#if fieldError('laws')}<p class="error" id="bill-law-error">{fieldError('laws')}</p>{/if}
		<p class="hint">{ja.ifLaw.formNote}</p>
	{/if}

	{#if kind === 'repeal'}
		<p class="note">{ja.bill.write.repealNote}</p>
		{#if errors?.changes}<p class="error">{errors.changes}</p>{/if}
	{:else if kind === 'amend'}
		<div class="changes">
			<h2>{ja.bill.write.changes}</h2>
			<p class="hint">{ja.bill.write.changesHint}</p>
			{#if !slots[0].law}<p class="hint">{ja.bill.write.chooseLawFirst}</p>{/if}
			{@render slotStatus(slots[0])}
			{#each slots[0].rows as row (row.key)}{@render changeRow(slots[0], row, 0)}{/each}
			{#if errors?.changes}<p class="error">{errors.changes}</p>{/if}
			{#if order.length < BILL_MAX.changes}
				<button type="button" onclick={() => slots[0].rows.push(toRow(emptyRow()))}>{ja.bill.write.addRow}</button>
			{/if}
		</div>
	{/if}

	<!-- 2本目からの法令（docs/spec/53.md 決めたこと6） -->
	{#each slots.slice(1) as slot, j (slot.key)}
		{@const n = j + 1}
		{@const error = slotError(slot)}
		<fieldset class="law-slot">
			<legend>{kind === 'amend' ? ja.bill.write.otherLaw(n) : ja.bill.write.relatedLaw(n)}</legend>
			<p class="hint">{ja.bill.write.lawHint[kind as 'amend' | 'repeal' | 'enact']}</p>
			<label for="law-{slot.key}">{ja.bill.write.lawOnly}</label>
			<select
				id="law-{slot.key}"
				name="law.{n}"
				value={slot.law}
				onchange={(e) => changeLaw(slot, e.currentTarget.value)}
				disabled={adjusting}
				aria-invalid={error?.law ? 'true' : undefined}
				aria-describedby={error?.law ? `law-error-${slot.key}` : undefined}
			>
				<option value="">{ja.bill.write.lawPlaceholder}</option>
				{#each optionsFor(slot) as l (l.id)}<option value={l.id}>{l.title}</option>{/each}
			</select>
			{#if adjusting}<input type="hidden" name="law.{n}" value={slot.law} />{/if}
			{#if error?.law}<p class="error" id="law-error-{slot.key}">{error.law}</p>{/if}
			<input type="hidden" name="base.{n}" value={slot.base} />
			{#if kind === 'repeal'}
				<fieldset class="kinds">
					<legend>{ja.bill.write.action}</legend>
					{#each ['repeal', 'amend'] as const as a (a)}
						<label class="radio"><input type="radio" name="action.{n}" value={a} bind:group={slot.action} disabled={adjusting} />{ja.bill.write.actions[a]}</label>
					{/each}
				</fieldset>
				{#if adjusting}<input type="hidden" name="action.{n}" value={slot.action} />{/if}
			{:else}
				<input type="hidden" name="action.{n}" value="amend" />
			{/if}
			{@render slotStatus(slot)}
			<!-- 法令を選ぶまで変える条の欄は出さない（選んでいない枠を送ると、その枠のそばに誤りを出す） -->
			{#if actionOf(slot, n) === 'amend' && !slot.law}
				<p class="hint">{ja.bill.write.chooseLawFirst}</p>
			{:else if actionOf(slot, n) === 'amend'}
				{#each slot.rows as row (row.key)}{@render changeRow(slot, row, n)}{/each}
				{#if order.length < BILL_MAX.changes}
					<button type="button" onclick={() => slot.rows.push(toRow(emptyRow()))}>{ja.bill.write.addRow}</button>
				{/if}
			{/if}
			{#if error?.changes}<p class="error">{error.changes}</p>{/if}
			{#if !adjusting}
				<button type="button" class="link" onclick={() => (slots = slots.filter((s) => s !== slot))}>{ja.bill.write.removeLaw}</button>
			{/if}
		</fieldset>
	{/each}
	{#if canAddLaw}
		<button type="button" onclick={addLaw}>{ja.bill.write.addLaw}</button>
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
		{#if !allCandidates.length}
			<p class="error">{ja.bill.write.noCandidates}</p>
		{:else if dropped}
			<p class="hint">{ja.bill.write.solutionsDropped(dropped)}</p>
		{/if}
		{#each groups as g (g.issueId)}
			{#if groups.length > 1}<h3>{g.issueTitle}</h3>{/if}
			{#each g.items as c (c.id)}
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
		{/each}

		<!-- ほかの課題の解決策を探す。送るフォームの値ではない（name を付けない） -->
		<div class="finder">
			<label for="solution-search">{ja.bill.write.searchLabel}</label>
			<div class="finder-row">
				<input
					id="solution-search"
					type="search"
					bind:value={query}
					maxlength="60"
					onkeydown={(e) => {
						// フォームを送らずに探す
						if (e.key === 'Enter') {
							e.preventDefault();
							void search();
						}
					}}
				/>
				<button type="button" onclick={search}>{ja.bill.write.searchButton}</button>
			</div>
			<div role="status">
				{#if searchError}<p class="error">{searchError}</p>{/if}
				{#if results && !results.rows.length}<p class="hint">{ja.bill.write.noResults}</p>{/if}
			</div>
			{#if results && results.rows.length}
				<ul class="found" aria-label={ja.bill.write.searchResults}>
					{#each results.rows as r (r.id)}
						<li>
							<p class="found-body">{r.body}</p>
							<p class="hint">{ja.bill.write.issueOf(r.issueTitle)}</p>
							{#if chosen.includes(String(r.id))}
								<p class="hint">{ja.bill.write.chosen}</p>
							{:else}
								<button type="button" onclick={() => choose(r)} disabled={chosen.length >= BILL_MAX.solutions}>{ja.bill.write.choose}</button>
							{/if}
						</li>
					{/each}
				</ul>
				{#if results.more}<p class="hint">{ja.bill.write.moreResults}</p>{/if}
			{/if}
		</div>
	</fieldset>
	{#if fieldError('solutions')}<p class="error" id="bill-solutions-error">{fieldError('solutions')}</p>{/if}

	{#if shownConflicts.length}
		<section class="conflicts">
			<h2>{ja.ifLaw.conflictsHeading}</h2>
			<p class="hint">{ja.ifLaw.conflictsHint}</p>
			{#each shownConflicts as c (c.key)}
				<h3>{c.lawTitle ? `${c.lawTitle} ` : ''}{c.label}{c.caption}</h3>
				<p class="law-text">{c.body || ja.torikomi.goneBody}</p>
			{/each}
			<label class="radio"><input type="checkbox" name="confirmConflicts" />{ja.ifLaw.confirmLabel}</label>
		</section>
	{/if}

	<Turnstile {siteKey} bind:token bind:this={turnstile} />
	{#if alertText}<p role="alert" class="error">{alertText}</p>{/if}
	<div class="buttons">
		<!-- 条文を読み込むまでは、基にした版が決まらないので送らない -->
		<button class="primary" disabled={!token || usedSlots.some((x) => x.law !== '' && x.base === '') || !allCandidates.length}>{adjusting ? ja.ifLaw.fixSubmit : ja.bill.write.submit}</button>
		<a href={back}>{ja.bill.write.cancel}</a>
	</div>
</form>

<style>
	/* 2本目からの法令の枠 */
	.law-slot {
		grid-template-columns: minmax(0, 1fr);
		margin-top: 0.75rem;
		padding: 0 1rem 1rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-l);
	}

	.law-slot > legend {
		padding: 0 0.25rem;
	}

	.solutions h3 {
		margin: 0.75rem 0 0;
		font-size: var(--font-size-sub);
		color: var(--color-text-sub);
	}

	.finder {
		display: grid;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}

	.finder-row {
		display: flex;
		gap: 0.5rem;
	}

	.finder-row button {
		flex: none;
	}

	.found {
		display: grid;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.found li {
		display: grid;
		gap: 0.25rem;
		padding: 0.75rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-m);
	}

	.found-body {
		margin: 0;
		overflow-wrap: anywhere;
	}

	.conflicts {
		padding: 1rem;
		border: 1px solid var(--color-caution);
		border-radius: var(--radius-m);
		background: var(--color-caution-bg);
	}

	.conflicts h3 {
		margin: 0.75rem 0 0;
		font-size: var(--font-size-body);
	}

	.law-text {
		margin: 0.25rem 0;
		white-space: pre-line;
		overflow-wrap: anywhere;
	}

	form {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
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
		/* 見出しの長い条の選択肢でも、幅からはみ出さない */
		width: 100%;
		min-width: 0;
		box-sizing: border-box;
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
		min-width: 0;
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
		grid-template-columns: minmax(0, 1fr);
		gap: 0.75rem;
	}

	/* SpBillChanges の条のカード */
	.row {
		grid-template-columns: minmax(0, 1fr);
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
