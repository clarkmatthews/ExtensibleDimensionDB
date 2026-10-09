# AI knowledge method

This database is a brand knowledge source. People define the dimensions and attributes. Records hold the facts. An AI model reads the meaning from the schema and retrieves facts when a question needs them.

The dataset is user-defined. A location catalog, a product catalog, and a vendor catalog are the same kind of data. Do not fine-tune a model on the current rows, and do not paste the whole database into a prompt. Both go stale as soon as someone edits an attribute.

## Three rules

**Schema is context.** A dimension name, an attribute display name, its description, its type, and its choice list tell the model what a fact means. The attribute key is the stable id. The display name and description are what the model should say.

Example: key `is_active`, display name Active, description "Whether the restaurant is open."

**Facts are retrieved.** A record is one subject: a location, a product, a vendor, or anything else a user defined. Its label is the unique-identifier attribute. Each fact is the attribute display name plus the current display value.

**Changes invalidate knowledge.** `FieldChange` stores who changed which attribute, the previous display value, the new display value, and when. A knowledge index refreshes from those rows. The model itself is left unchanged.

## Knowledge cards

A record becomes a short knowledge card. The card is the text a model cites. It is not a raw database row.

```text
Record: clx0abc123
Type: Location
Subject: Mesa Verde Grill
Dimension: Core
Phone Number: 480-555-0142 (Main phone number)
City: Phoenix (US city. Choices follow the selected state.)
Active: Active (Whether the restaurant is open)
```

Rules for every card:

- The type line is the record type, such as Location or Vendor.
- The subject line is the unique-identifier attribute's display value for that type.
- A link to another record shows the linked record's identifier, the same as the record page.
- Facts are grouped by dimension name.
- Each fact line is `Display name: value (description)`.
- Omit a description when the attribute has none.
- Use the same display text the record page shows, including choice-list labels.
- A parent-child list is an ordinary fact. "City follows State" is recorded on the attributes. The card does not grow a special location format for it.

The same card shape works for a product or a vendor. No new code is required when someone adds a dimension.

## Share API and the AI contract

API Config publishes a bulk snapshot. `GET /api/share/{id}` with `Authorization: Bearer` returns every shared attribute definition and every shared record in one JSON or XML body. That export is for a partner who needs a file.

An AI model needs search and a split between standing context and current facts. That is a separate contract. The share secret is not an AI credential, and tool results never include secrets.

## MCP contract

The contract is a read-only MCP server beside the app. Tool and resource text speaks only in dimensions, attributes, and records, so it stays accurate for any subject the user defines.

The server signs in as a dedicated view-only user. It sees only what that user can view on the Permissions page. A later write tool, if one is added, must use the same validation as the record form. This contract does not write.

### Run the server

Set `MCP_USER_EMAIL` in `.env` to an active user. Create that person on Users and grant view on the dimensions the model should read. An administrator account also works and can view every attribute. The server still has no write tools.

```bash
npm run mcp
```

The process speaks MCP on stdin and stdout. Status messages go to stderr. `npm run mcp` is the local command. Cursor should launch `tsx` directly so the npm banner stays off stdout:

```json
{
  "mcpServers": {
    "dimension-knowledge": {
      "command": "npx",
      "args": ["tsx", "--env-file=.env", "mcp/server.ts"],
      "cwd": "C:/path/to/ExtensibleDimensionDB"
    }
  }
}
```

### Resource `schema`

Standing context. A model loads it when the schema matters and can cache it until a dimension or attribute changes.

Returns active dimensions grouped by record type and, for each attribute:

- key, display name, and description
- dimension name
- data type
- whether it is the unique identifier
- choice list name, when the attribute uses one
- the attribute it follows, when its list is a child list
- the record type it links to, for a link attribute

### Tool `search_records`

Finds subjects. Arguments:

- `query` (text, required)
- `type` (optional record type name, such as Location)
- `dimension` (optional dimension name)
- `attribute` (optional attribute key or display name)

Returns matching knowledge cards and each record id. The search covers the subject label, display names, and display values the caller is allowed to view.

### Tool `get_record`

One subject. Argument: `id` (record id).

Returns the knowledge card grouped by dimension, limited to attributes the view-only user can see, followed by the records that link to it.

### Tool `recent_changes`

Refresh signal. Argument: `since` (ISO timestamp).

Returns changelog rows at or after that time: record id, subject label, dimension name, attribute display name, previous value, new value, person, and time. An indexer uses this to rebuild the cards that changed.

## Embeddings

An embedding index, if one is added later, stores these knowledge cards and nothing else. It is rebuilt from `FieldChange` rows. The database remains the source of the facts. The index is only a way to find the card to retrieve.
