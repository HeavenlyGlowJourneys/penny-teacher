import * as XLSX from "xlsx";
import type { ExtractedFilePayload } from "@/features/prep-check/planning-intelligence/types";

const TEXT_EXTS = new Set(["txt", "md", "csv", "json", "html", "htm", "rtf", "xml"]);
const OFFICE_DOCX = new Set(["docx", "doc"]);
const SPREADSHEET = new Set(["xlsx", "xls", "ods"]);
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp"]);
const SKIP = new Set(["ds_store", "thumbs.db"]);

const MAX_CHARS = 40_000;
const MAX_FILES_IN_ZIP = 80;

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

async function extractDocx(buf: ArrayBuffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ arrayBuffer: buf });
  return result.value ?? "";
}

function extractSpreadsheet(buf: ArrayBuffer): string {
  if (buf.byteLength > 50 * 1024 * 1024) {
    throw new Error("Spreadsheet is over 50 MB");
  }
  const wb = XLSX.read(buf, { type: "array" });
  const parts: string[] = [];
  for (const sheetName of wb.SheetNames.slice(0, 8)) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    parts.push(`## Sheet: ${sheetName}\n${XLSX.utils.sheet_to_csv(sheet)}`);
  }
  return parts.join("\n\n");
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function extractOne(
  fileName: string,
  buf: ArrayBuffer,
  mimeType?: string | null,
): Promise<ExtractedFilePayload> {
  const ext = extOf(fileName);
  let text = "";
  let kind = "other";
  let warning: string | undefined;
  let visionBase64: string | undefined;
  let visionMime: string | undefined;

  if (TEXT_EXTS.has(ext) || (mimeType ?? "").startsWith("text/")) {
    kind = "text";
    text = new TextDecoder().decode(buf);
  } else if (OFFICE_DOCX.has(ext) || (mimeType ?? "").includes("word")) {
    kind = "docx";
    text = await extractDocx(buf);
  } else if (
    SPREADSHEET.has(ext) ||
    (mimeType ?? "").includes("sheet") ||
    (mimeType ?? "").includes("excel")
  ) {
    kind = "spreadsheet";
    text = extractSpreadsheet(buf);
  } else if (ext === "pdf" || mimeType === "application/pdf") {
    kind = "pdf";
    warning =
      "PDF text layer is limited in-browser. Prefer Word/text copies for richer extraction; classification still runs from available cues.";
    text = `[PDF FILE: ${fileName}]\n(Limited text extraction — classify from structure cues and any pasted context.)`;
  } else if (["ppt", "pptx"].includes(ext)) {
    kind = "presentation";
    warning = "PowerPoint text extraction is limited.";
    text = `[PRESENTATION FILE: ${fileName}]`;
  } else if (IMAGE_EXTS.has(ext) || (mimeType ?? "").startsWith("image/")) {
    kind = "image";
    warning = "Image will be classified with vision when possible.";
    text = `[IMAGE FILE: ${fileName}]`;
    // Cap vision payload (~4MB raw → skip huge photos)
    if (buf.byteLength <= 3_500_000) {
      visionBase64 = arrayBufferToBase64(buf);
      visionMime =
        mimeType && mimeType.startsWith("image/")
          ? mimeType
          : ext === "png"
            ? "image/png"
            : ext === "webp"
              ? "image/webp"
              : ext === "gif"
                ? "image/gif"
                : "image/jpeg";
    }
  } else {
    kind = "other";
    text = new TextDecoder().decode(buf);
    if (!text.replace(/\u0000/g, "").trim()) {
      throw new Error(`Could not read “${fileName}”.`);
    }
    warning = `Treated “${fileName}” as plain text.`;
  }

  text = text.replace(/\u0000/g, "").trim();
  if (!text) text = `[FILE: ${fileName}]`;
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS) + "\n…[truncated]";

  return {
    fileName,
    mimeType,
    text,
    kind,
    warning,
    visionBase64,
    visionMime,
  };
}

/** Extract one or many files (ZIP expands to multiple payloads). */
export async function extractAnyDocument(file: File): Promise<ExtractedFilePayload[]> {
  const ext = extOf(file.name);
  if (ext === "zip" || file.type === "application/zip" || file.type === "application/x-zip-compressed") {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const out: ExtractedFilePayload[] = [];
    let processed = 0;
    const entries = Object.values(zip.files).filter((f) => !f.dir);
    for (const entry of entries) {
      if (processed >= MAX_FILES_IN_ZIP) break;
      const path = entry.name.replace(/\\/g, "/");
      const base = path.split("/").pop() ?? path;
      if (base.startsWith(".") || SKIP.has(base.toLowerCase())) continue;
      if (path.includes("__MACOSX/")) continue;
      try {
        const buf = await entry.async("arraybuffer");
        out.push(await extractOne(base, buf, null));
        processed++;
      } catch {
        out.push({
          fileName: base,
          text: `[UNREADABLE: ${base}]`,
          kind: "other",
          warning: `Could not extract ${base}`,
        });
      }
    }
    if (!out.length) throw new Error("No usable files found in the ZIP.");
    return out;
  }

  const buf = await file.arrayBuffer();
  return [await extractOne(file.name, buf, file.type || null)];
}

/** Back-compat wrapper used by config classify. */
export async function extractConfigDocument(file: File) {
  const [first] = await extractAnyDocument(file);
  if (!first) throw new Error("No readable text found in that file.");
  return { text: first.text, kind: first.kind, warning: first.warning };
}
