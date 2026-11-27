import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import {
	dataGetProperties,
	datasetProperties,
	metadataProperties,
	operationProperties,
	resourceProperty,
} from './descriptions';
import { listSearch, loadOptions } from './methods';
import type { Dimension } from './helpers/structure';
import {
	getCategories,
	getDataflows,
	getDimensionOrder,
	simplifyStructureMessage,
} from './helpers/structure';
import type { SdmxJsonMessage } from './helpers/sdmxJson';
import { extractDimensions, simplifySdmxJson } from './helpers/sdmxJson';
import { ecbJsonDataRequest, ecbRequest, MIME_TYPES } from './helpers/transport';

type DataFormat =
	| 'json'
	| 'jsonFile'
	| 'csv'
	| 'csvPivot'
	| 'genericXml'
	| 'structureSpecificXml';

const DATA_FORMATS: Record<Exclude<DataFormat, 'json'>, { mimeType: string; extension: string }> = {
	jsonFile: { mimeType: MIME_TYPES.sdmxJson, extension: 'json' },
	csv: { mimeType: MIME_TYPES.csv, extension: 'csv' },
	csvPivot: { mimeType: MIME_TYPES.csvPivot, extension: 'csv' },
	genericXml: { mimeType: MIME_TYPES.genericXml, extension: 'xml' },
	structureSpecificXml: { mimeType: MIME_TYPES.structureSpecificXml, extension: 'xml' },
};

interface DimensionFilter {
	dimension?: string;
	values?: string[] | string;
}

function sanitizeFileName(value: string): string {
	return value.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_');
}

/** Splits a flowRef (ID, AGENCY,ID or AGENCY,ID,VERSION) into its parts */
function parseFlowRef(flowRef: string): { agency: string; id: string; version: string } {
	const parts = flowRef.split(',').map((part) => part.trim());
	if (parts.length === 1) return { agency: 'all', id: parts[0], version: 'latest' };
	return { agency: parts[0] || 'all', id: parts[1], version: parts[2] || 'latest' };
}

export class Ecb implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'ECB Data Portal',
		name: 'ecb',
		icon: { light: 'file:icons/ecb.svg', dark: 'file:icons/ecb.svg' },
		group: ['input'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Get statistical data from the European Central Bank (ECB) Data Portal',
		defaults: {
			name: 'ECB Data Portal',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		properties: [
			resourceProperty,
			...operationProperties,
			...dataGetProperties,
			...datasetProperties,
			...metadataProperties,
		],
	};

	methods = { listSearch, loadOptions };

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const dimensionCache = new Map<string, Dimension[]>();

		const getDimensions = async (flowRef: string, itemIndex: number): Promise<Dimension[]> => {
			const cached = dimensionCache.get(flowRef);
			if (cached) return cached;
			const dimensions = await getDimensionOrder.call(this, parseFlowRef(flowRef), itemIndex);
			dimensionCache.set(flowRef, dimensions);
			return dimensions;
		};

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const resource = this.getNodeParameter('resource', itemIndex) as string;
				const operation = this.getNodeParameter('operation', itemIndex) as string;
				let results: INodeExecutionData[];

				if (resource === 'data' && operation === 'get') {
					results = await getData.call(this, itemIndex, getDimensions);
				} else if (resource === 'dataset' && operation === 'getAll') {
					results = await getManyDatasets.call(this, itemIndex);
				} else if (resource === 'dataset' && operation === 'getDimensions') {
					results = await getDatasetDimensions.call(this, itemIndex);
				} else if (resource === 'metadata' && operation === 'get') {
					results = await getMetadata.call(this, itemIndex);
				} else {
					throw new NodeOperationError(
						this.getNode(),
						`The operation "${operation}" is not supported for resource "${resource}"`,
						{ itemIndex },
					);
				}

				for (const result of results) {
					returnData.push({ ...result, pairedItem: { item: itemIndex } });
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: itemIndex },
					});
					continue;
				}
				if (error instanceof NodeApiError) {
					throw new NodeApiError(this.getNode(), error as unknown as JsonObject, { itemIndex });
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex });
			}
		}

		return [returnData];
	}
}

async function buildSeriesKey(
	this: IExecuteFunctions,
	itemIndex: number,
	flowRef: string,
	getDimensions: (flowRef: string, itemIndex: number) => Promise<Dimension[]>,
): Promise<string> {
	const keyMode = this.getNodeParameter('keyMode', itemIndex) as string;

	if (keyMode === 'seriesKey') {
		let key = (this.getNodeParameter('seriesKey', itemIndex, '') as string).trim();
		const { id } = parseFlowRef(flowRef);
		// Keys copied from the portal are prefixed with the dataset ID (e.g. EXR.D.USD.EUR.SP00.A)
		if (key.toUpperCase().startsWith(`${id.toUpperCase()}.`)) key = key.slice(id.length + 1);
		if (/\s/.test(key)) {
			throw new NodeOperationError(this.getNode(), 'The series key must not contain spaces', {
				itemIndex,
			});
		}
		return key;
	}

	const filters = (
		this.getNodeParameter('dimensionFilters.filter', itemIndex, []) as DimensionFilter[]
	).filter((filter) => filter.dimension);
	if (filters.length === 0) return '';

	const dimensions = await getDimensions(flowRef, itemIndex);
	if (dimensions.length === 0) {
		throw new NodeOperationError(
			this.getNode(),
			`Could not load the dimensions of dataset "${flowRef}"`,
			{ itemIndex, description: 'Use "Series Key" mode to type the key manually.' },
		);
	}

	const selected = new Map<string, string[]>();
	for (const filter of filters) {
		const dimension = (filter.dimension as string).trim().toUpperCase();
		if (!dimensions.some((item) => item.id === dimension)) {
			throw new NodeOperationError(
				this.getNode(),
				`Dataset "${flowRef}" has no dimension "${filter.dimension}"`,
				{
					itemIndex,
					description: `Available dimensions: ${dimensions.map((item) => item.id).join(', ')}`,
				},
			);
		}
		const rawValues = Array.isArray(filter.values)
			? filter.values
			: String(filter.values ?? '').split(/[+,]/);
		const values = rawValues.map((value) => String(value).trim()).filter(Boolean);
		selected.set(dimension, [...(selected.get(dimension) ?? []), ...values]);
	}

	return dimensions.map((dimension) => (selected.get(dimension.id) ?? []).join('+')).join('.');
}

async function getData(
	this: IExecuteFunctions,
	itemIndex: number,
	getDimensions: (flowRef: string, itemIndex: number) => Promise<Dimension[]>,
): Promise<INodeExecutionData[]> {
	const flowRef = (
		this.getNodeParameter('dataset', itemIndex, '', { extractValue: true }) as string
	).trim();
	if (!flowRef) {
		throw new NodeOperationError(this.getNode(), 'Please select a dataset', { itemIndex });
	}

	const key = await buildSeriesKey.call(this, itemIndex, flowRef, getDimensions);
	const format = this.getNodeParameter('format', itemIndex) as DataFormat;
	const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

	const qs: IDataObject = {};
	for (const name of ['startPeriod', 'endPeriod', 'firstNObservations', 'lastNObservations']) {
		if (options[name] !== undefined && options[name] !== '') qs[name] = options[name];
	}
	if (options.detail && options.detail !== 'full') qs.detail = options.detail;
	if (options.includeHistory) qs.includeHistory = true;
	if (options.updatedAfter) {
		const date = new Date(options.updatedAfter as string);
		if (Number.isNaN(date.getTime())) {
			throw new NodeOperationError(this.getNode(), '"Updated After" is not a valid date', {
				itemIndex,
			});
		}
		// The API rejects fractional seconds
		qs.updatedAfter = date.toISOString().replace(/\.\d{3}Z$/, 'Z');
	}

	const path = `/data/${encodeURIComponent(flowRef).replace(/%2C/gi, ',')}${
		key ? `/${encodeURIComponent(key).replace(/%2B/gi, '+')}` : ''
	}`;
	const accept = format === 'json' ? MIME_TYPES.sdmxJson : DATA_FORMATS[format].mimeType;

	const response = await ecbRequest.call(this, path, {
		accept,
		qs,
		itemIndex,
		allowedStatusCodes: [404],
	});

	if (response.statusCode === 404) {
		if (options.failOnNoData) {
			throw new NodeApiError(
				this.getNode(),
				{ message: 'No data found', httpCode: '404' },
				{
					message: 'No data found for this query',
					description: `Dataset: ${flowRef}, series key: ${key || '(all)'}`,
					httpCode: '404',
					itemIndex,
				},
			);
		}
		return [];
	}

	if (format === 'json') {
		const message = JSON.parse(response.body.toString('utf8')) as SdmxJsonMessage;
		const simplify = this.getNodeParameter('simplify', itemIndex, true) as boolean;
		if (!simplify) return [{ json: message as unknown as IDataObject }];

		const outputMode = this.getNodeParameter('outputMode', itemIndex, 'observations') as
			| 'observations'
			| 'series';
		return simplifySdmxJson(message, {
			dataflowId: parseFlowRef(flowRef).id,
			outputMode,
			includeLabels: Boolean(options.includeLabels),
			includeHistory: Boolean(options.includeHistory),
		}).map((json) => ({ json }));
	}

	const { extension, mimeType } = DATA_FORMATS[format];
	const binaryPropertyName = this.getNodeParameter('binaryPropertyName', itemIndex) as string;
	const fileName =
		(options.fileName as string | undefined) ||
		`${sanitizeFileName(`${parseFlowRef(flowRef).id}${key ? `.${key}` : ''}`)}.${extension}`;
	const binaryData = await this.helpers.prepareBinaryData(
		response.body,
		fileName,
		response.contentType || mimeType,
	);

	return [
		{
			json: { dataset: flowRef, seriesKey: key, format, query: qs },
			binary: { [binaryPropertyName]: binaryData },
		},
	];
}

async function getManyDatasets(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const category = this.getNodeParameter('category', itemIndex, '') as string;
	const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
	const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

	const [dataflows, categories] = await Promise.all([
		getDataflows.call(this, {
			category: category || undefined,
			includeHidden: Boolean(options.includeHidden),
		}),
		getCategories.call(this),
	]);
	const categoryNames = new Map(categories.map((item) => [item.id, item.name]));

	const search = String(options.search ?? '').toLowerCase();
	let result = dataflows.filter(
		(dataflow) =>
			!search ||
			dataflow.id.toLowerCase().includes(search) ||
			dataflow.name.toLowerCase().includes(search),
	);
	if (!returnAll) {
		const limit = this.getNodeParameter('limit', itemIndex, 50) as number;
		result = result.slice(0, limit);
	}

	return result.map((dataflow) => ({
		json: {
			id: dataflow.id,
			agencyId: dataflow.agencyId,
			version: dataflow.version,
			name: dataflow.name,
			description: dataflow.description ?? null,
			structure: dataflow.structure ?? null,
			categories: dataflow.categories.map((id) => ({ id, name: categoryNames.get(id) ?? id })),
			url: `https://data.ecb.europa.eu/data/datasets/${dataflow.id}`,
		},
	}));
}

async function getDatasetDimensions(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const flowRef = (
		this.getNodeParameter('dataset', itemIndex, '', { extractValue: true }) as string
	).trim();
	if (!flowRef) {
		throw new NodeOperationError(this.getNode(), 'Please select a dataset', { itemIndex });
	}
	const message = await ecbJsonDataRequest.call(
		this,
		`/data/${encodeURIComponent(flowRef).replace(/%2C/gi, ',')}`,
		{ detail: 'serieskeysonly' },
		itemIndex,
	);
	if (!message) {
		throw new NodeOperationError(this.getNode(), `Dataset "${flowRef}" returned no series`, {
			itemIndex,
		});
	}
	return extractDimensions(message as SdmxJsonMessage).map((dimension) => ({
		json: { dataset: parseFlowRef(flowRef).id, ...dimension },
	}));
}

async function getMetadata(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const artefactType = this.getNodeParameter('artefactType', itemIndex) as string;
	const agencyId = (this.getNodeParameter('agencyId', itemIndex, '') as string).trim() || 'all';
	const resourceId = (this.getNodeParameter('resourceId', itemIndex, '') as string).trim() || 'all';
	const format = this.getNodeParameter('format', itemIndex) as 'json' | 'xml';
	const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
	const version = String(options.version ?? '').trim() || 'latest';

	const qs: IDataObject = {};
	if (options.detail && options.detail !== 'full') qs.detail = options.detail;
	if (options.references && options.references !== 'none') qs.references = options.references;

	const path = [artefactType, agencyId, resourceId, version]
		.map((part) => encodeURIComponent(part))
		.join('/');
	const response = await ecbRequest.call(this, `/${path}`, {
		accept: MIME_TYPES.structureXml,
		qs,
		itemIndex,
	});

	if (format === 'json') {
		return simplifyStructureMessage(response.body.toString('utf8')).map((json) => ({ json }));
	}

	const binaryPropertyName = this.getNodeParameter('binaryPropertyName', itemIndex) as string;
	const fileName =
		(options.fileName as string | undefined) ||
		`${sanitizeFileName(`${artefactType}_${agencyId}_${resourceId}`)}.xml`;
	const binaryData = await this.helpers.prepareBinaryData(
		response.body,
		fileName,
		'application/xml',
	);
	return [
		{
			json: { artefactType, agencyId, resourceId, version, query: qs },
			binary: { [binaryPropertyName]: binaryData },
		},
	];
}
