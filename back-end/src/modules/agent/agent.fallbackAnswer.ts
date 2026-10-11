// Builds a readable Markdown answer straight from tool results, used when no AI provider could
// write one. The data is shown as-is (tables for lists, labelled lines for single records), so
// an AI outage never leaves the user with an answer that does not contain the data.

const MAX_ROWS = 20;
const MAX_COLUMNS = 6;
const MAX_CELL_CHARS = 160;

type Row = Record<string, unknown>;

function isPlainObject(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

function isIdKey(key: string): boolean {
  return key === "_id" || key === "id" || /Id$/.test(key);
}

function humanize(key: string): string {
  const spaced = key.replace(/^_/, "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return value.slice(0, 10);
  }

  if (Array.isArray(value)) {
    return value.length === 0 ? "—" : value.map(formatValue).join(", ");
  }

  if (isPlainObject(value)) {
    const label = value.name ?? value.fullName ?? value.title;
    return typeof label === "string" ? label : "—";
  }

  return String(value);
}

/** Markdown-safe table cell: one line, no pipes, bounded length. */
function cell(value: unknown): string {
  const text = formatValue(value).replace(/\s+/g, " ").replace(/\|/g, "/").trim();
  return text.length > MAX_CELL_CHARS ? `${text.slice(0, MAX_CELL_CHARS - 1)}…` : text;
}

/** Readable fields first, the record ID last (follow-up requests rely on it). */
function chooseColumns(rows: Row[]): string[] {
  const keys: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!keys.includes(key)) {
        keys.push(key);
      }
    }
  }

  const idKey = keys.find((key) => key === "_id" || key === "id") ?? keys.find(isIdKey);
  const readable = keys.filter((key) => !isIdKey(key) && key !== "__v" && key !== "score");
  return [...readable.slice(0, idKey ? MAX_COLUMNS - 1 : MAX_COLUMNS), ...(idKey ? [idKey] : [])];
}

function renderTable(rows: Row[]): string {
  const columns = chooseColumns(rows);
  const lines = [
    `| ${columns.map(humanize).join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.slice(0, MAX_ROWS).map((row) => `| ${columns.map((key) => {
      const text = cell(row[key]);
      return isIdKey(key) && text !== "—" ? `\`${text}\`` : text;
    }).join(" | ")} |`),
  ];

  if (rows.length > MAX_ROWS) {
    lines.push("", `…and ${rows.length - MAX_ROWS} more.`);
  }

  return lines.join("\n");
}

function renderRecord(record: Row): string {
  return Object.entries(record)
    .filter(([key, value]) => key !== "__v" && !Array.isArray(value) && !isPlainObject(value))
    .map(([key, value]) => `- **${humanize(key)}:** ${isIdKey(key) ? `\`${cell(value)}\`` : cell(value)}`)
    .join("\n");
}

function renderResult(result: unknown): string {
  if (Array.isArray(result)) {
    const rows = result.filter(isPlainObject);
    return rows.length > 0 ? renderTable(rows) : result.length === 0 ? "No results." : cell(result);
  }

  if (!isPlainObject(result)) {
    return cell(result);
  }

  // Typical tool shape: { total, patients: [...] } or { patientId, notes: [...] }.
  const lists = Object.entries(result).filter(([, value]) => Array.isArray(value) && value.some(isPlainObject));
  if (lists.length > 0) {
    return lists
      .map(([key, value]) => {
        const rows = (value as unknown[]).filter(isPlainObject);
        return `**${humanize(key)}** (${rows.length})\n\n${renderTable(rows)}`;
      })
      .join("\n\n");
  }

  const emptyList = Object.entries(result).find(([, value]) => Array.isArray(value) && value.length === 0);
  if (emptyList) {
    return `No ${humanize(emptyList[0]).toLowerCase()} found.`;
  }

  return renderRecord(result);
}

export function buildFallbackAnswer(results: Array<{ tool: string; result: unknown }>): string {
  const sections = results.map(({ tool, result }) => {
    const title = humanize(tool.replace(/_RAG$/, "").replace(/_/g, " ").toLowerCase());
    return `### ${title}\n\n${renderResult(result)}`;
  });

  return [
    "_The AI could not write a summary right now (providers unavailable), so here is the data as retrieved._",
    ...sections,
  ].join("\n\n");
}
