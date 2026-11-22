<script lang="ts">
	import Button from '$components/Button.svelte';
	import ReportDesigner from '$components/reports/ReportDesigner.svelte';
	import { reportDesigns } from '$lib/stores/reportDesigns.svelte';
	import { loadReportData, type LoadedReportData } from '$lib/reports/data';
	import { buildReport, itemCount } from '$lib/reports/engine';
	import { reportFields } from '$lib/reports/fields';
	import { buildCsv, buildXlsx, dataRows, download, fileBaseName } from '$lib/reports/export';
	import { PAPER_MM, printHtml, renderReportHtml } from '$lib/reports/html';
	import { setReportEntity, type ReportDesign, type ReportEntity } from '$lib/reports/types';
	import { toasts } from '$lib/stores/toasts.svelte';
	import * as m from '$lib/paraglide/messages';
	import Plus from '@lucide/svelte/icons/plus';
	import Printer from '@lucide/svelte/icons/printer';
	import FileSpreadsheet from '@lucide/svelte/icons/file-spreadsheet';
	import FileText from '@lucide/svelte/icons/file-text';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';

	let selectedId = $state<string | null>(null);
	let working = $state<ReportDesign | null>(null);
	let saving = $state(false);
	let savedSnapshot = $state('');

	// Inventory: fetched once when the page opens, refreshed on demand.
	let loaded = $state<LoadedReportData | null>(null);
	let loadError = $state(false);
	let loading = $state(false);

	async function reload() {
		loading = true;
		loadError = false;
		try {
			loaded = await loadReportData();
		} catch (e) {
			console.error('Failed to load report data', e);
			loadError = true;
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		void reload();
		void reportDesigns.load().then(() => {
			if (selectedId === null && reportDesigns.designs.length > 0) selectDesign(reportDesigns.designs[0].id);
		});
	});

	function clone(d: ReportDesign): ReportDesign {
		return structuredClone($state.snapshot(d)) as ReportDesign;
	}
	function selectDesign(id: string) {
		const d = reportDesigns.designs.find((x) => x.id === id);
		if (!d) return;
		selectedId = id;
		working = clone(d);
		savedSnapshot = JSON.stringify(working);
	}
	const dirty = $derived(working !== null && JSON.stringify(working) !== savedSnapshot);

	async function newDesign() {
		const d = await reportDesigns.create(working?.entity ?? 'spool');
		selectDesign(d.id);
	}
	async function duplicate() {
		if (!selectedId) return;
		const d = await reportDesigns.duplicate(selectedId);
		if (d) selectDesign(d.id);
	}
	async function remove() {
		if (!selectedId) return;
		if (!confirm(m['reports.deleteConfirm']())) return;
		await reportDesigns.remove(selectedId);
		selectedId = null;
		working = null;
		if (reportDesigns.designs.length > 0) selectDesign(reportDesigns.designs[0].id);
	}
	async function save() {
		if (!working) return;
		saving = true;
		try {
			await reportDesigns.save(clone(working));
			savedSnapshot = JSON.stringify(working);
		} catch (e) {
			console.error('Failed to save report design', e);
			toasts.error(String(e));
		} finally {
			saving = false;
		}
	}
	function setEntity(e: ReportEntity) {
		if (working && working.entity !== e) setReportEntity(working, e);
	}

	const fields = $derived(
		working && loaded
			? reportFields(working.entity, loaded.extra)
			: working
				? reportFields(working.entity, { spool: [], filament: [], vendor: [] })
				: []
	);
	const result = $derived(working && loaded ? buildReport(working, loaded.data, fields) : null);

	// The preview iframe is rewritten on a short delay so typing in a header
	// field doesn't re-layout a several-hundred-row table on every keystroke.
	let previewHtml = $state('');
	$effect(() => {
		if (!working || !result || !loaded) return;
		const html = renderReportHtml(working, result, { generatedAt: loaded.loadedAt, preview: true });
		const t = setTimeout(() => (previewHtml = html), 180);
		return () => clearTimeout(t);
	});

	// Scale the page-sized preview down to fit the pane.
	let paneWidth = $state(600);
	let paneHeight = $state(700);
	const pagePx = $derived.by(() => {
		if (!working) return 816;
		const [w, h] = PAPER_MM[working.page.paper] ?? PAPER_MM.letter;
		return ((working.page.landscape ? h : w) * 96) / 25.4 + 40;
	});
	const scale = $derived(Math.min(1, paneWidth / pagePx));

	function print() {
		if (!working || !result) return;
		void printHtml(renderReportHtml(working, result, { generatedAt: new Date() }));
	}
	function exportXlsx() {
		if (!working || !result) return;
		download(
			buildXlsx(working, result, new Date()),
			`${fileBaseName(working)}.xlsx`,
			'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
		);
	}
	function exportCsv() {
		if (!working || !result) return;
		download(
			buildCsv(working, result, fields, dataRows),
			`${fileBaseName(working)}.csv`,
			'text/csv;charset=utf-8'
		);
	}

	const ENTITIES: [ReportEntity, () => string][] = [
		['spool', m['reports.entity.spool']],
		['filament', m['reports.entity.filament']],
		['vendor', m['reports.entity.vendor']]
	];
</script>

<svelte:head>
	<title>{m['documentTitle.reports.list']()}</title>
</svelte:head>

<div class="page scroll-y">
	<div class="wrap">
		<div class="title">{m['reports.designerTitle']()}</div>
		<div class="subtitle">{m['reports.designerDesc']()}</div>

		<div class="toolbar">
			<select
				aria-label={m['reports.selectDesign']()}
				value={selectedId ?? ''}
				onchange={(e) => selectDesign(e.currentTarget.value)}
				disabled={reportDesigns.designs.length === 0}
			>
				{#if reportDesigns.designs.length === 0}
					<option value="">{m['reports.noDesignsOption']()}</option>
				{/if}
				{#each reportDesigns.designs as d (d.id)}
					<option value={d.id}>{d.name}</option>
				{/each}
			</select>

			{#if working}
				<input class="name" bind:value={working.name} placeholder={m['reports.designName']()} />
			{/if}

			<div class="spacer"></div>

			<Button variant="outline" onclick={newDesign}><Plus size={15} /> {m['labels.new']()}</Button>
			{#if working}
				<Button variant="outline" onclick={duplicate}>{m['labels.duplicate']()}</Button>
				<Button variant="outline" onclick={remove}>{m['buttons.delete']()}</Button>
				<Button onclick={save} disabled={saving || !dirty}
					>{saving ? m['labels.saving']() : dirty ? m['buttons.save']() : m['labels.saved']()}</Button
				>
			{/if}
		</div>

		{#if working}
			<div class="type-row">
				<span class="type-label">{m['reports.reportOf']()}</span>
				<div class="seg">
					{#each ENTITIES as [e, label] (e)}
						<button class:active={working.entity === e} onclick={() => setEntity(e)}>{label()}</button>
					{/each}
				</div>
				<span class="type-hint">{m['reports.entityHint']()}</span>
			</div>

			<div class="layout">
				<div class="left">
					<ReportDesigner bind:design={working} {fields} />
				</div>

				<div class="right">
					<div class="preview-bar">
						<span class="preview-title">{m['reports.preview']()}</span>
						{#if result}
							<span class="dim">{itemCount(result.rowCount)}</span>
						{/if}
						<button class="reload" onclick={reload} disabled={loading} title={m['reports.reload']()}
							><RefreshCw size={14} /></button
						>
						<div class="spacer"></div>
						<Button variant="outline" onclick={exportCsv} disabled={!result}
							><FileText size={15} /> {m['reports.csv']()}</Button
						>
						<Button variant="outline" onclick={exportXlsx} disabled={!result}
							><FileSpreadsheet size={15} /> {m['reports.excel']()}</Button
						>
						<Button onclick={print} disabled={!result}><Printer size={15} /> {m['reports.print']()}</Button>
					</div>
					<div class="pane" bind:clientWidth={paneWidth} bind:clientHeight={paneHeight}>
						{#if loadError}
							<div class="state">
								<p>{m['reports.loadFailed']()}</p>
								<Button variant="outline" onclick={reload}>{m['reports.reload']()}</Button>
							</div>
						{:else if !loaded}
							<div class="state"><p>{m['reports.loading']()}</p></div>
						{:else}
							<iframe
								title={m['reports.preview']()}
								srcdoc={previewHtml}
								sandbox="allow-same-origin"
								style="width:{pagePx}px; height:{paneHeight / scale}px; transform:scale({scale});"
							></iframe>
						{/if}
					</div>
				</div>
			</div>
		{:else}
			<div class="blank">
				<p>{m['reports.blank']()}</p>
				<Button onclick={newDesign}><Plus size={15} /> {m['reports.createFirst']()}</Button>
			</div>
		{/if}
	</div>
</div>

<style>
	.page {
		flex: 1;
		min-height: 0;
	}
	.wrap {
		max-width: 1560px;
		margin: 0 auto;
		padding: 28px 24px 40px;
	}
	.title {
		font-size: 20px;
		font-weight: 600;
	}
	.subtitle {
		color: var(--text-dim);
		font-size: 13px;
		margin: 6px 0 20px;
		max-width: 680px;
		line-height: 1.5;
	}
	.toolbar {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 18px;
		flex-wrap: wrap;
	}
	.toolbar select,
	.name {
		border: 1px solid var(--border-strong);
		background: none;
		border-radius: 7px;
		padding: 8px 10px;
		color: var(--text);
		font-size: 13px;
		font-family: inherit;
	}
	.name {
		flex: 1;
		min-width: 160px;
		max-width: 280px;
	}
	.toolbar select:focus,
	.name:focus {
		outline: none;
		border-color: var(--accent);
	}
	.spacer {
		flex: 1;
	}
	.type-row {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
		margin-bottom: 16px;
	}
	.type-label {
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-dim);
	}
	.seg {
		display: flex;
		border: 1px solid var(--border-strong);
		border-radius: 7px;
		overflow: hidden;
	}
	.seg button {
		background: none;
		border: none;
		color: var(--text-dim);
		padding: 6px 14px;
		font-size: 12.5px;
		cursor: pointer;
	}
	.seg button.active {
		background: var(--accent-wash);
		color: var(--accent-soft);
		font-weight: 600;
	}
	.type-hint {
		font-size: 11.5px;
		color: var(--text-dim);
		flex: 1;
		min-width: 180px;
	}
	.layout {
		display: grid;
		grid-template-columns: minmax(440px, 560px) minmax(0, 1fr);
		gap: 20px;
		align-items: start;
	}
	@media (max-width: 1000px) {
		.layout {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	.right {
		position: sticky;
		top: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.preview-bar {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}
	.preview-title {
		font-size: 13px;
		font-weight: 600;
	}
	.dim {
		font-size: 12px;
		color: var(--text-dim);
	}
	.reload {
		background: none;
		border: none;
		color: var(--text-dim);
		cursor: pointer;
		display: inline-flex;
		padding: 4px;
	}
	.reload:hover:not(:disabled) {
		color: var(--text);
	}
	.pane {
		height: calc(100vh - 230px);
		min-height: 480px;
		border: 1px solid var(--border);
		border-radius: 9px;
		overflow: hidden;
		background: #8a8f96;
		position: relative;
	}
	iframe {
		border: 0;
		transform-origin: top left;
		display: block;
		background: #8a8f96;
	}
	.state {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		padding: 80px 20px;
		color: #fff;
	}
	.blank {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 16px;
		padding: 80px 0;
		color: var(--text-dim);
	}
</style>
