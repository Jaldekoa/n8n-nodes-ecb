# n8n-nodes-ecb

n8n community node for the [ECB Data Portal](https://data.ecb.europa.eu/) API of the European Central Bank. It retrieves statistical time series (exchange rates, interest rates, inflation, monetary aggregates, balance of payments, …) and structural metadata. The API is public and needs **no credentials**.

[Installation](#installation) · [Operations](#operations) · [Usage](#usage) · [Resources](#resources)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation and install `n8n-nodes-ecb`.

For local development:

```bash
npm install
npm run dev     # starts n8n with this node loaded and hot reload
```

## Operations

### Data → Get

Fetches observations from any dataset (dataflow).

- **Category**: optional filter that mirrors the [data categories](https://data.ecb.europa.eu/data/data-categories) of the portal and narrows down the dataset list.
- **Dataset**: pick from a searchable list, type the ID (`EXR`, or `AGENCY,ID,VERSION`) or paste a portal URL such as `https://data.ecb.europa.eu/data/datasets/EXR`.
- **Series Selection**
  - *Dimension Filters*: choose a dimension and one or more values from dropdowns loaded from the dataset. Dimensions without a filter match all values, several values are combined with OR. The node builds the series key for you in the right order.
  - *Series Key*: type the key directly, e.g. `D.USD+JPY.EUR.SP00.A`. Empty positions are wildcards (`D..EUR.SP00.A`). Keys copied from the portal (`EXR.D.USD.EUR.SP00.A`) are accepted too.
- **Output Format**
  - *JSON* (default): n8n items. With **Simplify** on, you get one flat item per observation (or per series, with an `observations` array) containing `SERIES_KEY`, the dimension codes, `TIME_PERIOD`, `OBS_VALUE` and the attributes. Turn on **Include Labels** to add `<FIELD>_LABEL` names. With Simplify off, the raw SDMX-JSON message is returned.
  - *CSV File*, *CSV File (Pivot-Friendly)*, *SDMX-ML Generic Data (XML) File*, *SDMX-ML Structure Specific Data (XML) File*, *SDMX-JSON File*: the API response is returned as a binary file.
- **Options**: Start Period, End Period, Updated After, First/Last N Observations, Detail (full, data only, series keys only, no data), Include History, File Name and Error If No Data.

When a query matches nothing (for example with *Updated After* and no new data), the node returns no items unless **Error If No Data** is enabled.

### Dataset → Get Many

Lists the available datasets with their ID, agency, version, name and portal categories. You can filter by category and by text.

### Dataset → Get Dimensions

Returns the dimensions of a dataset in series key order, with the codes actually used in each one. This helps you build series keys, and it is useful for AI agents that use the node as a tool.

### Metadata → Get

Retrieves SDMX structural metadata (code lists, concept schemes, data structures, dataflows, category schemes, content constraints, …) with the `detail` and `references` options. The output is either JSON items (one per artefact, with its codes, concepts or components) or the raw SDMX-ML XML file.

## Usage

Daily USD/EUR reference rate for the last 30 days:

1. Resource **Data**, operation **Get**, dataset **EXR**.
2. Series Selection **Series Key**: `D.USD.EUR.SP00.A`.
3. Options → **Last N Observations**: `30`.

To get the same data as CSV, set **Output Format** to *CSV File*. Then use *Extract from File* or save the file wherever you want.

## Resources

- [ECB Data Portal API documentation](https://data.ecb.europa.eu/help/api/overview)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)

## Version history

See [CHANGELOG.md](CHANGELOG.md).
