import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

export const BASE_URL = 'https://data-api.ecb.europa.eu/service';

export const MIME_TYPES = {
	sdmxJson: 'application/vnd.sdmx.data+json;version=1.0.0-wd',
	csv: 'text/csv',
	csvPivot: 'application/vnd.ecb.data+csv;version=1.0.0',
	genericXml: 'application/vnd.sdmx.genericdata+xml;version=2.1',
	structureSpecificXml: 'application/vnd.sdmx.structurespecificdata+xml;version=2.1',
	structureXml: 'application/vnd.sdmx.structure+xml;version=2.1',
} as const;

export type EcbContext = IExecuteFunctions | ILoadOptionsFunctions;

export interface EcbResponse {
	statusCode: number;
	contentType: string;
	body: Buffer;
}

export interface EcbRequestOptions {
	accept: string;
	qs?: IDataObject;
	headers?: IDataObject;
	itemIndex?: number;
	/** HTTP status codes that are returned to the caller instead of raising an error */
	allowedStatusCodes?: number[];
}

function extractErrorMessage(response: EcbResponse): { message: string; description?: string } {
	const text = response.body.toString('utf8');
	if (response.contentType.includes('json')) {
		try {
			const problem = JSON.parse(text) as IDataObject;
			const detail = typeof problem.detail === 'string' ? problem.detail : undefined;
			const title = typeof problem.title === 'string' ? problem.title : undefined;
			return {
				message: title ?? `ECB API request failed with status ${response.statusCode}`,
				description: detail,
			};
		} catch {
			// fall through to the generic message
		}
	}

	const defaults: Record<number, string> = {
		400: 'Bad request: the query is not valid. Check the series key (number of dimensions and dot separators) and the parameters.',
		404: 'No results found for this query.',
		406: 'The requested format is not available for this resource.',
		413: 'The request is too large. Narrow the query (e.g. fewer series or a shorter date range).',
		500: 'The ECB API returned an internal server error.',
		501: 'This feature is not implemented by the ECB API.',
		503: 'The ECB API is temporarily unavailable. Try again later.',
	};
	return {
		message: defaults[response.statusCode] ?? `ECB API request failed with status ${response.statusCode}`,
	};
}

/**
 * Performs a request against the ECB Data Portal API and always returns the raw body as a Buffer,
 * so callers can either parse it (JSON / XML) or attach it as a binary file.
 */
export async function ecbRequest(
	this: EcbContext,
	path: string,
	options: EcbRequestOptions,
): Promise<EcbResponse> {
	const requestOptions: IHttpRequestOptions = {
		method: 'GET',
		url: `${BASE_URL}${path}`,
		qs: options.qs,
		headers: { Accept: options.accept, ...(options.headers ?? {}) },
		encoding: 'arraybuffer',
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
		json: false,
	};

	let rawResponse: { statusCode: number; headers: IDataObject; body: unknown };
	try {
		rawResponse = (await this.helpers.httpRequest(requestOptions)) as typeof rawResponse;
	} catch (error) {
		throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: options.itemIndex });
	}

	const rawBody = rawResponse.body;
	let body: Buffer;
	if (Buffer.isBuffer(rawBody)) body = rawBody;
	else if (rawBody instanceof ArrayBuffer) body = Buffer.from(new Uint8Array(rawBody));
	else if (typeof rawBody === 'string') body = Buffer.from(rawBody, 'utf8');
	else body = Buffer.from(rawBody === undefined || rawBody === null ? '' : JSON.stringify(rawBody));
	const response: EcbResponse = {
		statusCode: rawResponse.statusCode,
		contentType: String(rawResponse.headers?.['content-type'] ?? ''),
		body,
	};

	if (
		response.statusCode >= 400 &&
		!(options.allowedStatusCodes ?? []).includes(response.statusCode)
	) {
		const { message, description } = extractErrorMessage(response);
		throw new NodeApiError(
			this.getNode(),
			{ message, description: description ?? '', httpCode: String(response.statusCode) },
			{
				message,
				description,
				httpCode: String(response.statusCode),
				itemIndex: options.itemIndex,
			},
		);
	}

	return response;
}

/** Fetches a structural metadata resource and returns the XML as a string */
export async function ecbStructureRequest(
	this: EcbContext,
	path: string,
	qs?: IDataObject,
	itemIndex?: number,
): Promise<string> {
	const response = await ecbRequest.call(this, path, {
		accept: MIME_TYPES.structureXml,
		qs,
		itemIndex,
	});
	return response.body.toString('utf8');
}

/** Fetches data in SDMX-JSON and returns the parsed object (or undefined on 404 / no data) */
export async function ecbJsonDataRequest(
	this: EcbContext,
	path: string,
	qs?: IDataObject,
	itemIndex?: number,
): Promise<IDataObject | undefined> {
	const response = await ecbRequest.call(this, path, {
		accept: MIME_TYPES.sdmxJson,
		qs,
		itemIndex,
		allowedStatusCodes: [404],
	});
	if (response.statusCode === 404 || response.body.length === 0) return undefined;
	return JSON.parse(response.body.toString('utf8')) as IDataObject;
}
