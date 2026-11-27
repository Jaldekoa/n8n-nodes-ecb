import type {
	ILoadOptionsFunctions,
	INodeListSearchResult,
	INodePropertyOptions,
} from 'n8n-workflow';
import { getCategories, getDataflows } from './helpers/structure';
import type { DimensionInfo, SdmxJsonMessage } from './helpers/sdmxJson';
import { extractDimensions } from './helpers/sdmxJson';
import { ecbJsonDataRequest } from './helpers/transport';

function getSelectedDataset(context: ILoadOptionsFunctions): string {
	const value = context.getCurrentNodeParameter('dataset', { extractValue: true });
	return typeof value === 'string' ? value.trim() : '';
}

/** Loads the dimensions of a dataset together with the codes that are actually used in it */
async function loadDatasetDimensions(context: ILoadOptionsFunctions): Promise<DimensionInfo[]> {
	const dataset = getSelectedDataset(context);
	if (!dataset) return [];
	const message = await ecbJsonDataRequest.call(context, `/data/${encodeURIComponent(dataset)}`, {
		detail: 'serieskeysonly',
	});
	return message ? extractDimensions(message as SdmxJsonMessage) : [];
}

export const listSearch = {
	async searchDatasets(
		this: ILoadOptionsFunctions,
		filter?: string,
	): Promise<INodeListSearchResult> {
		const category = (this.getCurrentNodeParameter('category') as string | undefined) ?? '';
		const dataflows = await getDataflows.call(this, { category: category || undefined });
		const search = (filter ?? '').toLowerCase();
		return {
			results: dataflows
				.filter(
					(dataflow) =>
						!search ||
						dataflow.id.toLowerCase().includes(search) ||
						dataflow.name.toLowerCase().includes(search),
				)
				.map((dataflow) => ({
					name: `${dataflow.id} - ${dataflow.name}`,
					value: dataflow.id,
					url: `https://data.ecb.europa.eu/data/datasets/${dataflow.id}`,
				})),
		};
	},
};

export const loadOptions = {
	async getCategories(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const categories = await getCategories.call(this);
		return [
			{ name: 'All Categories', value: '' },
			...categories.map((category) => ({
				name: category.name,
				value: category.id,
				description: category.description,
			})),
		];
	},

	async getDimensions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const dimensions = await loadDatasetDimensions(this);
		return dimensions.map((dimension) => ({
			name: `${dimension.name} (${dimension.id})`,
			value: dimension.id,
			description: `Position ${dimension.position} in the series key`,
		}));
	},

	async getDimensionValues(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const selected = this.getCurrentNodeParameter('&dimension') as string | undefined;
		if (!selected) return [];
		const dimensions = await loadDatasetDimensions(this);
		const dimension = dimensions.find((item) => item.id === selected);
		if (!dimension) return [];
		return dimension.values
			.map((value) => ({ name: `${value.id} - ${value.name}`, value: value.id }))
			.sort((a, b) => a.name.localeCompare(b.name));
	},
};
