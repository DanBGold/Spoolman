<script lang="ts">
	// The settings side of the report designer: columns, filters, grouping and
	// sorting, header/footer and page setup. It edits the bound design in place;
	// the page renders the live preview from the same object.
	import FieldSelect from './FieldSelect.svelte';
	import { FILTER_OPS, VALUELESS_OPS } from '$lib/reports/engine';
	import { findField, type ReportField } from '$lib/reports/fields';
	import {
		MAX_GROUP_LEVELS,
		newColumn,
		uid,
		type Aggregate,
		type Align,
		type FilterOp,
		type PaperName,
		type ReportDesign
	} from '$lib/reports/types';
	import * as m from '$lib/paraglide/messages';
	import Plus from '@lucide/svelte/icons/plus';
	import X from '@lucide/svelte/icons/x';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import ArrowDown from '@lucide/svelte/icons/arrow-down';

	interface Props {
		design: ReportDesign;
		fields: ReportField[];
	}

	let { design = $bindable(), fields }: Props = $props();

	const ALIGN_LABEL: Record<Align, () => string> = {
		left: m['reports.align.left'],
		center: m['reports.align.center'],
		right: m['reports.align.right']
	};
	const AGG_LABEL: Record<Aggregate, () => string> = {
		none: m['reports.agg.none'],
		sum: m['reports.agg.sum'],
		avg: m['reports.agg.avg'],
		min: m['reports.agg.min'],
		max: m['reports.agg.max'],
		count: m['reports.agg.count']
	};
	const OP_LABEL: Record<FilterOp, () => string> = {
		eq: m['reports.op.eq'],
		neq: m['reports.op.neq'],
		contains: m['reports.op.contains'],
		notContains: m['reports.op.notContains'],
		startsWith: m['reports.op.startsWith'],
		gt: m['reports.op.gt'],
		gte: m['reports.op.gte'],
		lt: m['reports.op.lt'],
		lte: m['reports.op.lte'],
		empty: m['reports.op.empty'],
		notEmpty: m['reports.op.notEmpty']
	};
	const PAPERS: [PaperName, () => string][] = [
		['letter', m['reports.paper.letter']],
		['legal', m['reports.paper.legal']],
		['tabloid', m['reports.paper.tabloid']],
		['a4', m['reports.paper.a4']],
		['a3', m['reports.paper.a3']]
	];

	const kindOf = (key: string) => findField(fields, key)?.kind ?? 'text';
	/** Swatches are pictures, so they can't be grouped, sorted or filtered on. */
	const notSwatch = (f: ReportField) => f.kind === 'swatch';
	const aggsFor = (key: string): Aggregate[] =>
		kindOf(key) === 'number' ? ['none', 'sum', 'avg', 'min', 'max', 'count'] : ['none', 'count'];
	const opsFor = (key: string): FilterOp[] => {
		const k = kindOf(key);
		if (k === 'number' || k === 'date')
			return FILTER_OPS.filter((o) => !['contains', 'notContains', 'startsWith'].includes(o));
		if (k === 'bool') return ['eq', 'neq', 'empty', 'notEmpty'];
		return FILTER_OPS.filter((o) => !['gt', 'gte', 'lt', 'lte'].includes(o));
	};
	const fieldLabel = (key: string) => findField(fields, key)?.label() ?? key;
	const firstUsable = () => fields.find((f) => f.kind !== 'swatch')?.key ?? '';

	function move<T>(list: T[], i: number, d: number) {
		const j = i + d;
		if (j < 0 || j >= list.length) return;
		[list[i], list[j]] = [list[j], list[i]];
	}

	// Columns
	function addColumn() {
		const used = new Set(design.columns.map((c) => c.field));
		const next = fields.find((f) => !used.has(f.key)) ?? fields[0];
		if (next) design.columns.push(newColumn(next.key, next.kind === 'number' ? { align: 'right' } : {}));
	}
	function setColumnField(i: number, key: string) {
		const c = design.columns[i];
		c.field = key;
		c.align = kindOf(key) === 'number' ? 'right' : kindOf(key) === 'swatch' ? 'center' : 'left';
		if (!aggsFor(key).includes(c.aggregate)) c.aggregate = 'none';
	}

	// Filters
	function addFilter() {
		design.filters.push({ id: uid('f'), field: firstUsable(), op: 'eq', value: '' });
	}
	function setFilterField(i: number, key: string) {
		const f = design.filters[i];
		f.field = key;
		if (!opsFor(key).includes(f.op)) f.op = opsFor(key)[0];
	}

	// Grouping: a fixed set of up to three selects; clearing one drops the levels after it.
	function setGroup(level: number, key: string) {
		const g = design.groupBy.slice(0, level);
		if (key) g.push(key, ...design.groupBy.slice(level + 1).filter((k) => k !== key));
		design.groupBy = g.filter((k, i) => g.indexOf(k) === i);
	}
	const groupSlots = $derived(Math.min(design.groupBy.length + 1, MAX_GROUP_LEVELS));

	function addSort() {
		const used = new Set(design.sort.map((s) => s.field));
		const next = fields.find((f) => f.kind !== 'swatch' && !used.has(f.key));
		if (next) design.sort.push({ field: next.key, dir: 'asc' });
	}
	const boolPlaceholder = `${m['reports.yes']()} / ${m['reports.no']()}`;
</script>

<div class="designer">
	<details open>
		<summary>{m['reports.section.columns']()} <span class="count">{design.columns.length}</span></summary>
		<div class="body">
			{#if design.columns.length === 0}
				<p class="empty">{m['reports.noColumns']()}</p>
			{:else}
				<div class="col-head">
					<span>{m['reports.columnField']()}</span>
					<span>{m['reports.columnHeader']()}</span>
					<span>{m['reports.align']()}</span>
					<span>{m['reports.summary']()}</span>
					<span>{m['reports.width']()}</span>
					<span></span>
				</div>
			{/if}
			{#each design.columns as col, i (col.id)}
				<div class="col-row">
					<FieldSelect
						{fields}
						value={col.field}
						ariaLabel={m['reports.columnField']()}
						onchange={(k) => setColumnField(i, k)}
					/>
					<input
						type="text"
						aria-label={m['reports.columnHeader']()}
						bind:value={col.label}
						placeholder={fieldLabel(col.field)}
					/>
					<select aria-label={m['reports.align']()} bind:value={col.align}>
						{#each Object.keys(ALIGN_LABEL) as a (a)}
							<option value={a}>{ALIGN_LABEL[a as Align]()}</option>
						{/each}
					</select>
					<select aria-label={m['reports.summary']()} bind:value={col.aggregate}>
						{#each aggsFor(col.field) as a (a)}
							<option value={a}>{AGG_LABEL[a]()}</option>
						{/each}
					</select>
					<input
						type="number"
						aria-label={m['reports.width']()}
						min="0.5"
						max="6"
						step="0.5"
						bind:value={col.width}
					/>
					<div class="icons">
						<button
							title={m['reports.moveUp']()}
							aria-label={m['reports.moveUp']()}
							disabled={i === 0}
							onclick={() => move(design.columns, i, -1)}><ArrowUp size={14} /></button
						>
						<button
							title={m['reports.moveDown']()}
							aria-label={m['reports.moveDown']()}
							disabled={i === design.columns.length - 1}
							onclick={() => move(design.columns, i, 1)}><ArrowDown size={14} /></button
						>
						<button
							title={m['reports.remove']()}
							aria-label={m['reports.remove']()}
							onclick={() => design.columns.splice(i, 1)}><X size={14} /></button
						>
					</div>
				</div>
			{/each}
			<button class="add" onclick={addColumn}><Plus size={14} /> {m['reports.addColumn']()}</button>
		</div>
	</details>

	<details open={design.filters.length > 0}>
		<summary>{m['reports.section.filters']()} <span class="count">{design.filters.length}</span></summary>
		<div class="body">
			{#if design.entity === 'spool'}
				<label class="check"
					><input type="checkbox" bind:checked={design.includeArchived} />
					{m['reports.includeArchived']()}</label
				>
			{/if}
			{#if design.filters.length === 0}
				<p class="empty">{m['reports.noFilters']()}</p>
			{/if}
			{#each design.filters as f, i (f.id)}
				<div class="filter-row">
					<FieldSelect
						{fields}
						value={f.field}
						exclude={notSwatch}
						ariaLabel={m['reports.columnField']()}
						onchange={(k) => setFilterField(i, k)}
					/>
					<select aria-label={m['reports.condition']()} bind:value={f.op}>
						{#each opsFor(f.field) as o (o)}
							<option value={o}>{OP_LABEL[o]()}</option>
						{/each}
					</select>
					{#if VALUELESS_OPS.has(f.op)}
						<span></span>
					{:else}
						<input
							type={kindOf(f.field) === 'date' ? 'date' : 'text'}
							aria-label={m['reports.filterValue']()}
							placeholder={kindOf(f.field) === 'bool' ? boolPlaceholder : m['reports.filterValue']()}
							bind:value={f.value}
						/>
					{/if}
					<div class="icons">
						<button
							title={m['reports.remove']()}
							aria-label={m['reports.remove']()}
							onclick={() => design.filters.splice(i, 1)}><X size={14} /></button
						>
					</div>
				</div>
			{/each}
			<button class="add" onclick={addFilter}><Plus size={14} /> {m['reports.addFilter']()}</button>
		</div>
	</details>

	<details open>
		<summary>{m['reports.section.groupSort']()}</summary>
		<div class="body">
			<div class="grid2">
				{#each Array.from({ length: groupSlots }, (_, i) => i) as level (level)}
					<label>
						{level === 0 ? m['reports.groupBy']() : m['reports.thenBy']()}
						<FieldSelect
							{fields}
							value={design.groupBy[level] ?? ''}
							exclude={notSwatch}
							emptyLabel={m['reports.noGrouping']()}
							ariaLabel={m['reports.groupBy']()}
							onchange={(k) => setGroup(level, k)}
						/>
					</label>
				{/each}
			</div>
			{#if design.groupBy.length > 0}
				<label class="check"
					><input type="checkbox" bind:checked={design.showSubtotals} /> {m['reports.showSubtotals']()}</label
				>
				<label class="check"
					><input type="checkbox" bind:checked={design.pageBreakPerGroup} />
					{m['reports.pageBreakPerGroup']()}</label
				>
			{/if}
			<label class="check"
				><input type="checkbox" bind:checked={design.showGrandTotal} /> {m['reports.showGrandTotal']()}</label
			>
			<p class="hint">{m['reports.summaryHint']()}</p>

			<div class="sub-label">{m['reports.sortBy']()}</div>
			{#each design.sort as s, i (i)}
				<div class="sort-row">
					<FieldSelect
						{fields}
						value={s.field}
						exclude={notSwatch}
						ariaLabel={m['reports.sortBy']()}
						onchange={(k) => (s.field = k)}
					/>
					<select aria-label={m['reports.sortBy']()} bind:value={s.dir}>
						<option value="asc">{m['reports.asc']()}</option>
						<option value="desc">{m['reports.desc']()}</option>
					</select>
					<div class="icons">
						<button
							title={m['reports.remove']()}
							aria-label={m['reports.remove']()}
							onclick={() => design.sort.splice(i, 1)}><X size={14} /></button
						>
					</div>
				</div>
			{/each}
			<button class="add" onclick={addSort}><Plus size={14} /> {m['reports.addSort']()}</button>
		</div>
	</details>

	<details>
		<summary>{m['reports.section.headerFooter']()}</summary>
		<div class="body">
			<label
				>{m['reports.title']()}
				<input
					type="text"
					bind:value={design.header.title}
					placeholder={m['reports.titlePlaceholder']()}
				/></label
			>
			<label>{m['reports.subtitle']()} <input type="text" bind:value={design.header.subtitle} /></label>
			<div class="checks">
				<label class="check"
					><input type="checkbox" bind:checked={design.header.showDate} /> {m['reports.showDate']()}</label
				>
				<label class="check"
					><input type="checkbox" bind:checked={design.header.showCount} /> {m['reports.showCount']()}</label
				>
			</div>
			<label>{m['reports.footerText']()} <input type="text" bind:value={design.footer.text} /></label>
			<label class="check"
				><input type="checkbox" bind:checked={design.footer.showPageNumbers} />
				{m['reports.showPageNumbers']()}</label
			>
		</div>
	</details>

	<details>
		<summary>{m['reports.section.page']()}</summary>
		<div class="body">
			<div class="grid3">
				<label
					>{m['reports.paper']()}
					<select bind:value={design.page.paper}>
						{#each PAPERS as [p, label] (p)}
							<option value={p}>{label()}</option>
						{/each}
					</select></label
				>
				<label
					>{m['reports.fontSize']()}
					<input type="number" min="5" max="24" step="0.5" bind:value={design.page.fontSize} /></label
				>
				<label
					>{m['reports.margin']()}
					<input type="number" min="0" max="50" step="1" bind:value={design.page.margin} /></label
				>
			</div>
			<div class="checks">
				<label class="check"
					><input type="checkbox" bind:checked={design.page.landscape} /> {m['reports.landscape']()}</label
				>
				<label class="check"
					><input type="checkbox" bind:checked={design.page.stripes} /> {m['reports.stripes']()}</label
				>
			</div>
		</div>
	</details>
</div>

<style>
	.designer {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	details {
		border: 1px solid var(--border);
		border-radius: 9px;
		background: var(--surface, transparent);
	}
	summary {
		cursor: pointer;
		padding: 10px 14px;
		font-size: 13px;
		font-weight: 600;
		user-select: none;
	}
	.count {
		font-weight: 400;
		color: var(--text-dim);
		margin-left: 4px;
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 2px 14px 14px;
	}
	.col-head,
	.col-row {
		display: grid;
		grid-template-columns: minmax(0, 1.5fr) minmax(0, 1.3fr) 74px 82px 54px 78px;
		gap: 6px;
		align-items: center;
	}
	.col-head span {
		font-size: 11px;
		color: var(--text-dim);
	}
	.filter-row {
		display: grid;
		grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1.2fr) 28px;
		gap: 6px;
		align-items: center;
	}
	.sort-row {
		display: grid;
		grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr) 28px;
		gap: 6px;
		align-items: center;
	}
	.grid2 {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		gap: 8px;
	}
	.grid3 {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 8px;
	}
	.checks {
		display: flex;
		gap: 18px;
		flex-wrap: wrap;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 11.5px;
		color: var(--text-dim);
	}
	label.check {
		flex-direction: row;
		align-items: center;
		gap: 7px;
		font-size: 12.5px;
		color: var(--text-2, var(--text));
	}
	.sub-label {
		font-size: 11.5px;
		color: var(--text-dim);
		margin-top: 6px;
	}
	.hint,
	.empty {
		font-size: 11.5px;
		color: var(--text-dim);
		margin: 0;
		line-height: 1.5;
	}
	.designer :global(select),
	input[type='text'],
	input[type='number'],
	input[type='date'] {
		width: 100%;
		min-width: 0;
		border: 1px solid var(--border-strong);
		background: none;
		border-radius: 6px;
		padding: 6px 8px;
		color: var(--text);
		font-size: 12.5px;
		font-family: inherit;
	}
	.designer :global(select) {
		background: var(--bg, transparent);
	}
	.designer :global(select:focus),
	input:focus {
		outline: none;
		border-color: var(--accent);
	}
	.icons {
		display: flex;
		gap: 2px;
		justify-content: flex-end;
	}
	.icons button {
		background: none;
		border: 1px solid transparent;
		border-radius: 5px;
		color: var(--text-dim);
		padding: 4px;
		cursor: pointer;
		display: inline-flex;
	}
	.icons button:hover:not(:disabled) {
		color: var(--text);
		border-color: var(--border-strong);
	}
	.icons button:disabled {
		opacity: 0.3;
		cursor: default;
	}
	.add {
		align-self: flex-start;
		display: inline-flex;
		align-items: center;
		gap: 5px;
		background: none;
		border: 1px dashed var(--border-strong);
		border-radius: 6px;
		color: var(--accent-soft);
		padding: 5px 10px;
		font-size: 12.5px;
		cursor: pointer;
	}
	.add:hover {
		border-color: var(--accent);
	}
</style>
