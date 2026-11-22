import { zipSync, strToU8 } from 'fflate';
import type { ReportDesign } from './types';
import { formatCell, itemCount, type ReportLine, type ReportResult, type ResolvedColumn } from './engine';
import { findField, type CellValue, type ReportField } from './fields';
import { formatGenerated, reportTitle } from './html';
import * as m from '$lib/paraglide/messages';

// Excel (.xlsx) and CSV exports. Both write color codes as text ("#098647") so
// spreadsheet apps can't turn all-digit codes into numbers, and both are built
// from the same ReportResult as the printed report.

// ---- shared -----------------------------------------------------------------

/** Header text, with the unit added where the label doesn't already say it. */
function headerLabel(c: ResolvedColumn): string {
	const base = c.field ? c.label : `${c.label} (${m['reports.missingField']()})`;
	if (!c.unit || c.unit === '%' || base.includes(`(${c.unit})`)) return base;
	return `${base} (${c.unit})`;
}

/** A value as export text: colors keep their "#", swatches export their colors. */
function exportText(v: CellValue): string {
	if (v === null || v === undefined) return '';
	if (Array.isArray(v)) return v.join(', ');
	if (v instanceof Date) return v.toISOString();
	if (typeof v === 'number') return String(v);
	if (typeof v === 'boolean') return v ? m['reports.yes']() : m['reports.no']();
	return String(v);
}

export function fileBaseName(design: ReportDesign): string {
	const name =
		reportTitle(design)
			.replace(/[\\/:*?"<>|]+/g, ' ')
			.trim() || 'report';
	const d = new Date();
	const p = (n: number) => String(n).padStart(2, '0');
	return `${name} ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function download(bytes: Uint8Array | string, name: string, mimeType: string): void {
	const blob = new Blob([bytes as BlobPart], { type: mimeType });
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = name;
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// ---- CSV --------------------------------------------------------------------

function csvCell(s: string): string {
	return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Plain CSV: one header row and one line per item (no group or total lines, so it
 * imports cleanly). Grouped-by fields that aren't already columns are added in
 * front so the grouping information isn't lost.
 */
export function buildCsv(
	design: ReportDesign,
	result: ReportResult,
	fields: ReportField[],
	rowsOf: (r: ReportResult) => CellValue[][]
): string {
	const cols = result.columns;
	const groupExtra = design.groupBy
		.filter((k) => !cols.some((c) => c.column.field === k))
		.map((k) => findField(fields, k))
		.filter((f): f is ReportField => !!f);
	const head = [...groupExtra.map((f) => f.label()), ...cols.map(headerLabel)];
	const lines = [head.map(csvCell).join(',')];
	const groupValues = groupValuesPerRow(result, design, fields, groupExtra);
	rowsOf(result).forEach((cells, i) => {
		const g = groupValues[i] ?? [];
		lines.push([...g, ...cells.map((v) => exportText(v))].map(csvCell).join(','));
	});
	// BOM so Excel opens UTF-8 (e.g. "–", accents) correctly.
	return '﻿' + lines.join('\r\n') + '\r\n';
}

/** For each data row, the current title of every extra group level (from the group lines). */
function groupValuesPerRow(
	result: ReportResult,
	design: ReportDesign,
	fields: ReportField[],
	extra: ReportField[]
): string[][] {
	if (extra.length === 0) return [];
	const levelOf = new Map(design.groupBy.map((k, i) => [k, i]));
	const current: string[] = [];
	const out: string[][] = [];
	for (const line of result.lines) {
		if (line.type === 'group') {
			const field = findField(fields, design.groupBy[line.level]);
			const prefix = field ? `${field.label()}: ` : '';
			current[line.level] = (line.label ?? '').startsWith(prefix)
				? (line.label ?? '').slice(prefix.length)
				: (line.label ?? '');
			current.length = line.level + 1;
		} else if (line.type === 'row') {
			out.push(extra.map((f) => current[levelOf.get(f.key) ?? -1] ?? ''));
		}
	}
	return out;
}

export function dataRows(result: ReportResult): CellValue[][] {
	return result.lines.filter((l) => l.type === 'row').map((l) => l.cells);
}

// ---- XLSX -------------------------------------------------------------------

const esc = (s: string) =>
	s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		// XML 1.0 forbids most control characters.
		// eslint-disable-next-line no-control-regex
		.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

function colName(i: number): string {
	let s = '';
	for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
	return s;
}

/** Excel serial date (days since 1899-12-30) in local time. */
function excelDate(d: Date): number {
	const utc = Date.UTC(
		d.getFullYear(),
		d.getMonth(),
		d.getDate(),
		d.getHours(),
		d.getMinutes(),
		d.getSeconds()
	);
	return utc / 86400000 + 25569;
}

type FontId = 0 | 1 | 2 | 3; // normal, bold, title, dim
type BorderId = 0 | 1 | 2 | 3; // none, bottom, top, double-top

interface StyleKey {
	font: FontId;
	fill?: string; // RRGGBB
	border: BorderId;
	numFmt: number;
	align?: 'left' | 'center' | 'right';
	text?: boolean;
}

/** Collects the distinct cell formats a sheet uses and writes styles.xml for them. */
class Styles {
	private fills: string[] = [];
	private xfs: StyleKey[] = [];
	private index = new Map<string, number>();
	private customFmts = new Map<string, number>();

	constructor() {
		this.get({ font: 0, border: 0, numFmt: 0 }); // default style must be index 0
	}

	numFmt(code: string): number {
		if (code === 'General') return 0;
		if (code === '#,##0') return 3;
		if (code === '@') return 49;
		let id = this.customFmts.get(code);
		if (id === undefined) {
			id = 164 + this.customFmts.size;
			this.customFmts.set(code, id);
		}
		return id;
	}

	get(k: StyleKey): number {
		const key = JSON.stringify(k);
		let i = this.index.get(key);
		if (i === undefined) {
			if (k.fill && !this.fills.includes(k.fill)) this.fills.push(k.fill);
			i = this.xfs.length;
			this.xfs.push(k);
			this.index.set(key, i);
		}
		return i;
	}

	xml(fontPt: number): string {
		const fonts = [
			`<font><sz val="${fontPt}"/><name val="Arial"/></font>`,
			`<font><b/><sz val="${fontPt}"/><name val="Arial"/></font>`,
			`<font><b/><sz val="${fontPt + 5}"/><name val="Arial"/></font>`,
			`<font><sz val="${fontPt}"/><color rgb="FF666666"/><name val="Arial"/></font>`
		];
		const fills = [
			'<fill><patternFill patternType="none"/></fill>',
			'<fill><patternFill patternType="gray125"/></fill>',
			...this.fills.map(
				(c) =>
					`<fill><patternFill patternType="solid"><fgColor rgb="FF${c}"/><bgColor indexed="64"/></patternFill></fill>`
			)
		];
		const borders = [
			'<border><left/><right/><top/><bottom/><diagonal/></border>',
			'<border><left/><right/><top/><bottom style="medium"><color rgb="FF333333"/></bottom><diagonal/></border>',
			'<border><left/><right/><top style="thin"><color rgb="FF888888"/></top><bottom/><diagonal/></border>',
			'<border><left/><right/><top style="double"><color rgb="FF333333"/></top><bottom/><diagonal/></border>'
		];
		const xfs = this.xfs.map((k) => {
			const fillId = k.fill ? this.fills.indexOf(k.fill) + 2 : 0;
			const attrs = [
				`numFmtId="${k.numFmt}"`,
				`fontId="${k.font}"`,
				`fillId="${fillId}"`,
				`borderId="${k.border}"`,
				'xfId="0"',
				k.numFmt ? 'applyNumberFormat="1"' : '',
				k.font ? 'applyFont="1"' : '',
				fillId ? 'applyFill="1"' : '',
				k.border ? 'applyBorder="1"' : '',
				k.align ? 'applyAlignment="1"' : ''
			]
				.filter(Boolean)
				.join(' ');
			return k.align ? `<xf ${attrs}><alignment horizontal="${k.align}"/></xf>` : `<xf ${attrs}/>`;
		});
		const numFmts = [...this.customFmts].map(
			([code, id]) => `<numFmt numFmtId="${id}" formatCode="${esc(code)}"/>`
		);
		return (
			'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
			'<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
			(numFmts.length ? `<numFmts count="${numFmts.length}">${numFmts.join('')}</numFmts>` : '') +
			`<fonts count="${fonts.length}">${fonts.join('')}</fonts>` +
			`<fills count="${fills.length}">${fills.join('')}</fills>` +
			`<borders count="${borders.length}">${borders.join('')}</borders>` +
			'<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
			`<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>` +
			'<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
			'</styleSheet>'
		);
	}
}

const GROUP_FILLS = ['DFE6EE', 'EBF0F5', 'F3F6F9'];

function numberFormat(c: ResolvedColumn, styles: Styles, summary = false): number {
	if (summary && c.aggregate === 'count') return 3;
	if (c.unit === '%') return styles.numFmt('0.0"%"');
	return c.decimals === 0 ? 3 : 0;
}

export function buildXlsx(design: ReportDesign, result: ReportResult, generatedAt: Date): Uint8Array {
	const styles = new Styles();
	const cols = result.columns;
	const ncols = Math.max(cols.length, 1);
	const dateFmt = styles.numFmt('yyyy-mm-dd');
	const rows: string[] = [];
	const merges: string[] = [];
	let r = 0;

	const strCell = (ref: string, s: string, style: number) =>
		`<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(s)}</t></is></c>`;
	const numCell = (ref: string, n: number, style: number) => `<c r="${ref}" s="${style}"><v>${n}</v></c>`;
	const blankCell = (ref: string, style: number) => `<c r="${ref}" s="${style}"/>`;

	function pushRow(cells: string[], height?: number) {
		r++;
		rows.push(`<row r="${r}"${height ? ` ht="${height}" customHeight="1"` : ''}>${cells.join('')}</row>`);
	}
	/** A label cell spanning the whole table width. */
	function fullWidth(text: string, style: number, height?: number) {
		const rowNo = r + 1;
		const cells = [strCell(`A${rowNo}`, text, style)];
		for (let i = 1; i < ncols; i++) cells.push(blankCell(`${colName(i)}${rowNo}`, style));
		if (ncols > 1) merges.push(`A${rowNo}:${colName(ncols - 1)}${rowNo}`);
		pushRow(cells, height);
	}

	// Title block.
	fullWidth(reportTitle(design), styles.get({ font: 2, border: 0, numFmt: 0 }), 22);
	if (design.header.subtitle.trim())
		fullWidth(design.header.subtitle.trim(), styles.get({ font: 0, border: 0, numFmt: 0 }));
	const meta: string[] = [];
	if (design.header.showDate) meta.push(m['reports.generatedOn']({ date: formatGenerated(generatedAt) }));
	if (design.header.showCount) meta.push(itemCount(result.rowCount));
	if (meta.length) fullWidth(meta.join(' · '), styles.get({ font: 3, border: 0, numFmt: 0 }));
	pushRow([]);

	// Column headers.
	const headerRow = r + 1;
	pushRow(
		cols.map((c, i) =>
			strCell(
				`${colName(i)}${headerRow}`,
				headerLabel(c),
				styles.get({ font: 1, fill: 'E9ECEF', border: 1, numFmt: 0, align: c.align })
			)
		)
	);

	let stripe = 0;
	for (const line of result.lines) {
		const rowNo = r + 1;
		if (line.type === 'group') {
			stripe = 0;
			const indent = '    '.repeat(line.level);
			fullWidth(
				`${indent}${line.label ?? ''} (${itemCount(line.count ?? 0)})`,
				styles.get({ font: 1, fill: GROUP_FILLS[Math.min(line.level, 2)], border: 0, numFmt: 0 })
			);
			continue;
		}
		if (line.type === 'row') {
			const fill = design.page.stripes && stripe++ % 2 === 1 ? 'F5F6F7' : undefined;
			pushRow(cols.map((c, i) => dataCell(`${colName(i)}${rowNo}`, line.cells[i], c, fill)));
			continue;
		}
		pushRow(summaryCells(line, rowNo));
	}

	function dataCell(ref: string, v: CellValue, c: ResolvedColumn, fill?: string): string {
		const base = { font: 0 as FontId, border: 0 as BorderId, align: c.align, fill };
		if (c.kind === 'swatch') {
			const first = Array.isArray(v) && v.length ? v[0].replace('#', '') : undefined;
			// The cell itself is the swatch; the codes stay readable on hover/edit.
			return strCell(ref, '', styles.get({ ...base, fill: first ?? fill, numFmt: 49 }));
		}
		if (v === null || v === undefined || v === '') return blankCell(ref, styles.get({ ...base, numFmt: 0 }));
		if (typeof v === 'number')
			return numCell(ref, v, styles.get({ ...base, numFmt: numberFormat(c, styles) }));
		if (v instanceof Date) return numCell(ref, excelDate(v), styles.get({ ...base, numFmt: dateFmt }));
		// Everything else, color codes included, is stored as text in a text-formatted cell.
		return strCell(ref, formatCell(v, c), styles.get({ ...base, numFmt: 49 }));
	}

	function summaryCells(line: ReportLine, rowNo: number): string[] {
		const firstAgg = cols.findIndex((c) => c.aggregate !== 'none');
		const span = firstAgg === -1 ? ncols : Math.max(firstAgg, 1);
		const border: BorderId = line.type === 'total' ? 3 : 2;
		const label = `${line.label ?? ''} (${itemCount(line.count ?? 0)})`;
		const cells = [strCell(`A${rowNo}`, label, styles.get({ font: 1, border, numFmt: 0 }))];
		for (let i = 1; i < span; i++)
			cells.push(blankCell(`${colName(i)}${rowNo}`, styles.get({ font: 1, border, numFmt: 0 })));
		if (span > 1) merges.push(`A${rowNo}:${colName(span - 1)}${rowNo}`);
		for (let i = span; i < cols.length; i++) {
			const c = cols[i];
			const v = line.cells[i];
			const style = styles.get({ font: 1, border, numFmt: numberFormat(c, styles, true), align: c.align });
			cells.push(
				typeof v === 'number' && c.aggregate !== 'none'
					? numCell(`${colName(i)}${rowNo}`, v, style)
					: blankCell(`${colName(i)}${rowNo}`, style)
			);
		}
		return cells;
	}

	// Column widths: proportional to the design's width hints, wide enough for the header.
	const colXml = cols
		.map((c, i) => {
			const w = Math.min(Math.max(c.width * 12, headerLabel(c).length + 2, c.kind === 'swatch' ? 6 : 6), 60);
			return `<col min="${i + 1}" max="${i + 1}" width="${w.toFixed(1)}" customWidth="1"/>`;
		})
		.join('');
	const lastRef = `${colName(ncols - 1)}${r}`;
	const grouped = design.groupBy.length > 0;
	const sheet =
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
		'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
		`<dimension ref="A1:${lastRef}"/>` +
		`<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
		'<sheetFormatPr defaultRowHeight="15"/>' +
		(colXml ? `<cols>${colXml}</cols>` : '') +
		`<sheetData>${rows.join('')}</sheetData>` +
		// A filter only makes sense on a plain table; group and total lines would break it.
		(!grouped && !design.showGrandTotal && cols.length
			? `<autoFilter ref="A${headerRow}:${colName(ncols - 1)}${r}"/>`
			: '') +
		(merges.length
			? `<mergeCells count="${merges.length}">${merges.map((x) => `<mergeCell ref="${x}"/>`).join('')}</mergeCells>`
			: '') +
		`<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>` +
		`<pageSetup orientation="${design.page.landscape ? 'landscape' : 'portrait'}" paperSize="${XLSX_PAPER[design.page.paper] ?? 1}" fitToWidth="1" fitToHeight="0"/>` +
		(design.footer.showPageNumbers || design.footer.text.trim()
			? `<headerFooter><oddFooter>${esc(`&L${design.footer.text.trim().replace(/&/g, '&&')}${design.footer.showPageNumbers ? `&R${m['reports.pageOf']({ page: '&P', pages: '&N' })}` : ''}`)}</oddFooter></headerFooter>`
			: '') +
		'</worksheet>';

	const sheetName = esc(
		reportTitle(design)
			.replace(/[\\/?*[\]:]/g, ' ')
			.slice(0, 31)
			.trim() || 'Report'
	);
	const files: Record<string, Uint8Array> = {
		'[Content_Types].xml': strToU8(
			'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
				'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
				'<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
				'<Default Extension="xml" ContentType="application/xml"/>' +
				'<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
				'<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
				'<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
				'</Types>'
		),
		'_rels/.rels': strToU8(
			'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
				'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
				'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
				'</Relationships>'
		),
		'xl/workbook.xml': strToU8(
			'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
				'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
				`<sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets>` +
				(r > headerRow
					? `<definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">'${sheetName.replace(/'/g, "''")}'!$${headerRow}:$${headerRow}</definedName></definedNames>`
					: '') +
				'</workbook>'
		),
		'xl/_rels/workbook.xml.rels': strToU8(
			'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
				'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
				'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
				'<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
				'</Relationships>'
		),
		'xl/worksheets/sheet1.xml': strToU8(sheet),
		'xl/styles.xml': strToU8(styles.xml(Math.min(Math.max(design.page.fontSize || 9, 6), 20)))
	};
	return zipSync(files, { level: 6 });
}

/** Excel's paperSize codes. */
const XLSX_PAPER: Record<string, number> = { letter: 1, tabloid: 3, legal: 5, a3: 8, a4: 9 };
