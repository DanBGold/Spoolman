import type { ReportDesign, PaperName } from './types';
import { formatCell, itemCount, type ReportLine, type ReportResult, type ResolvedColumn } from './engine';
import type { CellValue } from './fields';
import * as m from '$lib/paraglide/messages';

// Renders a report result as a complete, self-contained HTML document: real text
// and CSS-drawn color swatches, so printing (or "Save as PDF") stays sharp at any
// printer resolution. The same document is shown in the preview iframe.

export const PAPER_MM: Record<PaperName, [number, number]> = {
	letter: [215.9, 279.4],
	legal: [215.9, 355.6],
	tabloid: [279.4, 431.8],
	a4: [210, 297],
	a3: [297, 420]
};

export function escapeHtml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** A CSS string literal, for `content:` in page margin boxes. */
function cssString(s: string): string {
	return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;
}

/** "Page {{page}} of {{pages}}" as a CSS content value using page counters. */
function pageCounterContent(): string {
	const PAGE = '@@PAGE@@';
	const PAGES = '@@PAGES@@';
	const text = m['reports.pageOf']({ page: PAGE, pages: PAGES });
	return text
		.split(new RegExp(`(${PAGES}|${PAGE})`))
		.filter((p) => p !== '')
		.map((p) => (p === PAGE ? 'counter(page)' : p === PAGES ? 'counter(pages)' : cssString(p)))
		.join(' ');
}

export function reportTitle(design: ReportDesign): string {
	return design.header.title.trim() || design.name;
}

export function formatGenerated(d: Date): string {
	return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function swatchHtml(v: CellValue): string {
	if (!Array.isArray(v) || v.length === 0) return '';
	const parts = v.map((c) => `<i style="background:${escapeHtml(c)}"></i>`).join('');
	return `<span class="sw">${parts}</span>`;
}

function cellHtml(v: CellValue, col: ResolvedColumn): string {
	if (col.kind === 'swatch') return swatchHtml(v);
	const text = escapeHtml(formatCell(v, col));
	return col.kind === 'color' ? `<span class="hex">${text}</span>` : text;
}

function headerCells(columns: ResolvedColumn[]): string {
	return columns
		.map(
			(c) =>
				`<th class="a-${c.align}">${escapeHtml(c.field ? c.label : `${c.label} (${m['reports.missingField']()})`)}</th>`
		)
		.join('');
}

/** A subtotal/total value: counts are plain whole numbers, other summaries keep the column's format. */
export function formatSummary(v: CellValue, c: ResolvedColumn): string {
	if (c.aggregate === 'count') return formatCell(v, { kind: 'number', decimals: 0 });
	if (c.aggregate === 'none') return '';
	return formatCell(v, { kind: 'number', decimals: c.decimals, unit: c.unit });
}

/** Subtotal/total row: the label spans the leading columns that have no summary. */
function summaryRow(line: ReportLine, columns: ResolvedColumn[], cls: string): string {
	const firstAgg = columns.findIndex((c) => c.aggregate !== 'none');
	const span = firstAgg === -1 ? columns.length : Math.max(firstAgg, 1);
	const label = `${escapeHtml(line.label ?? '')} <span class="n">(${escapeHtml(itemCount(line.count ?? 0))})</span>`;
	let html = `<tr class="${cls} l${line.level}"><td colspan="${span}" class="lbl">${label}</td>`;
	for (let i = span; i < columns.length; i++) {
		const c = columns[i];
		html += `<td class="a-${c.align}">${c.aggregate === 'none' ? '' : escapeHtml(formatSummary(line.cells[i], c))}</td>`;
	}
	return html + '</tr>';
}

function tableHtml(
	lines: ReportLine[],
	columns: ResolvedColumn[],
	design: ReportDesign,
	rowHref?: (id: number) => string
): string {
	const totalWidth = columns.reduce((a, c) => a + c.width, 0) || 1;
	const cols = columns
		.map((c) => `<col style="width:${((c.width / totalWidth) * 100).toFixed(2)}%">`)
		.join('');
	let body = '';
	let stripe = 0;
	for (const line of lines) {
		switch (line.type) {
			case 'group':
				stripe = 0;
				body += `<tr class="grp l${line.level}"><td colspan="${columns.length}" style="padding-left:${6 + line.level * 14}px">${escapeHtml(line.label ?? '')} <span class="n">(${escapeHtml(itemCount(line.count ?? 0))})</span></td></tr>`;
				break;
			case 'row': {
				const classes = [design.page.stripes && stripe++ % 2 === 1 ? 'alt' : '', rowHref ? 'lnk' : '']
					.filter(Boolean)
					.join(' ');
				const href =
					rowHref && line.itemId !== undefined ? ` data-href="${escapeHtml(rowHref(line.itemId))}"` : '';
				body += `<tr${classes ? ` class="${classes}"` : ''}${href}>${columns.map((c, i) => `<td class="a-${c.align}">${cellHtml(line.cells[i], c)}</td>`).join('')}</tr>`;
				break;
			}
			case 'subtotal':
				body += summaryRow(line, columns, 'sub');
				break;
			case 'total':
				body += summaryRow(line, columns, 'tot');
				break;
		}
	}
	return `<table><colgroup>${cols}</colgroup><thead><tr>${headerCells(columns)}</tr></thead><tbody>${body}</tbody></table>`;
}

/** Split lines into one chunk per top-level group (for page-break-per-group). */
function chunkByTopGroup(lines: ReportLine[]): ReportLine[][] {
	const chunks: ReportLine[][] = [];
	for (const line of lines) {
		if ((line.type === 'group' && line.level === 0) || chunks.length === 0) chunks.push([]);
		chunks[chunks.length - 1].push(line);
	}
	return chunks;
}

export interface HtmlOptions {
	generatedAt: Date;
	/** Preview adds screen-only page framing around the printed content. */
	preview?: boolean;
	/** Preview only: link for a data row (shown as a clickable row with `data-href`). */
	rowHref?: (id: number) => string;
}

export function renderReportHtml(design: ReportDesign, result: ReportResult, opts: HtmlOptions): string {
	const { page, header, footer } = design;
	const [w, h] = PAPER_MM[page.paper] ?? PAPER_MM.letter;
	const [pw, ph] = page.landscape ? [h, w] : [w, h];
	const title = reportTitle(design);

	const meta: string[] = [];
	if (header.showDate) meta.push(m['reports.generatedOn']({ date: formatGenerated(opts.generatedAt) }));
	if (header.showCount) meta.push(itemCount(result.rowCount));

	const marginBoxes = [
		footer.text.trim() ? `@bottom-left { content: ${cssString(footer.text.trim())}; }` : '',
		footer.showPageNumbers ? `@bottom-right { content: ${pageCounterContent()}; }` : ''
	].join(' ');

	const chunks =
		design.pageBreakPerGroup && design.groupBy.length > 0 ? chunkByTopGroup(result.lines) : [result.lines];
	const tables = chunks
		.map(
			(c, i) =>
				`<div class="chunk${i > 0 ? ' brk' : ''}">${tableHtml(c, result.columns, design, opts.preview ? opts.rowHref : undefined)}</div>`
		)
		.join('');

	const fs = Math.min(Math.max(page.fontSize || 9, 5), 24);
	const css = `
@page { size: ${pw}mm ${ph}mm; margin: ${page.margin}mm ${page.margin}mm ${page.margin + 6}mm; ${marginBoxes} }
@page { @bottom-left { font: ${fs * 0.85}pt Arial, Helvetica, sans-serif; color: #666; } @bottom-right { font: ${fs * 0.85}pt Arial, Helvetica, sans-serif; color: #666; } }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { margin: 0; background: #fff; color: #111; }
body { font: ${fs}pt Arial, Helvetica, sans-serif; }
h1 { font-size: ${fs * 1.8}pt; margin: 0 0 2pt; }
.sub-title { font-size: ${fs * 1.15}pt; color: #333; margin: 0 0 2pt; }
.meta { font-size: ${fs * 0.9}pt; color: #666; margin: 0 0 8pt; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
th { text-align: left; font-weight: 700; background: #e9ecef; border-bottom: 1.2pt solid #333; padding: 3pt 4pt; overflow-wrap: anywhere; }
td { padding: 2.2pt 4pt; border-bottom: 0.4pt solid #ddd; vertical-align: middle; overflow-wrap: anywhere; }
tr.alt td { background: #f5f6f7; }
.a-left { text-align: left; } .a-center { text-align: center; } .a-right { text-align: right; }
tr.grp td { font-weight: 700; background: #dfe6ee; border-bottom: 0.8pt solid #9aa7b4; padding-top: 4pt; }
tr.grp.l1 td { background: #ebf0f5; } tr.grp.l2 td { background: #f3f6f9; }
tr.grp { break-after: avoid; }
tr.sub td { font-weight: 700; border-top: 0.8pt solid #888; border-bottom: 1pt solid #bbb; background: #fafafa; }
tr.tot td { font-weight: 700; border-top: 1.6pt double #333; border-bottom: none; padding-top: 4pt; }
.lbl { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.n { font-weight: 400; color: #555; }
.hex { font-family: Consolas, 'Courier New', monospace; }
.sw { display: inline-flex; width: 2.6em; height: 1.1em; border: 0.6pt solid #555; vertical-align: middle; }
.sw i { flex: 1; display: block; }
.brk { break-before: page; }
${
	opts.preview
		? `@media screen {
  html { background: #8a8f96; }
  tr.lnk { cursor: pointer; }
  tr.lnk:hover td { background: #fff4d6; }
  body { width: ${pw}mm; min-height: ${ph}mm; margin: 16px auto; padding: ${page.margin}mm; background: #fff; box-shadow: 0 2px 12px rgba(0,0,0,.35); }
}`
		: ''
}`;

	return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${css}</style></head><body>
<h1>${escapeHtml(title)}</h1>
${header.subtitle.trim() ? `<div class="sub-title">${escapeHtml(header.subtitle.trim())}</div>` : ''}
${meta.length ? `<div class="meta">${escapeHtml(meta.join(' · '))}</div>` : ''}
${tables}
</body></html>`;
}

/** Print an HTML document through a hidden iframe (the browser's dialog also offers "Save as PDF"). */
export function printHtml(html: string): Promise<void> {
	return new Promise((resolve) => {
		const frame = document.createElement('iframe');
		frame.setAttribute('aria-hidden', 'true');
		frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
		document.body.appendChild(frame);
		const done = () => {
			setTimeout(() => frame.remove(), 1000);
			resolve();
		};
		frame.onload = () => {
			const win = frame.contentWindow;
			if (!win) return done();
			win.addEventListener('afterprint', done, { once: true });
			win.focus();
			win.print();
			// Browsers without afterprint (or that print synchronously) still clean up.
			setTimeout(done, 60000);
		};
		frame.srcdoc = html;
	});
}
