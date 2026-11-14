import JSZip from "jszip";
import * as XLSX from "xlsx";
import type { PrepCheckFileManifestEntry } from "@/features/prep-check/types";

const TEXT_EXTS = new Set([
  "txt",
  "md",
  "csv",
  "json",
  "html",
  "htm",
  "rtf",
  "xml",
]);
const OFFICE_DOCX = new Set(["docx"]);
const SPREADSHEET = new Set(["xlsx", "xls", "ods"]);
const SKIP = new Set(["ds_store", "thumbs.db"]);

const MAX_FILES = 80;
const MAX_CHARS_PER_FILE = 12_000;
const MAX_CORPUS_CHARS = 120_000;

function extOf(path: string): string {
  const base = path.split("/").pop() ?? path;
  const i = base.lastIndexOf(".");
  return i >= 0 ? base.slice(i + 1).toLowerCase() : "";
}

function kindOf(ext: string): string {
  if (TEXT_EXTS.has(ext)) return "text";
  if (OFFICE_DOCX.has(ext)) return "docx";
  if (SPREADSHEET.has(ext)) return "spreadsheet";
  if (ext === "pdf") return "pdf";
  if (["ppt", "pptx"].includes(ext)) return "presentation";
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return "image";
  return "other";
}

async function extractDocx(buf: ArrayBuffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ arrayBuffer: buf });
  return result.value ?? "";
}

function extractSpreadsheet(buf: ArrayBuffer): string {
  const wb = XLSX.read(buf, { type: "array" });
  const parts: string[] = [];
  for (const name of wb.SheetNames.slice(0, 8)) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    parts.push(`## Sheet: ${name}\n${XLSX.utils.sheet_to_csv(sheet)}`);
  }
  return parts.join("\n\n");
}

export type ZipExtractResult = {
  corpus: string;
  manifest: PrepCheckFileManifestEntry[];
  warnings: string[];
};

export async function extractPlanningZip(file: File): Promise<ZipExtractResult> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const manifest: PrepCheckFileManifestEntry[] = [];
  const warnings: string[] = [];
  const chunks: string[] = [];
  let totalChars = 0;
  let processed = 0;

  const entries = Object.values(zip.files).filter((f) => !f.dir);
  for (const entry of entries) {
    if (processed >= MAX_FILES) {
      warnings.push(`Stopped after ${MAX_FILES} files.`);
      break;
    }
    const path = entry.name.replace(/\\/g, "/");
    const base = path.split("/").pop() ?? path;
    if (base.startsWith(".") || SKIP.has(base.toLowerCase())) continue;
    if (path.includes("__MACOSX/")) continue;

    const ext = extOf(path);
    const kind = kindOf(ext);
    let text = "";

    try {
      if (kind === "text") {
        text = await entry.async("string");
      } else if (kind === "docx") {
        text = await extractDocx(await entry.async("arraybuffer"));
      } else if (kind === "spreadsheet") {
        text = extractSpreadsheet(await entry.async("arraybuffer"));
      } else if (kind === "pdf" || kind === "presentation" || kind === "image") {
        warnings.push(`Limited extraction for ${path} (${kind}) — filename noted for review.`);
        text = `[${kind.toUpperCase()} FILE: ${path}]`;
      } else {
        text = `[BINARY/OTHER FILE: ${path}]`;
      }
    } catch (err) {
      warnings.push(`Failed to read ${path}: ${err instanceof Error ? err.message : "error"}`);
      text = `[UNREADABLE: ${path}]`;
    }

    text = text.replace(/\u0000/g, "").trim();
    if (text.length > MAX_CHARS_PER_FILE) {
      text = text.slice(0, MAX_CHARS_PER_FILE) + "\n…[truncated]";
    }

    const size = (await entry.async("uint8array")).byteLength;
    manifest.push({ path, size, kind, extractedChars: text.length });
    processed += 1;

    if (totalChars < MAX_CORPUS_CHARS) {
      const room = MAX_CORPUS_CHARS - totalChars;
      const piece = text.slice(0, room);
      chunks.push(`\n\n===== FILE: ${path} =====\n${piece}`);
      totalChars += piece.length;
    }
  }

  if (!manifest.length) {
    throw new Error("No usable files found in the ZIP.");
  }

  return { corpus: chunks.join(""), manifest, warnings };
}
