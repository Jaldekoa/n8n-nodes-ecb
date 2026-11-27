import type { IDataObject } from 'n8n-workflow';

/** Subset of the SDMX-JSON 1.0 data message used by the ECB API */
interface SdmxValue {
	id?: string;
	name?: string;
}

interface SdmxComponent {
	id: string;
	name?: string;
	keyPosition?: number;
	role?: string;
	values: SdmxValue[];
}

interface SdmxComponentGroups {
	dataSet?: SdmxComponent[];
	series?: SdmxComponent[];
	observation?: SdmxComponent[];
}

interface SdmxSeries {
	attributes?: Array<number | null>;
	observations?: Record<string, Array<number | string | null>>;
}

interface SdmxDataSet {
	action?: string;
	validFrom?: string;
	attributes?: Array<number | null>;
	series?: Record<string, SdmxSeries>;
	observations?: Record<string, Array<number | string | null>>;
}

export interface SdmxJsonMessage {
	dataSets?: SdmxDataSet[];
	structure?: {
		name?: string;
		dimensions?: SdmxComponentGroups;
		attributes?: SdmxComponentGroups;
	};
}

export interface SimplifyOptions {
	dataflowId: string;
	outputMode: 'observations' | 'series';
	includeLabels: boolean;
	includeHistory: boolean;
}

export interface DimensionInfo {
	id: string;
	name: string;
	position: number;
	values: Array<{ id: string; name: string }>;
}

function setComponent(
	target: IDataObject,
	component: SdmxComponent,
	index: number | null | undefined,
	includeLabels: boolean,
) {
	const value = index === null || index === undefined ? undefined : component.values[index];
	target[component.id] = value ? (value.id ?? value.name ?? null) : null;
	if (includeLabels) target[`${component.id}_LABEL`] = value?.name ?? null;
}

function setAttributes(
	target: IDataObject,
	components: SdmxComponent[],
	indexes: Array<number | null> | undefined,
	includeLabels: boolean,
) {
	components.forEach((component, position) => {
		setComponent(target, component, indexes?.[position], includeLabels);
	});
}

function sortByKeyPosition(components: SdmxComponent[]): SdmxComponent[] {
	return [...components].sort((a, b) => (a.keyPosition ?? 0) - (b.keyPosition ?? 0));
}

/**
 * Turns an SDMX-JSON message into flat, n8n-friendly items, either one per observation
 * (similar to the CSV output) or one per time series with a nested `observations` array.
 */
export function simplifySdmxJson(message: SdmxJsonMessage, options: SimplifyOptions): IDataObject[] {
	const { includeLabels } = options;
	const dimensions = message.structure?.dimensions ?? {};
	const attributes = message.structure?.attributes ?? {};

	const dataSetDimensions = dimensions.dataSet ?? [];
	const seriesDimensions = dimensions.series ?? [];
	const observationDimensions = dimensions.observation ?? [];
	const positioned = [...dataSetDimensions, ...seriesDimensions, ...observationDimensions].filter(
		(dimension) => dimension.keyPosition !== undefined,
	);
	// The ECB API does not always send keyPosition: series dimensions are then already in key order
	const keyDimensions =
		positioned.length > 0
			? sortByKeyPosition(positioned)
			: [...dataSetDimensions, ...seriesDimensions];

	const result: IDataObject[] = [];

	const buildSeriesKey = (codes: IDataObject) =>
		keyDimensions.map((dimension) => String(codes[dimension.id] ?? '')).join('.');

	for (const dataSet of message.dataSets ?? []) {
		const base: IDataObject = { DATASET: options.dataflowId };
		if (options.includeHistory) {
			base.DATASET_ACTION = dataSet.action ?? null;
			base.VALID_FROM = dataSet.validFrom ?? null;
		}
		const codes: IDataObject = {};
		for (const dimension of dataSetDimensions) setComponent(codes, dimension, 0, false);
		const dataSetFields: IDataObject = {};
		for (const dimension of dataSetDimensions) {
			setComponent(dataSetFields, dimension, 0, includeLabels);
		}
		setAttributes(dataSetFields, attributes.dataSet ?? [], dataSet.attributes, includeLabels);

		const buildObservation = (
			observation: Array<number | string | null>,
			indexes: number[],
			dimensionList: SdmxComponent[],
		): IDataObject => {
			const item: IDataObject = {};
			dimensionList.forEach((dimension, position) =>
				setComponent(
					item,
					dimension,
					indexes[position],
					includeLabels && !observationDimensions.includes(dimension),
				),
			);
			item.OBS_VALUE = observation[0] ?? null;
			(attributes.observation ?? []).forEach((attribute, position) => {
				const index = observation[position + 1];
				setComponent(item, attribute, typeof index === 'number' ? index : null, includeLabels);
			});
			return item;
		};

		if (dataSet.series) {
			for (const [seriesIndex, series] of Object.entries(dataSet.series)) {
				const indexes = seriesIndex.split(':').map(Number);
				const seriesFields: IDataObject = {};
				const seriesCodes: IDataObject = { ...codes };
				seriesDimensions.forEach((dimension, position) => {
					setComponent(seriesFields, dimension, indexes[position], includeLabels);
					setComponent(seriesCodes, dimension, indexes[position], false);
				});
				const seriesHeader: IDataObject = {
					...base,
					SERIES_KEY: buildSeriesKey(seriesCodes),
					...dataSetFields,
					...seriesFields,
				};
				const seriesAttributes: IDataObject = {};
				setAttributes(seriesAttributes, attributes.series ?? [], series.attributes, includeLabels);

				const observations = Object.entries(series.observations ?? {}).map(
					([observationIndex, observation]) =>
						buildObservation(
							observation,
							observationIndex.split(':').map(Number),
							observationDimensions,
						),
				);

				if (options.outputMode === 'series' || observations.length === 0) {
					const item: IDataObject = { ...seriesHeader, ...seriesAttributes };
					if (options.outputMode === 'series') item.observations = observations;
					result.push(item);
				} else {
					for (const observation of observations) {
						result.push({ ...seriesHeader, ...observation, ...seriesAttributes });
					}
				}
			}
		} else if (dataSet.observations) {
			// Flat representation (dimensionAtObservation=AllDimensions)
			const allDimensions = [...seriesDimensions, ...observationDimensions];
			for (const [observationIndex, observation] of Object.entries(dataSet.observations)) {
				const indexes = observationIndex.split(':').map(Number);
				const item = buildObservation(observation, indexes, allDimensions);
				const itemCodes: IDataObject = { ...codes };
				allDimensions.forEach((dimension, position) =>
					setComponent(itemCodes, dimension, indexes[position], false),
				);
				result.push({ ...base, SERIES_KEY: buildSeriesKey(itemCodes), ...dataSetFields, ...item });
			}
		}
	}

	return result;
}

/** Extracts the series dimensions and the codes actually used in a dataset */
export function extractDimensions(message: SdmxJsonMessage): DimensionInfo[] {
	const dimensions = message.structure?.dimensions ?? {};
	const all = [...(dimensions.dataSet ?? []), ...(dimensions.series ?? [])];
	return sortByKeyPosition(all).map((dimension, index) => ({
		id: dimension.id,
		name: dimension.name ?? dimension.id,
		position: (dimension.keyPosition ?? index) + 1,
		values: dimension.values
			.filter((value) => value.id !== undefined)
			.map((value) => ({ id: value.id as string, name: value.name ?? (value.id as string) })),
	}));
}
