/**
 * Minimal, dependency-free XML parser for SDMX-ML structure messages.
 *
 * n8n community nodes must not ship runtime dependencies, and the ECB API only
 * serves structural metadata as SDMX-ML (XML), so we parse it ourselves. The
 * parser supports elements, attributes, text, CDATA, comments, processing
 * instructions and the standard/numeric XML entities. Namespace prefixes are
 * kept in `name` and stripped in `local`.
 */

export interface XmlNode {
	name: string;
	local: string;
	attributes: Record<string, string>;
	children: XmlNode[];
	text: string;
}

const ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
};

export function decodeEntities(value: string): string {
	return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (match, entity: string) => {
		if (entity.startsWith('#x')) return String.fromCodePoint(parseInt(entity.slice(2), 16));
		if (entity.startsWith('#')) return String.fromCodePoint(parseInt(entity.slice(1), 10));
		return ENTITIES[entity] ?? match;
	});
}

function localName(name: string): string {
	const index = name.indexOf(':');
	return index === -1 ? name : name.slice(index + 1);
}

function createNode(name: string): XmlNode {
	return { name, local: localName(name), attributes: {}, children: [], text: '' };
}

const ATTRIBUTE_REGEX = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export function parseXml(xml: string): XmlNode {
	const root = createNode('#document');
	const stack: XmlNode[] = [root];
	let position = 0;

	while (position < xml.length) {
		const tagStart = xml.indexOf('<', position);
		const current = stack[stack.length - 1];

		if (tagStart === -1) {
			current.text += decodeEntities(xml.slice(position));
			break;
		}
		if (tagStart > position) {
			current.text += decodeEntities(xml.slice(position, tagStart));
		}

		if (xml.startsWith('<!--', tagStart)) {
			const end = xml.indexOf('-->', tagStart + 4);
			position = end === -1 ? xml.length : end + 3;
			continue;
		}
		if (xml.startsWith('<![CDATA[', tagStart)) {
			const end = xml.indexOf(']]>', tagStart + 9);
			current.text += xml.slice(tagStart + 9, end === -1 ? xml.length : end);
			position = end === -1 ? xml.length : end + 3;
			continue;
		}
		if (xml.startsWith('<?', tagStart)) {
			const end = xml.indexOf('?>', tagStart + 2);
			position = end === -1 ? xml.length : end + 2;
			continue;
		}
		if (xml.startsWith('<!', tagStart)) {
			const end = xml.indexOf('>', tagStart + 2);
			position = end === -1 ? xml.length : end + 1;
			continue;
		}

		const tagEnd = xml.indexOf('>', tagStart + 1);
		if (tagEnd === -1) break;
		const rawTag = xml.slice(tagStart + 1, tagEnd);
		position = tagEnd + 1;

		if (rawTag.startsWith('/')) {
			if (stack.length > 1) stack.pop();
			continue;
		}

		const selfClosing = rawTag.endsWith('/');
		const body = selfClosing ? rawTag.slice(0, -1) : rawTag;
		const nameMatch = /^[^\s/>]+/.exec(body);
		if (!nameMatch) continue;

		const node = createNode(nameMatch[0]);
		const attributeSource = body.slice(nameMatch[0].length);
		ATTRIBUTE_REGEX.lastIndex = 0;
		let attributeMatch: RegExpExecArray | null;
		while ((attributeMatch = ATTRIBUTE_REGEX.exec(attributeSource)) !== null) {
			node.attributes[attributeMatch[1]] = decodeEntities(
				attributeMatch[2] ?? attributeMatch[3] ?? '',
			);
		}

		current.children.push(node);
		if (!selfClosing) stack.push(node);
	}

	return root;
}

/** Direct children with the given local name */
export function childrenByName(node: XmlNode, local: string): XmlNode[] {
	return node.children.filter((child) => child.local === local);
}

/** First direct child with the given local name */
export function childByName(node: XmlNode, local: string): XmlNode | undefined {
	return node.children.find((child) => child.local === local);
}

/** All descendants (depth-first) with the given local name */
export function findAll(node: XmlNode, local: string, result: XmlNode[] = []): XmlNode[] {
	for (const child of node.children) {
		if (child.local === local) result.push(child);
		findAll(child, local, result);
	}
	return result;
}

/** Text of a localised child element (e.g. com:Name), preferring English */
export function localisedText(node: XmlNode, local: string, language = 'en'): string | undefined {
	const candidates = childrenByName(node, local);
	if (candidates.length === 0) return undefined;
	const preferred = candidates.find((child) => child.attributes['xml:lang'] === language);
	return (preferred ?? candidates[0]).text.trim();
}
