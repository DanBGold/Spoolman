import * as m from '$lib/paraglide/messages';

// A report design: a saved table definition (which entity, which columns, how to
// filter, sort and group, and how the printed page looks). Designs are stored as
// a JSON array in the `report_designs` server setting, the same way label designs
// are stored in `label_designs`.

export type ReportEntity = 'spool' | 'filament' | 'vendor';

/** How a column is summarized on subtotal and grand-total rows. */
export type Aggregate = 'none' | 'sum' | 'avg' | 'min' | 'max' | 'count';

export type Align = 'left' | 'center' | 'right';

export interface ReportColumn {
	id: string;
	/** Field key from the field catalog, e.g. `filament.material` or `spool.extra.room`. */
	field: string;
	/** Header text. Empty means "use the field's own label". */
	label: string;
	align: Align;
	aggregate: Aggregate;
	/** Relative width hint for printing (1 = normal). */
	width: number;
}

export type FilterOp =
	| 'eq'
	| 'neq'
	| 'contains'
	| 'notContains'
	| 'startsWith'
	| 'gt'
	| 'gte'
	| 'lt'
	| 'lte'
	| 'empty'
	| 'notEmpty';

export interface ReportFilter {
	id: string;
	field: string;
	op: FilterOp;
	value: string;
}

export interface ReportSort {
	field: string;
	dir: 'asc' | 'desc';
}

export type PaperName = 'letter' | 'legal' | 'a4' | 'a3' | 'tabloid';

export interface ReportPage {
	paper: PaperName;
	landscape: boolean;
	/** Body font size in points. */
	fontSize: number;
	/** Page margin in millimetres. */
	margin: number;
	/** Shade every other row. */
	stripes: boolean;
}

export interface ReportHeader {
	title: string;
	subtitle: string;
	showDate: boolean;
	/** Show how many rows the report contains. */
	showCount: boolean;
}

export interface ReportFooter {
	text: string;
	showPageNumbers: boolean;
}

export interface ReportDesign {
	id: string;
	name: string;
	entity: ReportEntity;
	columns: ReportColumn[];
	/** All filters must match (AND). */
	filters: ReportFilter[];
	includeArchived: boolean;
	/** Up to three nested grouping levels, outermost first. */
	groupBy: string[];
	sort: ReportSort[];
	showSubtotals: boolean;
	showGrandTotal: boolean;
	/** Start each top-level group on a new printed page. */
	pageBreakPerGroup: boolean;
	header: ReportHeader;
	footer: ReportFooter;
	page: ReportPage;
}

export const MAX_GROUP_LEVELS = 3;

export const DEFAULT_PAGE: ReportPage = {
	paper: 'letter',
	landscape: false,
	fontSize: 9,
	margin: 12,
	stripes: true
};

export const DEFAULT_HEADER: ReportHeader = { title: '', subtitle: '', showDate: true, showCount: true };
export const DEFAULT_FOOTER: ReportFooter = { text: '', showPageNumbers: true };

let seq = 0;
export function uid(prefix = 'r'): string {
	return typeof crypto !== 'undefined' && crypto.randomUUID
		? crypto.randomUUID()
		: `${prefix}-${Date.now()}-${(seq++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newColumn(field: string, partial: Partial<ReportColumn> = {}): ReportColumn {
	return { id: uid('c'), field, label: '', align: 'left', aggregate: 'none', width: 1, ...partial };
}

/** Starter columns per entity so a new report is useful straight away. */
export function defaultColumns(entity: ReportEntity): ReportColumn[] {
	switch (entity) {
		case 'spool':
			return [
				newColumn('spool.id', { width: 0.6 }),
				newColumn('vendor.name', { label: m['reports.col.vendor']() }),
				newColumn('filament.name', { width: 2, label: m['reports.col.filament']() }),
				newColumn('filament.material', { width: 0.8 }),
				newColumn('filament.swatch', { width: 0.5, align: 'center', label: m['reports.col.color']() }),
				newColumn('filament.color', { width: 0.9, label: m['reports.col.hex']() }),
				newColumn('spool.location'),
				newColumn('spool.remaining', { align: 'right', aggregate: 'sum' })
			];
		case 'filament':
			return [
				newColumn('vendor.name', { label: m['reports.col.vendor']() }),
				newColumn('filament.name', { width: 2, label: m['reports.col.filament']() }),
				newColumn('filament.material', { width: 0.8 }),
				newColumn('filament.swatch', { width: 0.5, align: 'center', label: m['reports.col.color']() }),
				newColumn('filament.color', { width: 0.9, label: m['reports.col.hex']() }),
				newColumn('filament.spoolCount', { align: 'right', aggregate: 'sum' }),
				newColumn('filament.remainingTotal', { align: 'right', aggregate: 'sum' })
			];
		case 'vendor':
			return [
				newColumn('vendor.name', { width: 2 }),
				newColumn('vendor.filamentCount', { align: 'right', aggregate: 'sum' }),
				newColumn('vendor.spoolCount', { align: 'right', aggregate: 'sum' }),
				newColumn('vendor.remainingTotal', { align: 'right', aggregate: 'sum' })
			];
	}
}

export function newReport(id: string, entity: ReportEntity = 'spool'): ReportDesign {
	return {
		id,
		name: 'New report',
		entity,
		columns: defaultColumns(entity),
		filters: [],
		includeArchived: false,
		groupBy: [],
		sort: [],
		showSubtotals: true,
		showGrandTotal: true,
		pageBreakPerGroup: false,
		header: { ...DEFAULT_HEADER },
		footer: { ...DEFAULT_FOOTER },
		page: { ...DEFAULT_PAGE }
	};
}

/**
 * Fill in anything a stored design is missing (designs saved by an older build,
 * or hand-edited JSON) so the rest of the code can rely on every field existing.
 */
export function normalizeReport(d: Partial<ReportDesign> & { id: string }): ReportDesign {
	const base = newReport(d.id, d.entity ?? 'spool');
	return {
		...base,
		...d,
		columns: (d.columns ?? base.columns).map((c) => ({ ...newColumn(c.field), ...c })),
		filters: d.filters ?? [],
		groupBy: (d.groupBy ?? []).slice(0, MAX_GROUP_LEVELS),
		sort: d.sort ?? [],
		header: { ...DEFAULT_HEADER, ...d.header },
		footer: { ...DEFAULT_FOOTER, ...d.footer },
		page: { ...DEFAULT_PAGE, ...d.page }
	};
}

/** Switch a design's entity, resetting the parts that only make sense for the old one. */
export function setReportEntity(d: ReportDesign, entity: ReportEntity): void {
	if (d.entity === entity) return;
	d.entity = entity;
	d.columns = defaultColumns(entity);
	d.filters = [];
	d.groupBy = [];
	d.sort = [];
}
