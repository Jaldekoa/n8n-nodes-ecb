import type { IDataObject } from 'n8n-workflow';
import type { XmlNode } from './xml';
import { childByName, childrenByName, findAll, localisedText, parseXml } from './xml';
import type { EcbContext } from './transport';
import { ecbStructureRequest } from './transport';

/** Category scheme used by the ECB Data Portal website ("Data categories" page) */
export const CATEGORY_SCHEME = { agency: 'ECB.DISS', id: 'WDC_NAVI' };

/** Agencies whose dataflows are internal derived views for the portal and not useful to list */
const HIDDEN_AGENCIES = ['ECB.DISS'];

export interface Dataflow {
	id: string;
	agencyId: string;
	version: string;
	name: string;
	description?: string;
	structure?: string;
	categories: string[];
}

export interface Category {
	id: string;
	name: string;
	description?: string;
}

export interface Dimension {
	id: string;
	position: number;
}

function getRef(node: XmlNode | undefined): Record<string, string> | undefined {
	if (!node) return undefined;
	const ref = childByName(node, 'Ref');
	if (ref) return ref.attributes;
	const urn = childByName(node, 'URN');
	return urn ? { urn: urn.text.trim() } : undefined;
}

function refToString(ref: Record<string, string> | undefined): string | undefined {
	if (!ref) return undefined;
	if (ref.urn) return ref.urn;
	return `${ref.agencyID ?? ''}:${ref.id ?? ''}(${ref.version ?? ''})`;
}

export async function getCategories(this: EcbContext): Promise<Category[]> {
	const xml = await ecbStructureRequest.call(
		this,
		`/categoryscheme/${CATEGORY_SCHEME.agency}/${CATEGORY_SCHEME.id}/latest`,
	);
	const scheme = findAll(parseXml(xml), 'CategoryScheme')[0];
	if (!scheme) return [];
	return childrenByName(scheme, 'Category').map((category) => ({
		id: category.attributes.id,
		name: localisedText(category, 'Name') ?? category.attributes.id,
		description: localisedText(category, 'Description'),
	}));
}

/** Returns a map of dataflow id → ids of the website categories it belongs to */
async function getCategorisations(this: EcbContext): Promise<Map<string, string[]>> {
	const xml = await ecbStructureRequest.call(this, '/categorisation');
	const result = new Map<string, string[]>();
	for (const categorisation of findAll(parseXml(xml), 'Categorisation')) {
		const source = getRef(childByName(categorisation, 'Source'));
		const target = getRef(childByName(categorisation, 'Target'));
		if (!source?.id || !target?.id) continue;
		if (target.maintainableParentID !== CATEGORY_SCHEME.id) continue;
		const topLevel = target.id.split('.')[0];
		const list = result.get(source.id) ?? [];
		if (!list.includes(topLevel)) list.push(topLevel);
		result.set(source.id, list);
	}
	return result;
}

export async function getDataflows(
	this: EcbContext,
	options: { category?: string; includeHidden?: boolean } = {},
): Promise<Dataflow[]> {
	const [xml, categorisations] = await Promise.all([
		ecbStructureRequest.call(this, '/dataflow', { detail: 'allstubs' }),
		getCategorisations.call(this),
	]);

	const dataflows = findAll(parseXml(xml), 'Dataflow')
		.map<Dataflow>((node) => ({
			id: node.attributes.id,
			agencyId: node.attributes.agencyID,
			version: node.attributes.version,
			name: localisedText(node, 'Name') ?? node.attributes.id,
			description: localisedText(node, 'Description'),
			structure: refToString(getRef(childByName(node, 'Structure'))),
			categories: categorisations.get(node.attributes.id) ?? [],
		}))
		.filter((dataflow) => options.includeHidden || !HIDDEN_AGENCIES.includes(dataflow.agencyId));

	const filtered = options.category
		? dataflows.filter((dataflow) => dataflow.categories.includes(options.category as string))
		: dataflows;

	return filtered.sort((a, b) => a.id.localeCompare(b.id));
}

/** Returns the dimensions of a dataflow's DSD in key order (time dimension excluded) */
export async function getDimensionOrder(
	this: EcbContext,
	dataflow: { agency: string; id: string; version: string },
	itemIndex?: number,
): Promise<Dimension[]> {
	const path = [dataflow.agency, dataflow.id, dataflow.version].map(encodeURIComponent).join('/');
	const xml = await ecbStructureRequest.call(
		this,
		`/dataflow/${path}`,
		{ references: 'datastructure' },
		itemIndex,
	);
	const structure = findAll(parseXml(xml), 'DataStructure')[0];
	if (!structure) return [];
	const dimensionList = findAll(structure, 'DimensionList')[0];
	if (!dimensionList) return [];
	return childrenByName(dimensionList, 'Dimension')
		.map((dimension, index) => ({
			id: dimension.attributes.id,
			position: Number(dimension.attributes.position ?? index + 1),
		}))
		.sort((a, b) => a.position - b.position);
}

// ---------------------------------------------------------------------------
// Generic simplification of SDMX-ML structure messages
// ---------------------------------------------------------------------------

const ITEM_TYPES = [
	'Code',
	'Concept',
	'Category',
	'Agency',
	'DataProvider',
	'DataConsumer',
	'OrganisationUnit',
	'HierarchicalCode',
];

function simplifyItems(node: XmlNode, parent?: string): IDataObject[] {
	const result: IDataObject[] = [];
	for (const child of node.children) {
		if (!ITEM_TYPES.includes(child.local)) continue;
		const explicitParent = getRef(childByName(child, 'Parent'))?.id;
		const item: IDataObject = {
			id: child.attributes.id,
			name: localisedText(child, 'Name'),
		};
		const description = localisedText(child, 'Description');
		if (description) item.description = description;
		if (explicitParent ?? parent) item.parent = explicitParent ?? parent;
		result.push(item);
		result.push(...simplifyItems(child, child.attributes.id));
	}
	return result;
}

function simplifyComponent(component: XmlNode): IDataObject {
	const concept = getRef(childByName(component, 'ConceptIdentity'));
	const representation = childByName(component, 'LocalRepresentation');
	const enumeration = representation
		? getRef(childByName(representation, 'Enumeration'))
		: undefined;
	const textFormat = representation ? childByName(representation, 'TextFormat') : undefined;

	const result: IDataObject = { id: component.attributes.id };
	if (component.attributes.position) result.position = Number(component.attributes.position);
	if (component.attributes.assignmentStatus) {
		result.assignmentStatus = component.attributes.assignmentStatus;
	}
	if (concept?.id) result.concept = concept.id;
	if (enumeration?.id) result.codelist = refToString(enumeration);
	if (textFormat?.attributes.textType) result.textType = textFormat.attributes.textType;
	return result;
}

function simplifyMaintainable(node: XmlNode): IDataObject {
	const result: IDataObject = {
		type: node.local,
		agencyId: node.attributes.agencyID,
		id: node.attributes.id,
		version: node.attributes.version,
		name: localisedText(node, 'Name'),
	};
	const description = localisedText(node, 'Description');
	if (description) result.description = description;
	if (node.attributes.isFinal) result.isFinal = node.attributes.isFinal === 'true';

	switch (node.local) {
		case 'DataStructure': {
			const components = childByName(node, 'DataStructureComponents');
			if (components) {
				const list = (name: string, items: string[]) => {
					const listNode = childByName(components, name);
					return listNode
						? listNode.children
								.filter((child) => items.includes(child.local))
								.map(simplifyComponent)
						: [];
				};
				result.dimensions = list('DimensionList', ['Dimension', 'TimeDimension']);
				result.attributes = list('AttributeList', ['Attribute']);
				result.measures = list('MeasureList', ['PrimaryMeasure']);
			}
			break;
		}
		case 'Dataflow':
			result.structure = refToString(getRef(childByName(node, 'Structure')));
			break;
		case 'Categorisation':
			result.source = refToString(getRef(childByName(node, 'Source')));
			result.target = refToString(getRef(childByName(node, 'Target')));
			break;
		case 'ContentConstraint': {
			const keyValues: IDataObject = {};
			for (const keyValue of findAll(node, 'KeyValue')) {
				keyValues[keyValue.attributes.id] = childrenByName(keyValue, 'Value').map((value) =>
					value.text.trim(),
				);
			}
			result.constrained = refToString(
				getRef(childByName(childByName(node, 'ConstraintAttachment') ?? node, 'Dataflow')),
			);
			result.keyValues = keyValues;
			break;
		}
		default: {
			const items = simplifyItems(node);
			if (items.length > 0) result.items = items;
		}
	}
	return result;
}

/** Converts an SDMX-ML structure message into one plain object per maintainable artefact */
export function simplifyStructureMessage(xml: string): IDataObject[] {
	const document = parseXml(xml);
	const structures = findAll(document, 'Structures')[0];
	if (!structures) return [];
	const result: IDataObject[] = [];
	for (const container of structures.children) {
		for (const maintainable of container.children) {
			result.push(simplifyMaintainable(maintainable));
		}
	}
	return result;
}
