<script lang="ts">
	// A <select> over the report field catalog, grouped Spool / Filament /
	// Manufacturer / Totals the same way the label designer groups its fields.
	import { FIELD_GROUP_LABELS, type FieldGroup, type ReportField } from '$lib/reports/fields';
	import * as m from '$lib/paraglide/messages';

	interface Props {
		fields: ReportField[];
		value: string;
		onchange: (key: string) => void;
		ariaLabel: string;
		/** Text for an empty first option (e.g. "No grouping"); omit to require a field. */
		emptyLabel?: string;
		/** Hide field kinds that make no sense here (swatches can't be grouped or sorted). */
		exclude?: (f: ReportField) => boolean;
	}

	let { fields, value, onchange, ariaLabel, emptyLabel, exclude }: Props = $props();

	const ORDER: FieldGroup[] = ['spool', 'filament', 'vendor', 'totals'];
	const groups = $derived(
		ORDER.map((g) => ({ g, items: fields.filter((f) => f.group === g && !exclude?.(f)) })).filter(
			(x) => x.items.length > 0
		)
	);
	const known = $derived(value === '' || fields.some((f) => f.key === value));
</script>

<select aria-label={ariaLabel} {value} onchange={(e) => onchange(e.currentTarget.value)}>
	{#if emptyLabel !== undefined}
		<option value="">{emptyLabel}</option>
	{/if}
	{#if !known}
		<option {value}>{m['reports.missingField']()} ({value})</option>
	{/if}
	{#each groups as grp (grp.g)}
		<optgroup label={FIELD_GROUP_LABELS[grp.g]()}>
			{#each grp.items as f (f.key)}
				<option value={f.key}>{f.label()}</option>
			{/each}
		</optgroup>
	{/each}
</select>
