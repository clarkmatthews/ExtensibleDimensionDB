/**
 * Parses CSV text (RFC 4180): comma separated, double-quoted fields, "" for a quote inside
 * a quoted field, CRLF or LF line endings, and an optional UTF-8 byte order mark.
 * Blank lines are skipped. Returns rows of cells.
 */
export function parseCsv(text: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let index = 0;
  const endRow = () => {
    row.push(cell);
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
    cell = "";
  };
  while (index < input.length) {
    const char = input[index];
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          cell += '"';
          index += 2;
          continue;
        }
        quoted = false;
      } else {
        cell += char;
      }
      index += 1;
      continue;
    }
    if (char === '"' && cell === "") quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") endRow();
    else if (char === "\r") {
      if (input[index + 1] !== "\n") endRow();
    } else cell += char;
    index += 1;
  }
  if (cell !== "" || row.length) endRow();
  return rows;
}

/** Undoes the formula guard that Export CSV adds: a leading apostrophe before = + - @. */
export function unguardCell(value: string) {
  return /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value;
}
