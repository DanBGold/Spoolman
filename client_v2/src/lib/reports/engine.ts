import type {
	Aggregate,
	Align,
	FilterOp,
	ReportColumn,
	ReportDesign,
	ReportEntity,
	ReportFilter
} from './types';
import {
	findField,
	type CellValue,
	type FieldKind,
	type RawFilament,
	type RawSpool,
	type RawVendor,
	type ReportField,
	type ReportRow,
	type RowStats
} from './fields';
import * as m from '$lib/paraglide/messages';

// Turns a report design plus the raw inventory into a flat list of printable
// lines (group headers, data rows, subtotals, grand total). Every output format
// (preview, print, Excel, CSV) renders from this one result, so they always agree.

export interface ReportData {
	spools: RawSpool[];
	filaments: RawFilament[];
	vendors: RawVendor[];
}

export interface ResolvedColumn {
	column: ReportColumn;
	/** Missing when the column points at a field that no longer exists. */
	field?: ReportField;
	label: string;
	kind: FieldKind;
	align: Align;
	aggregate: Aggregate;
	decimals?: number;
	unit?: string;
	width: number;
}

export type LineType = 'group' | 'row' | 'subtotal' | 'total';

export interface ReportLine {
	type: LineType;
	/** Group nesting depth (0 = outermost); data rows sit at the group depth. */
	level: number;
	/** Group title for 'group' lines; label for subtotal/total lines. */
	label?: string;
	/** Rows inside the group (group/subtotal lines) or in the whole report (total). */
	count?: number;
	/** One value per column: row values, or aggregates on subtotal/total lines. */
	cells: CellValue[];
}

export interface ReportResult {
	columns: ResolvedColumn[];
	lines: ReportLine[];
	rowCount: number;
	/** Whether any column has a summary, i.e. whether subtotal/total lines carry numbers. */
	hasAggregates: boolean;
}

// ---- rows -------------------------------------------------------------------

function emptyStats(): RowStats {
	return { spoolCount: 0, remainingTotal: 0, usedTotal: 0, initialTotal: 0, filamentCount: 0 };
}

function addSpool(stats: RowStats, s: RawSpool) {
	stats.spoolCount += 1;
	stats.remainingTotal += s.remaining_weight ?? 0;
	stats.usedTotal += s.used_weight ?? 0;
	stats.initialTotal += s.initial_weight ?? 0;
}

/** Build the rows for an entity. Archived spools are left out unless asked for. */
export function buildRows(entity: ReportEntity, data: ReportData, includeArchived: boolean): ReportRow[] {
	const spools = includeArchived ? data.spools : data.spools.filter((s) => !s.archived);
	switch (entity) {
		case 'spool':
			return spools.map((s) => ({ spool: s, filament: s.filament, vendor: s.filament?.vendor ?? undefined }));
		case 'filament': {
			const byFilament = new Map<number, RowStats>();
			for (const s of spools) {
				const id = s.filament?.id;
				if (id === undefined) continue;
				const st = byFilament.get(id) ?? emptyStats();
				addSpool(st, s);
				byFilament.set(id, st);
			}
			return data.filaments.map((f) => ({
				filament: f,
				vendor: f.vendor ?? undefined,
				stats: byFilament.get(f.id) ?? emptyStats()
			}));
		}
		case 'vendor': {
			const byVendor = new Map<number, RowStats>();
			for (const f of data.filaments) {
				const vid = f.vendor?.id;
				if (vid === undefined) continue;
				const st = byVendor.get(vid) ?? emptyStats();
				st.filamentCount += 1;
				byVendor.set(vid, st);
			}
			for (const s of spools) {
				const vid = s.filament?.vendor?.id;
				if (vid === undefined) continue;
				const st = byVendor.get(vid) ?? emptyStats();
				addSpool(st, s);
				byVendor.set(vid, st);
			}
			return data.vendors.map((v) => ({ vendor: v, stats: byVendor.get(v.id) ?? emptyStats() }));
		}
	}
}

// ---- values -----------------------------------------------------------------

function isEmpty(v: CellValue): boolean {
	return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
}

function asText(v: CellValue): string {
	if (v === null || v === undefined) return '';
	if (v instanceof Date) return isoDate(v);
	if (Array.isArray(v)) return v.join(', ');
	return String(v);
}

function isoDate(d: Date): string {
	const p = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Compare two values for sorting; empty values always sort last. */
export function compareValues(a: CellValue, b: CellValue): number {
	const ea = isEmpty(a);
	const eb = isEmpty(b);
	if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
	if (typeof a === 'number' && typeof b === 'number') return a - b;
	if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
	if (typeof a === 'boolean' && typeof b === 'boolean') return a === b ? 0 : a ? -1 : 1;
	return asText(a).localeCompare(asText(b), undefined, { numeric: true, sensitivity: 'base' });
}

// ---- filters ----------------------------------------------------------------

export const FILTER_OPS: FilterOp[] = [
	'eq',
	'neq',
	'contains',
	'notContains',
	'startsWith',
	'gt',
	'gte',
	'lt',
	'lte',
	'empty',
	'notEmpty'
];

/** Operators that take no value. */
export const VALUELESS_OPS = new Set<FilterOp>(['empty', 'notEmpty']);

function toComparable(raw: string, kind: FieldKind): CellValue {
	if (kind === 'number') {
		const n = Number(raw.trim());
		return raw.trim() !== '' && Number.isFinite(n) ? n : raw;
	}
	if (kind === 'date') {
		const d = new Date(raw.trim());
		return Number.isNaN(d.getTime()) ? raw : d;
	}
	if (kind === 'bool') {
		const t = raw.trim().toLowerCase();
		if (['yes', 'true', '1'].includes(t)) return true;
		if (['no', 'false', '0'].includes(t)) return false;
	}
	return raw;
}

export function matchesFilter(value: CellValue, filter: ReportFilter, kind: FieldKind): boolean {
	const op = filter.op;
	if (op === 'empty') return isEmpty(value);
	if (op === 'notEmpty') return !isEmpty(value);
	const target = toComparable(filter.value, kind);
	const text = asText(value).toLowerCase();
	const ttext = asText(target).toLowerCase();
	// Dates compare by calendar day so "= 2026-11-09" matches any time that day.
	const sameType =
		(typeof value === 'number' && typeof target === 'number') ||
		(value instanceof Date && target instanceof Date) ||
		(typeof value === 'boolean' && typeof target === 'boolean');
	const cmp = (): number | null => {
		if (isEmpty(value)) return null;
		if (value instanceof Date && target instanceof Date) {
			return isoDate(value).localeCompare(isoDate(target));
		}
		if (sameType) return compareValues(value, target);
		return text.localeCompare(ttext, undefined, { numeric: true, sensitivity: 'base' });
	};
	switch (op) {
		case 'eq': {
			if (sameType) return cmp() === 0;
			// For lists (multi-choice), "equals" matches any one of the values.
			if (Array.isArray(value) || text.includes(', ')) {
				return text.split(', ').some((part) => part === ttext);
			}
			return text === ttext;
		}
		case 'neq':
			return !matchesFilter(value, { ...filter, op: 'eq' }, kind);
		case 'contains':
			return text.includes(ttext);
		case 'notContains':
			return !text.includes(ttext);
		case 'startsWith':
			return text.startsWith(ttext);
		case 'gt': {
			const c = cmp();
			return c !== null && c > 0;
		}
		case 'gte': {
			const c = cmp();
			return c !== null && c >= 0;
		}
		case 'lt': {
			const c = cmp();
			return c !== null && c < 0;
		}
		case 'lte': {
			const c = cmp();
			return c !== null && c <= 0;
		}
	}
	return true;
}

export function applyFilters(rows: ReportRow[], filters: ReportFilter[], fields: ReportField[]): ReportRow[] {
	const active = filters
		.map((f) => ({ filter: f, field: findField(fields, f.field) }))
		.filter((x): x is { filter: ReportFilter; field: ReportField } => !!x.field)
		// An unfinished filter (no value yet) shouldn't blank the whole preview.
		.filter((x) => VALUELESS_OPS.has(x.filter.op) || x.filter.value.trim() !== '');
	if (active.length === 0) return rows;
	return rows.filter((r) =>
		active.every(({ filter, field }) => matchesFilter(field.get(r), filter, field.kind))
	);
}

// ---- formatting -------------------------------------------------------------

export function formatNumber(n: number, decimals = 2): string {
	return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: decimals });
}

/** Display text for a cell. Swatches render as graphics, so they have no text. */
export function formatCell(v: CellValue, col: Pick<ResolvedColumn, 'kind' | 'decimals' | 'unit'>): string {
	if (isEmpty(v)) return '';
	if (col.kind === 'swatch') return '';
	if (typeof v === 'number') {
		const s = formatNumber(v, col.decimals ?? 2);
		return col.unit ? (col.unit === '%' ? `${s}%` : `${s} ${col.unit}`) : s;
	}
	if (typeof v === 'boolean') return v ? m['reports.yes']() : m['reports.no']();
	return asText(v);
}

/** The group title for a value: its display text, or "(none)" when it's empty. */
export function groupTitle(v: CellValue, field: ReportField): string {
	const s = formatCell(v, {
		kind: field.kind === 'swatch' ? 'color' : field.kind,
		decimals: field.decimals,
		unit: field.unit
	});
	return s === '' ? m['reports.noValue']() : s;
}

// ---- aggregation ------------------------------------------------------------

export function aggregate(values: CellValue[], agg: Aggregate): CellValue {
	if (agg === 'none') return null;
	if (agg === 'count') return values.filter((v) => !isEmpty(v)).length;
	const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
	if (nums.length === 0) return null;
	switch (agg) {
		case 'sum':
			return Math.round(nums.reduce((a, b) => a + b, 0) * 1e6) / 1e6;
		case 'avg':
			return nums.reduce((a, b) => a + b, 0) / nums.length;
		case 'min':
			return Math.min(...nums);
		case 'max':
			return Math.max(...nums);
	}
}

// ---- the report -------------------------------------------------------------

export function resolveColumns(design: ReportDesign, fields: ReportField[]): ResolvedColumn[] {
	return design.columns.map((c) => {
		const field = findField(fields, c.field);
		return {
			column: c,
			field,
			label: c.label.trim() || (field ? field.label() : c.field),
			kind: field?.kind ?? 'text',
			align: c.align,
			aggregate: c.aggregate,
			decimals: field?.decimals,
			unit: field?.unit,
			width: c.width > 0 ? c.width : 1
		};
	});
}

/** Build the full report for a design over the given data. */
export function buildReport(design: ReportDesign, data: ReportData, fields: ReportField[]): ReportResult {
	const columns = resolveColumns(design, fields);
	const groupFields = design.groupBy.map((k) => findField(fields, k)).filter((f): f is ReportField => !!f);
	const sortSpecs = design.sort
		.map((s) => ({ field: findField(fields, s.field), dir: s.dir }))
		.filter((s): s is { field: ReportField; dir: 'asc' | 'desc' } => !!s.field);

	let rows = applyFilters(buildRows(design.entity, data, design.includeArchived), design.filters, fields);

	// Group levels sort first (ascending) so each group's rows are contiguous; the
	// user's sort orders rows within the innermost group. A stable id tiebreak keeps
	// the output identical from run to run.
	const id = (r: ReportRow) => r.spool?.id ?? r.filament?.id ?? r.vendor?.id ?? 0;
	rows = [...rows].sort((a, b) => {
		for (const g of groupFields) {
			const c = compareValues(g.get(a), g.get(b));
			if (c !== 0) return c;
		}
		for (const s of sortSpecs) {
			const c = compareValues(s.field.get(a), s.field.get(b));
			if (c !== 0) return s.dir === 'desc' ? -c : c;
		}
		return id(a) - id(b);
	});

	const values = rows.map((r) => columns.map((c) => (c.field ? c.field.get(r) : null)));
	const hasAggregates = columns.some((c) => c.aggregate !== 'none');
	const lines: ReportLine[] = [];
	const summarize = (from: number, to: number): CellValue[] =>
		columns.map((c, ci) =>
			aggregate(
				values.slice(from, to).map((v) => v[ci]),
				c.aggregate
			)
		);

	// Walk the sorted rows, opening/closing groups whenever a group key changes.
	const groupKey = (r: ReportRow, level: number) =>
		groupFields
			.slice(0, level + 1)
			.map((g) => groupTitle(g.get(r), g))
			.join('\u0000');

	function emit(from: number, to: number, level: number) {
		if (level >= groupFields.length) {
			for (let i = from; i < to; i++) lines.push({ type: 'row', level, cells: values[i] });
			return;
		}
		const g = groupFields[level];
		let start = from;
		while (start < to) {
			const key = groupKey(rows[start], level);
			let end = start + 1;
			while (end < to && groupKey(rows[end], level) === key) end++;
			const title = groupTitle(g.get(rows[start]), g);
			lines.push({ type: 'group', level, label: `${g.label()}: ${title}`, count: end - start, cells: [] });
			emit(start, end, level + 1);
			if (design.showSubtotals) {
				lines.push({
					type: 'subtotal',
					level,
					label: m['reports.subtotalFor']({ name: title }),
					count: end - start,
					cells: summarize(start, end)
				});
			}
			start = end;
		}
	}
	emit(0, rows.length, 0);

	if (design.showGrandTotal) {
		lines.push({
			type: 'total',
			level: 0,
			label: m['reports.grandTotal'](),
			count: rows.length,
			cells: summarize(0, rows.length)
		});
	}

	return { columns, lines, rowCount: rows.length, hasAggregates };
}

/** "1 item" / "3 items" */
export function itemCount(n: number): string {
	return n === 1 ? m['reports.itemCountOne']({ count: '1' }) : m['reports.itemCount']({ count: String(n) });
}
