import { describe, expect, it } from 'vitest';
import { FieldType, type FieldDef } from '$lib/api/fields';
import { buildReport, buildRows, compareValues, formatCell, matchesFilter, type ReportData } from './engine';
import {
	parseExtra,
	reportFields,
	normalizeHex,
	type RawFilament,
	type RawSpool,
	type RawVendor
} from './fields';
import { newColumn, newReport, normalizeReport, type ReportDesign } from './types';

const room: FieldDef = {
	key: 'room',
	name: 'Room',
	order: 1,
	field_type: FieldType.choice,
	choices: ['A', 'B'],
	multi_choice: false,
	entity_type: 'spool'
};
const rack: FieldDef = {
	key: 'rack',
	name: 'Rack',
	order: 2,
	field_type: FieldType.integer,
	entity_type: 'spool'
};
const rfid: FieldDef = {
	key: 'rfid',
	name: 'RFID',
	order: 3,
	field_type: FieldType.choice,
	choices: ['NONE', 'Creality'],
	multi_choice: true,
	entity_type: 'spool'
};
const td: FieldDef = {
	key: 'td',
	name: 'TD',
	order: 1,
	unit: 'mm',
	field_type: FieldType.float,
	entity_type: 'filament'
};
const extra = { spool: [room, rack, rfid], filament: [td], vendor: [] };

const creality: RawVendor = { id: 1, name: 'Creality' };
const esun: RawVendor = { id: 2, name: 'eSun' };
const fil = (
	id: number,
	name: string,
	material: string,
	vendor: RawVendor,
	color: string,
	tdv?: number
): RawFilament => ({
	id,
	name,
	material,
	vendor,
	density: 1.24,
	diameter: 1.75,
	color_hex: color,
	extra: tdv === undefined ? {} : { td: JSON.stringify(tdv) }
});
const f1 = fil(1, 'Hyper PLA Black', 'PLA', creality, '000000', 0.1);
const f2 = fil(2, 'PLA+ Red', 'PLA+', esun, 'b40200', 1.8);
const f3 = fil(3, 'PETG Clear', 'PETG', esun, 'FFFFFF');
const spool = (
	id: number,
	f: RawFilament,
	remaining: number,
	r: string,
	k: number,
	archived = false
): RawSpool => ({
	id,
	filament: f,
	remaining_weight: remaining,
	initial_weight: 1000,
	used_weight: 1000 - remaining,
	location: `${r}-${k}`,
	archived,
	extra: { room: JSON.stringify(r), rack: String(k), rfid: JSON.stringify(['Creality']) }
});
const data: ReportData = {
	vendors: [creality, esun],
	filaments: [f1, f2, f3],
	spools: [
		spool(1, f1, 1000, 'A', 1),
		spool(2, f1, 250, 'A', 2),
		spool(3, f2, 800, 'B', 1),
		spool(4, f3, 0, 'A', 1, true)
	]
};

function design(partial: Partial<ReportDesign>): ReportDesign {
	return normalizeReport({ ...newReport('t'), ...partial });
}

describe('fields', () => {
	it('parses extra field values by type', () => {
		expect(parseExtra('"A"', room)).toBe('A');
		expect(parseExtra('2', rack)).toBe(2);
		expect(parseExtra('["Creality","Snapmaker"]', rfid)).toBe('Creality, Snapmaker');
		expect(parseExtra('0.1', td)).toBe(0.1);
		expect(parseExtra(undefined, td)).toBeNull();
	});

	it('normalizes hex colors to #RRGGBB text', () => {
		expect(normalizeHex('098647')).toBe('#098647');
		expect(normalizeHex('#b40200')).toBe('#B40200');
		expect(normalizeHex('FF0000AA')).toBe('#FF0000');
		expect(normalizeHex('nope')).toBeNull();
	});

	it('offers custom fields for each entity level', () => {
		const keys = reportFields('spool', extra).map((f) => f.key);
		expect(keys).toContain('spool.extra.room');
		expect(keys).toContain('filament.extra.td');
		expect(reportFields('vendor', extra).map((f) => f.key)).not.toContain('spool.extra.room');
	});
});

describe('rows', () => {
	it('leaves archived spools out unless asked', () => {
		expect(buildRows('spool', data, false)).toHaveLength(3);
		expect(buildRows('spool', data, true)).toHaveLength(4);
	});

	it('totals spools per filament and vendor', () => {
		const fr = buildRows('filament', data, false);
		expect(fr.find((r) => r.filament?.id === 1)?.stats).toMatchObject({
			spoolCount: 2,
			remainingTotal: 1250
		});
		expect(fr.find((r) => r.filament?.id === 3)?.stats?.spoolCount).toBe(0);
		const vr = buildRows('vendor', data, false);
		expect(vr.find((r) => r.vendor?.id === 2)?.stats).toMatchObject({
			filamentCount: 2,
			spoolCount: 1,
			remainingTotal: 800
		});
	});
});

describe('filters and sorting', () => {
	it('compares numbers numerically and puts empties last', () => {
		expect(compareValues(2, 10)).toBeLessThan(0);
		expect(compareValues('Rack 2', 'Rack 10')).toBeLessThan(0);
		expect(compareValues(null, 'a')).toBeGreaterThan(0);
	});

	it('matches text, numbers and multi-choice values', () => {
		expect(matchesFilter('A', { id: '1', field: 'x', op: 'eq', value: 'a' }, 'text')).toBe(true);
		expect(matchesFilter(250, { id: '1', field: 'x', op: 'lt', value: '300' }, 'number')).toBe(true);
		expect(matchesFilter(250, { id: '1', field: 'x', op: 'gt', value: '300' }, 'number')).toBe(false);
		expect(
			matchesFilter('Creality, Snapmaker', { id: '1', field: 'x', op: 'eq', value: 'snapmaker' }, 'text')
		).toBe(true);
		expect(matchesFilter(null, { id: '1', field: 'x', op: 'empty', value: '' }, 'number')).toBe(true);
	});
});

describe('buildReport', () => {
	const fields = reportFields('spool', extra);

	it('filters, groups and subtotals', () => {
		const d = design({
			columns: [
				newColumn('spool.id'),
				newColumn('filament.name'),
				newColumn('spool.remaining', { aggregate: 'sum' })
			],
			filters: [{ id: 'f', field: 'spool.extra.room', op: 'eq', value: 'A' }],
			groupBy: ['spool.extra.rack']
		});
		const r = buildReport(d, data, fields);
		expect(r.rowCount).toBe(2);
		expect(r.lines.map((l) => l.type)).toEqual([
			'group',
			'row',
			'subtotal',
			'group',
			'row',
			'subtotal',
			'total'
		]);
		expect(r.lines[0].label).toBe('Rack: 1');
		expect(r.lines[2].cells[2]).toBe(1000);
		expect(r.lines[6].cells[2]).toBe(1250);
	});

	it('sorts within the design order and keeps hex codes as text', () => {
		const d = design({
			columns: [newColumn('filament.color'), newColumn('spool.remaining')],
			sort: [{ field: 'spool.remaining', dir: 'desc' }],
			showGrandTotal: false
		});
		const r = buildReport(d, data, fields);
		expect(r.lines.map((l) => l.cells[1])).toEqual([1000, 800, 250]);
		expect(r.lines[0].cells[0]).toBe('#000000');
		expect(typeof r.lines[0].cells[0]).toBe('string');
	});

	it('survives a column whose field was deleted', () => {
		const d = design({ columns: [newColumn('spool.extra.gone')], showGrandTotal: false });
		const r = buildReport(d, data, fields);
		expect(r.columns[0].field).toBeUndefined();
		expect(r.rowCount).toBe(3);
	});
});

describe('formatCell', () => {
	it('formats numbers with units and booleans', () => {
		expect(formatCell(0.1, { kind: 'number', decimals: 2, unit: 'mm' })).toBe('0.1 mm');
		expect(formatCell(42.5, { kind: 'number', decimals: 0, unit: '%' })).toMatch(/^4[23]%$/);
		expect(formatCell(true, { kind: 'bool' })).toBe('Yes');
		expect(formatCell(['#000000'], { kind: 'swatch' })).toBe('');
	});
});
