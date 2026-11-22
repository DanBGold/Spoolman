import { getReportDesigns, saveReportDesigns } from '$lib/api/reportDesigns';
import { newReport, uid, type ReportDesign, type ReportEntity } from '$lib/reports/types';
import * as m from '$lib/paraglide/messages';

// Reactive, server-backed collection of report designs, mirroring labelDesigns:
// loaded once, every mutation persisted to the `report_designs` setting.

class ReportDesigns {
	designs = $state<ReportDesign[]>([]);
	loaded = $state(false);

	async load(): Promise<void> {
		if (this.loaded) return;
		try {
			this.designs = await getReportDesigns();
		} catch (e) {
			console.error('Failed to load report designs', e);
		} finally {
			this.loaded = true;
		}
	}

	private async persist(): Promise<void> {
		await saveReportDesigns($state.snapshot(this.designs) as ReportDesign[]);
	}

	async create(entity: ReportEntity = 'spool'): Promise<ReportDesign> {
		const design: ReportDesign = { ...newReport(uid(), entity), name: m['reports.newName']() };
		this.designs = [...this.designs, design];
		await this.persist();
		return design;
	}

	async save(design: ReportDesign): Promise<void> {
		const idx = this.designs.findIndex((d) => d.id === design.id);
		if (idx === -1) this.designs = [...this.designs, design];
		else this.designs = this.designs.map((d) => (d.id === design.id ? design : d));
		await this.persist();
	}

	async duplicate(id: string): Promise<ReportDesign | undefined> {
		const src = this.designs.find((d) => d.id === id);
		if (!src) return undefined;
		const copy: ReportDesign = {
			...structuredClone($state.snapshot(src) as ReportDesign),
			id: uid(),
			name: `${src.name} copy`
		};
		this.designs = [...this.designs, copy];
		await this.persist();
		return copy;
	}

	async remove(id: string): Promise<void> {
		this.designs = this.designs.filter((d) => d.id !== id);
		await this.persist();
	}
}

export const reportDesigns = new ReportDesigns();
