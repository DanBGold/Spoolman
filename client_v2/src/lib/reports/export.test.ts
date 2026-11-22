import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { writeFileSync, mkdirSync } from 'node:fs';
import { FieldType, type FieldDef } from '$lib/api/fields';
import { buildReport, type ReportData } from './engine';
import { reportFields, type RawFilament, type RawSpool, type RawVendor } from './fields';
import { buildCsv, buildXlsx, dataRows } from './export';
import { renderReportHtml } from './html';
import { newColumn, newReport, normalizeReport, type ReportDesign } from './types';

const room: FieldDef = {
	key: 'room',
	name: 'Room',
	order: 1,
	field_type: FieldType.choice,
	choices: ['A', 'B'],
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
const extra = { spool: [room], filament: [td], vendor: [] };
const polar: RawVendor = { id: 1, name: 'Polar Filament' };
const fil = (id: number, name: string, color: string, multi?: string): RawFilament => ({
	id,
	name,
	material: 'PLA',
	vendor: polar,
	density: 1.24,
	diameter: 1.75,
	color_hex: color,
	multi_color_hexes: multi,
	extra: { td: '1.5' }
});
const shamrock = fil(1, 'Shamrock', '098647');
const black = fil(2, 'Classic Black', '000000');
const rainbow = fil(3, 'Rainbow <&> "Mix"', '', 'FF0000,00FF00,0000FF');
const s = (id: number, f: RawFilament, r: string, w: number): RawSpool => ({
	id,
	filament: f,
	remaining_weight: w,
	initial_weight: 1000,
	registered: '2026-11-09T18:40:20Z',
	extra: { room: JSON.stringify(r) }
});
const data: ReportData = {
	vendors: [polar],
	filaments: [shamrock, black, rainbow],
	spools: [s(1, shamrock, 'A', 1000), s(2, black, 'A', 300), s(3, rainbow, 'B', 650)]
};
const fields = reportFields('spool', extra);

function design(p: Partial<ReportDesign>): ReportDesign {
	return normalizeReport({
		...newReport('x'),
		name: 'Spools by room',
		columns: [
			newColumn('spool.id'),
			newColumn('filament.name', { width: 2 }),
			newColumn('filament.swatch'),
			newColumn('filament.color'),
			newColumn('filament.extra.td'),
			newColumn('spool.registered'),
			newColumn('spool.remaining', { aggregate: 'sum', align: 'right' })
		],
		...p
	});
}

describe('xlsx', () => {
	const d = design({
		groupBy: ['spool.extra.room'],
		header: { title: '', subtitle: 'Test', showDate: true, showCount: true }
	});
	const result = buildReport(d, data, fields);
	const bytes = buildXlsx(d, result, new Date(2026, 10, 22, 9, 0));
	const files = unzipSync(bytes);
	const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);

	it('is a zip with the parts Excel needs', () => {
		expect(Object.keys(files).sort()).toEqual(
			[
				'[Content_Types].xml',
				'_rels/.rels',
				'xl/_rels/workbook.xml.rels',
				'xl/styles.xml',
				'xl/workbook.xml',
				'xl/worksheets/sheet1.xml'
			].sort()
		);
	});

	it('stores all-digit color codes as text with a #', () => {
		expect(sheet).toContain('<t xml:space="preserve">#098647</t>');
		expect(sheet).toContain('<t xml:space="preserve">#000000</t>');
		expect(sheet).not.toMatch(/<v>98647<\/v>/);
	});

	it('fills swatch cells with the filament color and escapes text', () => {
		expect(strFromU8(files['xl/styles.xml'])).toContain('rgb="FF098647"');
		expect(sheet).toContain('Rainbow &lt;&amp;&gt; &quot;Mix&quot;');
	});

	it('writes group, subtotal and total rows', () => {
		expect(sheet).toContain('Room: A (2 items)');
		expect(sheet).toContain('<v>1950</v>');
	});

	// Written for inspection with real spreadsheet software in CI-less checks.
	mkdirSync('/tmp/report-samples', { recursive: true });
	writeFileSync('/tmp/report-samples/grouped.xlsx', bytes);
	const flat = design({ showGrandTotal: false });
	writeFileSync(
		'/tmp/report-samples/flat.xlsx',
		buildXlsx(flat, buildReport(flat, data, fields), new Date())
	);
});

describe('csv', () => {
	it('has a header and one line per item, with colors as #text', () => {
		const d = design({ groupBy: ['spool.extra.room'] });
		const r = buildReport(d, data, fields);
		const csv = buildCsv(d, r, fields, dataRows);
		const lines = csv.replace('﻿', '').trim().split('\r\n');
		expect(lines).toHaveLength(4);
		expect(lines[0]).toBe('Room,ID,Name,Color swatch,Color hex,TD (mm),Registered,Remaining (g)');
		expect(lines[1]).toContain(',#098647,');
		expect(lines[1].startsWith('A,1,Shamrock,')).toBe(true);
		expect(csv).toContain('"Rainbow <&> ""Mix"""');
		expect(csv).toContain('"#FF0000, #00FF00, #0000FF"');
	});
});

describe('html', () => {
	it('renders text, swatches, totals and page counters', () => {
		const d = design({
			groupBy: ['spool.extra.room'],
			pageBreakPerGroup: true,
			footer: { text: 'My "shop"', showPageNumbers: true }
		});
		const html = renderReportHtml(d, buildReport(d, data, fields), { generatedAt: new Date() });
		expect(html).toContain('<h1>Spools by room</h1>');
		expect(html).toContain('background:#098647');
		expect(html).toContain('<span class="hex">#000000</span>');
		expect(html).toContain('Rainbow &lt;&amp;&gt; &quot;Mix&quot;');
		expect(html).toContain('counter(page)');
		expect(html).toContain('"My \\"shop\\""');
		expect(html.match(/class="chunk brk"/g)).toHaveLength(1);
		writeFileSync('/tmp/report-samples/report.html', html);
	});
});
