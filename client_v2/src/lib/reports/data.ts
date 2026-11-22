import { getJson } from '$lib/api/http';
import { getFields } from '$lib/api/fields';
import type { ReportData } from './engine';
import type { ExtraDefs, RawFilament, RawSpool, RawVendor } from './fields';

// A report needs every row, so it fetches the whole inventory once (three plain
// list calls, archived spools included so the design can choose) rather than
// paging through the library's grouped queries.

export interface LoadedReportData {
	data: ReportData;
	extra: ExtraDefs;
	loadedAt: Date;
}

const byOrder = <T extends { order: number; key: string }>(list: T[]) =>
	[...list].sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));

export async function loadReportData(signal?: AbortSignal): Promise<LoadedReportData> {
	const [spools, filaments, vendors, spoolDefs, filamentDefs, vendorDefs] = await Promise.all([
		getJson<RawSpool[]>('/spool', { allow_archived: 'true' }, signal),
		getJson<RawFilament[]>('/filament', {}, signal),
		getJson<RawVendor[]>('/vendor', {}, signal),
		getFields('spool'),
		getFields('filament'),
		getFields('vendor')
	]);
	return {
		data: { spools, filaments, vendors },
		extra: { spool: byOrder(spoolDefs), filament: byOrder(filamentDefs), vendor: byOrder(vendorDefs) },
		loadedAt: new Date()
	};
}
