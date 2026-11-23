import type { EntityType, FieldDef } from '$lib/api/fields';
import { FieldType } from '$lib/api/fields';
import type { ReportEntity } from './types';
import * as m from '$lib/paraglide/messages';

// The catalog of fields a report column, filter, sort or group can use. Reports
// work on the raw /api/v1 JSON (not the client's mapped domain types) because a
// report needs every row and every field, custom fields included.

export interface RawVendor {
	id: number;
	registered?: string;
	name: string;
	comment?: string | null;
	empty_spool_weight?: number | null;
	external_id?: string | null;
	extra?: Record<string, string>;
}

export interface RawFilament {
	id: number;
	registered?: string;
	name?: string | null;
	vendor?: RawVendor | null;
	material?: string | null;
	price?: number | null;
	density: number;
	td?: number;
	diameter: number;
	weight?: number | null;
	spool_weight?: number | null;
	article_number?: string | null;
	comment?: string | null;
	settings_extruder_temp?: number | null;
	settings_bed_temp?: number | null;
	color_hex?: string | null;
	multi_color_hexes?: string | null;
	multi_color_direction?: string | null;
	external_id?: string | null;
	extra?: Record<string, string>;
}

export interface RawSpool {
	id: number;
	registered?: string;
	first_used?: string | null;
	last_used?: string | null;
	filament: RawFilament;
	price?: number | null;
	remaining_weight?: number | null;
	initial_weight?: number | null;
	spool_weight?: number | null;
	used_weight?: number;
	remaining_length?: number | null;
	used_length?: number;
	location?: string | null;
	lot_nr?: string | null;
	comment?: string | null;
	archived?: boolean;
	extra?: Record<string, string>;
}

/** Totals computed over a filament's or vendor's spools. */
export interface RowStats {
	spoolCount: number;
	remainingTotal: number;
	usedTotal: number;
	initialTotal: number;
	filamentCount: number;
}

/** One report row: the entity itself plus its parents (and totals for filament/vendor rows). */
export interface ReportRow {
	spool?: RawSpool;
	filament?: RawFilament;
	vendor?: RawVendor;
	stats?: RowStats;
}

/** A resolved cell value. Swatches resolve to a list of `#RRGGBB` colors. */
export type CellValue = string | number | boolean | Date | string[] | null;

export type FieldKind = 'text' | 'number' | 'date' | 'color' | 'swatch' | 'bool';

/** Which part of the row a field reads from; also how the field picker groups them. */
export type FieldGroup = 'spool' | 'filament' | 'vendor' | 'totals';

export interface ReportField {
	key: string;
	group: FieldGroup;
	label: () => string;
	kind: FieldKind;
	/** Decimal places shown for numbers. */
	decimals?: number;
	/** Unit appended to numbers when displayed, e.g. "g". */
	unit?: string;
	get: (row: ReportRow) => CellValue;
}

const date = (s: string | null | undefined): Date | null => {
	if (!s) return null;
	const d = new Date(s);
	return Number.isNaN(d.getTime()) ? null : d;
};
const num = (n: number | null | undefined): number | null =>
	n === null || n === undefined || Number.isNaN(n) ? null : n;
const txt = (s: string | null | undefined): string | null =>
	s === null || s === undefined || s === '' ? null : s;

/** Normalize a stored hex (`ff0000`, `#FF0000`, `FF0000AA`) to `#FF0000`. */
export function normalizeHex(raw: string | null | undefined): string | null {
	if (!raw) return null;
	const v = raw.trim().replace(/^#/, '').toUpperCase();
	return /^[0-9A-F]{6}([0-9A-F]{2})?$/.test(v) ? `#${v.slice(0, 6)}` : null;
}

/** All of a filament's colors: the single color, or every color of a multi-color filament. */
export function filamentColors(f: RawFilament | undefined): string[] {
	if (!f) return [];
	if (f.multi_color_hexes) {
		const list = f.multi_color_hexes
			.split(',')
			.map((h) => normalizeHex(h))
			.filter((h): h is string => h !== null);
		if (list.length > 0) return list;
	}
	const one = normalizeHex(f.color_hex);
	return one ? [one] : [];
}

const SPOOL_FIELDS: ReportField[] = [
	{
		key: 'spool.id',
		group: 'spool',
		label: m['spool.fields.id'],
		kind: 'number',
		decimals: 0,
		get: (r) => num(r.spool?.id)
	},
	{
		key: 'spool.location',
		group: 'spool',
		label: m['spool.fields.location'],
		kind: 'text',
		get: (r) => txt(r.spool?.location)
	},
	{
		key: 'spool.lot',
		group: 'spool',
		label: m['spool.fields.lotNr'],
		kind: 'text',
		get: (r) => txt(r.spool?.lot_nr)
	},
	{
		key: 'spool.remaining',
		group: 'spool',
		label: m['labels.fields.remainingG'],
		kind: 'number',
		decimals: 0,
		get: (r) => num(r.spool?.remaining_weight)
	},
	{
		key: 'spool.initial',
		group: 'spool',
		label: m['labels.fields.initialG'],
		kind: 'number',
		decimals: 0,
		get: (r) => num(r.spool?.initial_weight)
	},
	{
		key: 'spool.used',
		group: 'spool',
		label: m['spool.fields.usedWeight'],
		kind: 'number',
		decimals: 0,
		get: (r) => num(r.spool?.used_weight)
	},
	{
		key: 'spool.remainingPct',
		group: 'spool',
		label: m['reports.fields.remainingPct'],
		kind: 'number',
		decimals: 0,
		unit: '%',
		get: (r) => {
			const rem = r.spool?.remaining_weight;
			const init = r.spool?.initial_weight;
			return rem !== null && rem !== undefined && init ? Math.round((rem / init) * 1000) / 10 : null;
		}
	},
	{
		key: 'spool.remainingLength',
		group: 'spool',
		label: m['reports.fields.remainingLengthM'],
		kind: 'number',
		decimals: 1,
		get: (r) => {
			const l = r.spool?.remaining_length;
			return l === null || l === undefined ? null : l / 1000;
		}
	},
	{
		key: 'spool.spoolWeight',
		group: 'spool',
		label: m['spool.fields.spoolWeight'],
		kind: 'number',
		decimals: 0,
		get: (r) => num(r.spool?.spool_weight ?? r.filament?.spool_weight)
	},
	{
		key: 'spool.price',
		group: 'spool',
		label: m['spool.fields.price'],
		kind: 'number',
		decimals: 2,
		get: (r) => num(r.spool?.price ?? r.filament?.price)
	},
	{
		key: 'spool.registered',
		group: 'spool',
		label: m['spool.fields.registered'],
		kind: 'date',
		get: (r) => date(r.spool?.registered)
	},
	{
		key: 'spool.firstUsed',
		group: 'spool',
		label: m['spool.fields.firstUsed'],
		kind: 'date',
		get: (r) => date(r.spool?.first_used)
	},
	{
		key: 'spool.lastUsed',
		group: 'spool',
		label: m['spool.fields.lastUsed'],
		kind: 'date',
		get: (r) => date(r.spool?.last_used)
	},
	{
		key: 'spool.archived',
		group: 'spool',
		label: m['reports.fields.archived'],
		kind: 'bool',
		get: (r) => (r.spool ? !!r.spool.archived : null)
	},
	{
		key: 'spool.comment',
		group: 'spool',
		label: m['spool.fields.comment'],
		kind: 'text',
		get: (r) => txt(r.spool?.comment)
	}
];

const FILAMENT_FIELDS: ReportField[] = [
	{
		key: 'filament.id',
		group: 'filament',
		label: m['filament.fields.id'],
		kind: 'number',
		decimals: 0,
		get: (r) => num(r.filament?.id)
	},
	{
		key: 'filament.name',
		group: 'filament',
		label: m['filament.fields.name'],
		kind: 'text',
		get: (r) => txt(r.filament?.name)
	},
	{
		key: 'filament.material',
		group: 'filament',
		label: m['filament.fields.material'],
		kind: 'text',
		get: (r) => txt(r.filament?.material)
	},
	{
		key: 'filament.color',
		group: 'filament',
		label: m['inspector.colorHex'],
		kind: 'color',
		get: (r) => {
			const c = filamentColors(r.filament);
			return c.length ? c.join(', ') : null;
		}
	},
	{
		key: 'filament.swatch',
		group: 'filament',
		label: m['reports.fields.swatch'],
		kind: 'swatch',
		get: (r) => {
			const c = filamentColors(r.filament);
			return c.length ? c : null;
		}
	},
	{
		key: 'filament.td',
		group: 'filament',
		label: m['filament.fields.td'],
		kind: 'number',
		decimals: 1,
		get: (r) => num(r.filament?.td)
	},
	{
		key: 'filament.diameter',
		group: 'filament',
		label: m['labels.fields.diameterMm'],
		kind: 'number',
		decimals: 2,
		get: (r) => num(r.filament?.diameter)
	},
	{
		key: 'filament.density',
		group: 'filament',
		label: m['filament.fields.density'],
		kind: 'number',
		decimals: 2,
		get: (r) => num(r.filament?.density)
	},
	{
		key: 'filament.weight',
		group: 'filament',
		label: m['labels.fields.netWeightG'],
		kind: 'number',
		decimals: 0,
		get: (r) => num(r.filament?.weight)
	},
	{
		key: 'filament.spoolWeight',
		group: 'filament',
		label: m['filament.fields.spoolWeight'],
		kind: 'number',
		decimals: 0,
		get: (r) => num(r.filament?.spool_weight)
	},
	{
		key: 'filament.price',
		group: 'filament',
		label: m['filament.fields.price'],
		kind: 'number',
		decimals: 2,
		get: (r) => num(r.filament?.price)
	},
	{
		key: 'filament.nozzleTemp',
		group: 'filament',
		label: m['library.sort.nozzle'],
		kind: 'number',
		decimals: 0,
		get: (r) => num(r.filament?.settings_extruder_temp)
	},
	{
		key: 'filament.bedTemp',
		group: 'filament',
		label: m['labels.fields.bedTemp'],
		kind: 'number',
		decimals: 0,
		get: (r) => num(r.filament?.settings_bed_temp)
	},
	{
		key: 'filament.articleNumber',
		group: 'filament',
		label: m['filament.fields.articleNumber'],
		kind: 'text',
		get: (r) => txt(r.filament?.article_number)
	},
	{
		key: 'filament.externalId',
		group: 'filament',
		label: m['filament.fields.externalId'],
		kind: 'text',
		get: (r) => txt(r.filament?.external_id)
	},
	{
		key: 'filament.registered',
		group: 'filament',
		label: m['filament.fields.registered'],
		kind: 'date',
		get: (r) => date(r.filament?.registered)
	},
	{
		key: 'filament.comment',
		group: 'filament',
		label: m['filament.fields.comment'],
		kind: 'text',
		get: (r) => txt(r.filament?.comment)
	}
];

const VENDOR_FIELDS: ReportField[] = [
	{
		key: 'vendor.id',
		group: 'vendor',
		label: m['reports.fields.vendorId'],
		kind: 'number',
		decimals: 0,
		get: (r) => num(r.vendor?.id)
	},
	{
		key: 'vendor.name',
		group: 'vendor',
		label: m['vendor.fields.name'],
		kind: 'text',
		get: (r) => txt(r.vendor?.name)
	},
	{
		key: 'vendor.emptyWeight',
		group: 'vendor',
		label: m['vendor.fields.emptySpoolWeight'],
		kind: 'number',
		decimals: 0,
		get: (r) => num(r.vendor?.empty_spool_weight)
	},
	{
		key: 'vendor.externalId',
		group: 'vendor',
		label: m['vendor.fields.externalId'],
		kind: 'text',
		get: (r) => txt(r.vendor?.external_id)
	},
	{
		key: 'vendor.registered',
		group: 'vendor',
		label: m['vendor.fields.registered'],
		kind: 'date',
		get: (r) => date(r.vendor?.registered)
	},
	{
		key: 'vendor.comment',
		group: 'vendor',
		label: m['vendor.fields.comment'],
		kind: 'text',
		get: (r) => txt(r.vendor?.comment)
	}
];

const FILAMENT_TOTALS: ReportField[] = [
	{
		key: 'filament.spoolCount',
		group: 'totals',
		label: m['reports.fields.spoolCount'],
		kind: 'number',
		decimals: 0,
		get: (r) => num(r.stats?.spoolCount)
	},
	{
		key: 'filament.remainingTotal',
		group: 'totals',
		label: m['reports.fields.remainingTotalG'],
		kind: 'number',
		decimals: 0,
		get: (r) => num(r.stats?.remainingTotal)
	},
	{
		key: 'filament.usedTotal',
		group: 'totals',
		label: m['reports.fields.usedTotalG'],
		kind: 'number',
		decimals: 0,
		get: (r) => num(r.stats?.usedTotal)
	}
];

const VENDOR_TOTALS: ReportField[] = [
	{
		key: 'vendor.filamentCount',
		group: 'totals',
		label: m['reports.fields.filamentCount'],
		kind: 'number',
		decimals: 0,
		get: (r) => num(r.stats?.filamentCount)
	},
	{
		key: 'vendor.spoolCount',
		group: 'totals',
		label: m['reports.fields.spoolCount'],
		kind: 'number',
		decimals: 0,
		get: (r) => num(r.stats?.spoolCount)
	},
	{
		key: 'vendor.remainingTotal',
		group: 'totals',
		label: m['reports.fields.remainingTotalG'],
		kind: 'number',
		decimals: 0,
		get: (r) => num(r.stats?.remainingTotal)
	},
	{
		key: 'vendor.usedTotal',
		group: 'totals',
		label: m['reports.fields.usedTotalG'],
		kind: 'number',
		decimals: 0,
		get: (r) => num(r.stats?.usedTotal)
	}
];

/**
 * Parse an extra-field value (stored JSON-encoded) according to its definition.
 * Multi-choice and range values become display text; numbers stay numbers so
 * they can be summed, sorted and filtered numerically.
 */
export function parseExtra(raw: string | undefined, def: FieldDef): CellValue {
	if (raw === undefined || raw === null || raw === '') return null;
	let v: unknown;
	try {
		v = JSON.parse(raw);
	} catch {
		v = raw;
	}
	if (v === null || v === '') return null;
	switch (def.field_type) {
		case FieldType.integer:
		case FieldType.float: {
			const n = typeof v === 'number' ? v : Number(v);
			return Number.isFinite(n) ? n : null;
		}
		case FieldType.integer_range:
		case FieldType.float_range:
			return Array.isArray(v) ? v.filter((x) => x !== null).join(' – ') || null : String(v);
		case FieldType.boolean:
			return typeof v === 'boolean' ? v : String(v).toLowerCase() === 'true';
		case FieldType.datetime:
			return date(String(v));
		case FieldType.choice:
			return Array.isArray(v) ? v.map(String).join(', ') || null : String(v);
		default:
			return Array.isArray(v) ? v.map(String).join(', ') : String(v);
	}
}

function extraFields(entity: EntityType, defs: FieldDef[]): ReportField[] {
	const group: FieldGroup = entity;
	return defs.map((def) => {
		const numeric = def.field_type === FieldType.integer || def.field_type === FieldType.float;
		const kind: FieldKind = numeric
			? 'number'
			: def.field_type === FieldType.boolean
				? 'bool'
				: def.field_type === FieldType.datetime
					? 'date'
					: 'text';
		return {
			key: `${entity}.extra.${def.key}`,
			group,
			label: () => def.name,
			kind,
			decimals: def.field_type === FieldType.integer ? 0 : numeric ? 2 : undefined,
			unit: def.unit ?? undefined,
			get: (r: ReportRow) => {
				const src = entity === 'spool' ? r.spool : entity === 'filament' ? r.filament : r.vendor;
				return parseExtra(src?.extra?.[def.key], def);
			}
		} satisfies ReportField;
	});
}

export type ExtraDefs = Record<EntityType, FieldDef[]>;

/** Every field available to a report of the given entity, custom fields included. */
export function reportFields(entity: ReportEntity, extra: ExtraDefs): ReportField[] {
	const vendor = [...VENDOR_FIELDS, ...extraFields('vendor', extra.vendor ?? [])];
	const filament = [...FILAMENT_FIELDS, ...extraFields('filament', extra.filament ?? [])];
	switch (entity) {
		case 'spool':
			return [...SPOOL_FIELDS, ...extraFields('spool', extra.spool ?? []), ...filament, ...vendor];
		case 'filament':
			return [...filament, ...FILAMENT_TOTALS, ...vendor];
		case 'vendor':
			return [...vendor, ...VENDOR_TOTALS];
	}
}

/** Look up a field by key; unknown keys (e.g. a deleted custom field) give undefined. */
export function findField(fields: ReportField[], key: string): ReportField | undefined {
	return fields.find((f) => f.key === key);
}

export const FIELD_GROUP_LABELS: Record<FieldGroup, () => string> = {
	spool: m['library.section.spool'],
	filament: m['library.section.filament'],
	vendor: m['labels.fields.groupVendor'],
	totals: m['reports.fields.groupTotals']
};
