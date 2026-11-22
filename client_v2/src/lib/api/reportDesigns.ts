import { getJson } from './http';
import { setSetting, parseSetting, type SettingResponse } from './settings';
import { normalizeReport, type ReportDesign } from '$lib/reports/types';

// Report designs are stored as a JSON array in the `report_designs` server
// setting (registered in spoolman/settings.py), like label designs.

export async function getReportDesigns(): Promise<ReportDesign[]> {
	const s = await getJson<SettingResponse>('/setting/report_designs');
	return parseSetting<ReportDesign[]>(s, [])
		.filter((d) => d && typeof d.id === 'string')
		.map((d) => normalizeReport(d));
}

export async function saveReportDesigns(designs: ReportDesign[]): Promise<void> {
	await setSetting('report_designs', designs);
}
