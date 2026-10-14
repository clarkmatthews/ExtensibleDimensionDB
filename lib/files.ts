/**
 * File attributes. A file's bytes live in StoredFile; the attribute's value lists each file as
 * "<id>/<name>", joined with "|", so names show everywhere values are shown (grid, changelog,
 * exports, notices, AI tools) without reading the files themselves.
 */

/** Largest single file. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Largest total upload in one save. Keep under serverActions.bodySizeLimit in next.config. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Every type a file attribute can accept, with the content type it is served as. */
export const FILE_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

/** Opened in the browser rather than downloaded. */
const INLINE = new Set([".pdf", ".png", ".jpg", ".jpeg"]);

export function extensionOf(name: string) {
  const match = /\.[a-z0-9]+$/i.exec(name.trim());
  return match ? match[0].toLowerCase() : "";
}

/** Cleans an attribute's accepted types: known extensions only, lower case, no duplicates. */
export function normalizeFileTypes(raw: string): { value: string; error?: string } {
  const items = raw
    .split(/[\s,;]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .map((item) => (item.startsWith(".") ? item : `.${item}`));
  const unknown = items.filter((item) => !FILE_TYPES[item]);
  if (unknown.length) {
    return { value: "", error: `Unsupported file type ${unknown.join(", ")}. Use any of ${Object.keys(FILE_TYPES).join(", ")}.` };
  }
  return { value: [...new Set(items)].join(",") };
}

/** The extensions an attribute accepts. */
export function acceptedTypes(field: { fileTypes: string }) {
  const own = normalizeFileTypes(field.fileTypes).value;
  return own ? own.split(",") : Object.keys(FILE_TYPES);
}

export type FileRef = { id: string; name: string };

/** A safe display name: no folders, no separators used in the stored value, at most 200 characters. */
export function cleanFileName(name: string) {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[|\u0000-\u001f\u007f]/g, "-").trim();
  if (cleaned.length <= 200) return cleaned || "file";
  const extension = extensionOf(cleaned);
  return `${cleaned.slice(0, 200 - extension.length)}${extension}`;
}

export function fileToken(file: FileRef) {
  return `${file.id}/${cleanFileName(file.name)}`;
}

export function parseFileTokens(raw: string | null | undefined): FileRef[] {
  return (raw ?? "")
    .split("|")
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => {
      const slash = token.indexOf("/");
      return slash > 0 ? { id: token.slice(0, slash), name: token.slice(slash + 1) } : { id: token, name: token };
    });
}

/** The names of the files in a stored value, for display. */
export function fileNames(raw: string | null | undefined) {
  return parseFileTokens(raw)
    .map((file) => file.name)
    .join(", ");
}

const startsWith = (bytes: Uint8Array, signature: number[]) => signature.every((byte, index) => bytes[index] === byte);

/** True when the file's first bytes match its extension, so a renamed file is not stored as something else. */
export function contentMatches(extension: string, bytes: Uint8Array) {
  switch (extension) {
    case ".pdf":
      return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
    case ".docx":
    case ".xlsx":
    case ".pptx":
      return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]);
    case ".doc":
    case ".xls":
    case ".ppt":
      return startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    case ".png":
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case ".jpg":
    case ".jpeg":
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case ".txt":
    case ".csv":
      return !bytes.subarray(0, 8192).includes(0);
    default:
      return false;
  }
}

/** Why an upload cannot be stored on this attribute, or null when it can. */
export function uploadError(field: { fileTypes: string; friendlyName: string }, name: string, bytes: Uint8Array) {
  const extension = extensionOf(name);
  const accepted = acceptedTypes(field);
  if (!accepted.includes(extension)) return `${field.friendlyName}: ${cleanFileName(name)} is not an accepted type (${accepted.join(", ")}).`;
  if (bytes.length === 0) return `${field.friendlyName}: ${cleanFileName(name)} is empty.`;
  if (bytes.length > MAX_FILE_BYTES) return `${field.friendlyName}: ${cleanFileName(name)} is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.`;
  if (!contentMatches(extension, bytes)) return `${field.friendlyName}: ${cleanFileName(name)} does not look like a ${extension} file.`;
  return null;
}

/** How a stored file is sent back: its content type and whether the browser shows it or saves it. */
export function servingHeaders(name: string, download: boolean) {
  const extension = extensionOf(name);
  const contentType = FILE_TYPES[extension] ?? "application/octet-stream";
  const disposition = !download && INLINE.has(extension) ? "inline" : "attachment";
  const ascii = cleanFileName(name).replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return {
    "Content-Type": contentType,
    "Content-Disposition": `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(cleanFileName(name))}`,
  };
}

export function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  const megabytes = size / 1024 / 1024;
  return `${Number.isInteger(megabytes) ? megabytes : megabytes.toFixed(1)} MB`;
}
