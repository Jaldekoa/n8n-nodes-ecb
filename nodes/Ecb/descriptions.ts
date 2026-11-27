import type { INodeProperties } from 'n8n-workflow';

const DATASET_ID_REGEX = '^[A-Za-z0-9_.@$-]+(,[A-Za-z0-9_.@$-]+){0,2}$';

export const resourceProperty: INodeProperties = {
	displayName: 'Resource',
	name: 'resource',
	type: 'options',
	noDataExpression: true,
	options: [
		{
			name: 'Data',
			value: 'data',
			description: 'Statistical time series and observations',
		},
		{
			name: 'Dataset',
			value: 'dataset',
			description: 'Datasets (dataflows) available in the ECB Data Portal',
		},
		{
			name: 'Metadata',
			value: 'metadata',
			description: 'Structural metadata such as code lists, concepts or data structures',
		},
	],
	default: 'data',
};

export const operationProperties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['data'] } },
		options: [
			{
				name: 'Get',
				value: 'get',
				description: 'Get time series data from a dataset',
				action: 'Get data from a dataset',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['dataset'] } },
		options: [
			{
				name: 'Get Dimensions',
				value: 'getDimensions',
				description: 'Get the dimensions of a dataset and the codes available for each of them',
				action: 'Get the dimensions of a dataset',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'List the available datasets',
				action: 'Get many datasets',
			},
		],
		default: 'getAll',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['metadata'] } },
		options: [
			{
				name: 'Get',
				value: 'get',
				description: 'Get structural metadata artefacts',
				action: 'Get structural metadata',
			},
		],
		default: 'get',
	},
];

const categoryProperty: INodeProperties = {
	displayName: 'Category Name or ID',
	name: 'category',
	type: 'options',
	typeOptions: { loadOptionsMethod: 'getCategories' },
	default: '',
	description:
		'Data category as shown on the ECB Data Portal, used to narrow down the list of datasets. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
};

const datasetProperty: INodeProperties = {
	displayName: 'Dataset',
	name: 'dataset',
	type: 'resourceLocator',
	default: { mode: 'list', value: '' },
	required: true,
	description: 'The dataset (dataflow) to query, e.g. EXR for exchange rates',
	modes: [
		{
			displayName: 'From List',
			name: 'list',
			type: 'list',
			placeholder: 'Select a dataset...',
			typeOptions: { searchListMethod: 'searchDatasets', searchable: true },
		},
		{
			displayName: 'By ID',
			name: 'id',
			type: 'string',
			placeholder: 'e.g. EXR',
			validation: [
				{
					type: 'regex',
					properties: {
						regex: DATASET_ID_REGEX,
						errorMessage: 'Not a valid dataset ID (e.g. EXR or ECB,EXR,1.0)',
					},
				},
			],
		},
		{
			displayName: 'By URL',
			name: 'url',
			type: 'string',
			placeholder: 'e.g. https://data.ecb.europa.eu/data/datasets/EXR',
			extractValue: {
				type: 'regex',
				regex: 'https?://data\\.ecb\\.europa\\.eu/data/datasets/([^/?#]+)',
			},
			validation: [
				{
					type: 'regex',
					properties: {
						regex: 'https?://data\\.ecb\\.europa\\.eu/data/datasets/[^/?#]+.*',
						errorMessage: 'Not a valid ECB Data Portal dataset URL',
					},
				},
			],
		},
	],
};

// ---------------------------------------------------------------------------
// Data → Get
// ---------------------------------------------------------------------------

const showDataGet = { resource: ['data'], operation: ['get'] };

export const dataGetProperties: INodeProperties[] = [
	{ ...categoryProperty, displayOptions: { show: showDataGet } },
	{ ...datasetProperty, displayOptions: { show: showDataGet } },
	{
		displayName: 'Series Selection',
		name: 'keyMode',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: showDataGet },
		options: [
			{
				name: 'Dimension Filters',
				value: 'filters',
				description: 'Pick values for some dimensions. Dimensions without a filter match everything.',
			},
			{
				name: 'Series Key',
				value: 'seriesKey',
				description: 'Type the series key directly, e.g. D.USD+JPY.EUR.SP00.A',
			},
		],
		default: 'filters',
	},
	{
		displayName: 'Dimension Filters',
		name: 'dimensionFilters',
		type: 'fixedCollection',
		placeholder: 'Add Dimension Filter',
		typeOptions: { multipleValues: true },
		displayOptions: { show: { ...showDataGet, keyMode: ['filters'] } },
		default: {},
		description:
			'Filter the time series by dimension. Several values for the same dimension are combined with OR. With no filters, all series of the dataset are returned.',
		options: [
			{
				displayName: 'Filter',
				name: 'filter',
				values: [
					{
						displayName: 'Dimension Name or ID',
						name: 'dimension',
						type: 'options',
						typeOptions: {
							loadOptionsMethod: 'getDimensions',
							loadOptionsDependsOn: ['dataset.value'],
						},
						default: '',
						description:
							'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
					},
					{
						displayName: 'Value Names or IDs',
						name: 'values',
						type: 'multiOptions',
						typeOptions: {
							loadOptionsMethod: 'getDimensionValues',
							loadOptionsDependsOn: ['&dimension', 'dataset.value'],
						},
						default: [],
						description:
							'Codes to include for this dimension. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
					},
				],
			},
		],
	},
	{
		displayName: 'Series Key',
		name: 'seriesKey',
		type: 'string',
		displayOptions: { show: { ...showDataGet, keyMode: ['seriesKey'] } },
		default: '',
		placeholder: 'e.g. D.USD.EUR.SP00.A',
		description:
			'Dimension values joined by dots in the order defined by the dataset. Leave a position empty to match all values (D..EUR.SP00.A) and use + for OR (D.USD+JPY.EUR.SP00.A). Leave the whole key empty to get every series. A key copied from the portal that starts with the dataset ID (EXR.D.USD.EUR.SP00.A) is also accepted.',
	},
	{
		displayName: 'Output Format',
		name: 'format',
		type: 'options',
		displayOptions: { show: showDataGet },
		options: [
			{
				name: 'CSV File',
				value: 'csv',
				description: 'Comma-separated values, one row per observation, returned as a binary file',
			},
			{
				name: 'CSV File (Pivot-Friendly)',
				value: 'csvPivot',
				description: 'ECB CSV optimised for pivot tables, returned as a binary file',
			},
			{
				name: 'JSON',
				value: 'json',
				description: 'SDMX-JSON, returned as n8n items',
			},
			{
				name: 'SDMX-JSON File',
				value: 'jsonFile',
				description: 'The raw SDMX-JSON message, returned as a binary file',
			},
			{
				name: 'SDMX-ML Generic Data (XML) File',
				value: 'genericXml',
				description: 'SDMX-ML 2.1 Generic Data format, returned as a binary file',
			},
			{
				name: 'SDMX-ML Structure Specific Data (XML) File',
				value: 'structureSpecificXml',
				description: 'SDMX-ML 2.1 Structure Specific Data format, returned as a binary file',
			},
		],
		default: 'json',
	},
	{
		displayName: 'Simplify',
		name: 'simplify',
		type: 'boolean',
		displayOptions: { show: { ...showDataGet, format: ['json'] } },
		default: true,
		description:
			'Whether to return flat items with dimension and attribute codes instead of the raw SDMX-JSON message',
	},
	{
		displayName: 'Output Items',
		name: 'outputMode',
		type: 'options',
		displayOptions: { show: { ...showDataGet, format: ['json'], simplify: [true] } },
		options: [
			{
				name: 'One per Observation',
				value: 'observations',
				description: 'One item per date and series, similar to a CSV row',
			},
			{
				name: 'One per Series',
				value: 'series',
				description: 'One item per time series with its observations in an array',
			},
		],
		default: 'observations',
	},
	{
		displayName: 'Put Output File in Field',
		name: 'binaryPropertyName',
		type: 'string',
		displayOptions: { show: showDataGet, hide: { format: ['json'] } },
		default: 'data',
		required: true,
		hint: 'The name of the output binary field to put the file in',
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		displayOptions: { show: showDataGet },
		default: {},
		options: [
			{
				displayName: 'Detail',
				name: 'detail',
				type: 'options',
				options: [
					{
						name: 'Full',
						value: 'full',
						description: 'Series, observations and attributes',
					},
					{
						name: 'Data Only',
						value: 'dataonly',
						description: 'Series and observations without attributes',
					},
					{
						name: 'Series Keys Only',
						value: 'serieskeysonly',
						description: 'Only the matching series, without observations or attributes',
					},
					{
						name: 'No Data',
						value: 'nodata',
						description: 'Series and attributes without observations',
					},
				],
				default: 'full',
				description: 'Amount of information to return',
			},
			{
				displayName: 'End Period',
				name: 'endPeriod',
				type: 'string',
				default: '',
				placeholder: 'e.g. 2024-12',
				description:
					'Last period to return. Formats: YYYY, YYYY-S1, YYYY-Q1, YYYY-MM, YYYY-W01 or YYYY-MM-DD.',
			},
			{
				displayName: 'Error If No Data',
				name: 'failOnNoData',
				type: 'boolean',
				default: false,
				description:
					'Whether to fail when the query matches no data. When disabled, the node returns no items (useful with "Updated After").',
			},
			{
				displayName: 'File Name',
				name: 'fileName',
				type: 'string',
				default: '',
				placeholder: 'e.g. exchange-rates.csv',
				description: 'Name of the output file. Defaults to the dataset and series key.',
				displayOptions: { hide: { '/format': ['json'] } },
			},
			{
				displayName: 'First N Observations',
				name: 'firstNObservations',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 1,
				description: 'Maximum number of observations to return per series, counting from the first',
			},
			{
				displayName: 'Include History',
				name: 'includeHistory',
				type: 'boolean',
				default: false,
				description:
					'Whether to also return previous versions of the data, to see how it was released, revised or deleted over time',
			},
			{
				displayName: 'Include Labels',
				name: 'includeLabels',
				type: 'boolean',
				default: false,
				description:
					'Whether to add a <code>_LABEL</code> field with the human-readable name next to each code',
				displayOptions: { show: { '/format': ['json'], '/simplify': [true] } },
			},
			{
				displayName: 'Last N Observations',
				name: 'lastNObservations',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 1,
				description: 'Maximum number of observations to return per series, counting back from the most recent',
			},
			{
				displayName: 'Start Period',
				name: 'startPeriod',
				type: 'string',
				default: '',
				placeholder: 'e.g. 2020-01',
				description:
					'First period to return. Formats: YYYY, YYYY-S1, YYYY-Q1, YYYY-MM, YYYY-W01 or YYYY-MM-DD.',
			},
			{
				displayName: 'Updated After',
				name: 'updatedAfter',
				type: 'dateTime',
				default: '',
				description:
					'Only return observations added, revised or deleted after this moment. Useful to sync incremental changes.',
			},
		],
	},
];

// ---------------------------------------------------------------------------
// Dataset → Get Many / Get Dimensions
// ---------------------------------------------------------------------------

const showDatasetGetAll = { resource: ['dataset'], operation: ['getAll'] };
const showDatasetGetDimensions = { resource: ['dataset'], operation: ['getDimensions'] };

export const datasetProperties: INodeProperties[] = [
	{ ...categoryProperty, displayOptions: { show: showDatasetGetAll } },
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		displayOptions: { show: showDatasetGetAll },
		default: false,
		description: 'Whether to return all results or only up to a given limit',
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		displayOptions: { show: { ...showDatasetGetAll, returnAll: [false] } },
		typeOptions: { minValue: 1 },
		default: 50,
		description: 'Max number of results to return',
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		displayOptions: { show: showDatasetGetAll },
		default: {},
		options: [
			{
				displayName: 'Include Portal Views',
				name: 'includeHidden',
				type: 'boolean',
				default: false,
				description:
					'Whether to include the derived dataflows maintained by ECB.DISS for the portal pages (e.g. EXR_PUB)',
			},
			{
				displayName: 'Search',
				name: 'search',
				type: 'string',
				default: '',
				description: 'Only return datasets whose ID or name contains this text',
			},
		],
	},
	{ ...categoryProperty, displayOptions: { show: showDatasetGetDimensions } },
	{ ...datasetProperty, displayOptions: { show: showDatasetGetDimensions } },
];

// ---------------------------------------------------------------------------
// Metadata → Get
// ---------------------------------------------------------------------------

const showMetadataGet = { resource: ['metadata'], operation: ['get'] };

export const metadataProperties: INodeProperties[] = [
	{
		displayName: 'Artefact Type',
		name: 'artefactType',
		type: 'options',
		displayOptions: { show: showMetadataGet },
		options: [
			{ name: 'Agency Scheme', value: 'agencyscheme' },
			{ name: 'Categorisation', value: 'categorisation' },
			{ name: 'Category Scheme', value: 'categoryscheme' },
			{ name: 'Code List', value: 'codelist' },
			{ name: 'Concept Scheme', value: 'conceptscheme' },
			{ name: 'Content Constraint', value: 'contentconstraint' },
			{ name: 'Data Structure (DSD)', value: 'datastructure' },
			{ name: 'Dataflow', value: 'dataflow' },
			{ name: 'Hierarchical Code List', value: 'hierarchicalcodelist' },
			{ name: 'Structure (Any)', value: 'structure' },
		],
		default: 'codelist',
		description: 'Type of SDMX structural metadata to retrieve',
	},
	{
		displayName: 'Agency ID',
		name: 'agencyId',
		type: 'string',
		displayOptions: { show: showMetadataGet },
		default: 'ECB',
		description: 'Maintainer of the artefact (e.g. ECB, ECB.DISS, ESTAT, IMF). Use "all" for any agency.',
	},
	{
		displayName: 'Artefact ID',
		name: 'resourceId',
		type: 'string',
		displayOptions: { show: showMetadataGet },
		default: '',
		placeholder: 'e.g. CL_CURRENCY',
		description:
			'ID of the artefact, e.g. CL_CURRENCY (code list) or ECB_EXR1 (data structure). Leave empty to return all artefacts of this type.',
	},
	{
		displayName: 'Output Format',
		name: 'format',
		type: 'options',
		displayOptions: { show: showMetadataGet },
		options: [
			{
				name: 'JSON',
				value: 'json',
				description: 'One item per artefact, converted from SDMX-ML',
			},
			{
				name: 'SDMX-ML Structure (XML) File',
				value: 'xml',
				description: 'The raw SDMX-ML 2.1 structure message, returned as a binary file',
			},
		],
		default: 'json',
	},
	{
		displayName: 'Put Output File in Field',
		name: 'binaryPropertyName',
		type: 'string',
		displayOptions: { show: { ...showMetadataGet, format: ['xml'] } },
		default: 'data',
		required: true,
		hint: 'The name of the output binary field to put the file in',
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		displayOptions: { show: showMetadataGet },
		default: {},
		options: [
			{
				displayName: 'Detail',
				name: 'detail',
				type: 'options',
				options: [
					{ name: 'Full', value: 'full', description: 'All available information' },
					{
						name: 'All Stubs',
						value: 'allstubs',
						description: 'Only ID, agency, version and name of every artefact',
					},
					{
						name: 'Reference Stubs',
						value: 'referencestubs',
						description: 'Referenced artefacts are returned as stubs',
					},
				],
				default: 'full',
			},
			{
				displayName: 'File Name',
				name: 'fileName',
				type: 'string',
				default: '',
				placeholder: 'e.g. CL_CURRENCY.xml',
				displayOptions: { show: { '/format': ['xml'] } },
			},
			{
				displayName: 'References',
				name: 'references',
				type: 'options',
				options: [
					{ name: 'All', value: 'all', description: 'Parents, siblings and descendants' },
					{
						name: 'Children',
						value: 'children',
						description: 'Artefacts referenced by the match (e.g. code lists of a DSD)',
					},
					{ name: 'Code List', value: 'codelist' },
					{ name: 'Concept Scheme', value: 'conceptscheme' },
					{ name: 'Content Constraint', value: 'contentconstraint' },
					{ name: 'Data Structure', value: 'datastructure' },
					{ name: 'Dataflow', value: 'dataflow' },
					{
						name: 'Descendants',
						value: 'descendants',
						description: 'References of references, up to any level',
					},
					{ name: 'None', value: 'none' },
					{
						name: 'Parents',
						value: 'parents',
						description: 'Artefacts that use the match (e.g. dataflows using a DSD)',
					},
					{ name: 'Parents and Siblings', value: 'parentsandsiblings' },
				],
				default: 'none',
				description: 'Related artefacts to include in the response',
			},
			{
				displayName: 'Version',
				name: 'version',
				type: 'string',
				default: 'latest',
				description: 'Version of the artefact. Defaults to the latest one.',
			},
		],
	},
];
