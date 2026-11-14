/**
 * Client-side text extraction for oral assessment uploads.
 * PDF via pdf.js, DOCX via mammoth, PPTX via JSZip slide XML.
 */
import JSZip from "jszip";

const TEXT_EXTS = new Set(["txt", "md", "csv", "json", "html", "htm", "rtf"]);
const OFFICE_DOCX = new Set(["docx", "doc"]);
const MAX_CHARS = 40_000;
const MAX_VISION_BYTES = 3_500_000;

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

async function extractDocx(buf: ArrayBuffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ arrayBuffer: buf });
  return result.value ?? "";
}

async function extractPdf(buf: ArrayBuffer): Promise<{ text: string; warning?: string }> {
  const pdfjs = await import("pdfjs-dist");
  // Vite-friendly worker
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const pages: string[] = [];
  const maxPages = Math.min(doc.numPages, 40);
  for (let i = 1; i <= maxPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const line = content.items
      .map((item) => ("str" in item ? String(item.str) : ""))
      .filter(Boolean)
      .join(" ");
    if (line.trim()) pages.push(line);
  }
  const text = pages.join("\n\n").trim();
  if (!text) {
    return {
      text: "",
      warning: "This PDF has little or no selectable text (it may be scanned). Vision analysis will be used if possible.",
    };
  }
  if (doc.numPages > maxPages) {
    return {
      text,
      warning: `Extracted text from the first ${maxPages} of ${doc.numPages} pages.`,
    };
  }
  return { text };
}

async function extractPptx(buf: ArrayBuffer): Promise<{ text: string; warning?: string }> {
  const zip = await JSZip.loadAsync(buf);
  const slidePaths = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/i.test(p))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)/i)?.[1] ?? 0);
      const nb = Number(b.match(/slide(\d+)/i)?.[1] ?? 0);
      return na - nb;
    })
    .slice(0, 40);

  const parts: string[] = [];
  for (const path of slidePaths) {
    const xml = await zip.file(path)?.async("string");
    if (!xml) continue;
    const texts = [...xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)].map((m) => m[1]?.trim() ?? "");
    const joined = texts.filter(Boolean).join(" ");
    if (joined) {
      const n = path.match(/slide(\d+)/i)?.[1] ?? "?";
      parts.push(`## Slide ${n}\n${joined}`);
    }
  }
  const text = parts.join("\n\n").trim();
  if (!text) {
    return {
      text: "",
      warning: "Could not extract text from this PowerPoint. Vision/filename context will be used.",
    };
  }
  return { text };
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

export type OralDocExtract = {
  text: string;
  kind: string;
  warning?: string;
  /** Optional media for Gemini vision when text is thin (images / scanned PDFs). */
  visionBase64?: string;
  visionMime?: string;
};

export async function extractOralAssessmentDocument(file: File): Promise<OralDocExtract> {
  const ext = extOf(file.name);
  const buf = await file.arrayBuffer();
  let text = "";
  let kind = "other";
  let warning: string | undefined;
  let visionBase64: string | undefined;
  let visionMime: string | undefined;

  try {
    if (TEXT_EXTS.has(ext) || file.type.startsWith("text/")) {
      kind = "text";
      text = new TextDecoder().decode(buf);
    } else if (OFFICE_DOCX.has(ext) || file.type.includes("word")) {
      kind = "docx";
      text = await extractDocx(buf);
    } else if (ext === "pdf" || file.type === "application/pdf") {
      kind = "pdf";
      const pdf = await extractPdf(buf);
      text = pdf.text;
      warning = pdf.warning;
      if ((!text || text.length < 80) && buf.byteLength <= MAX_VISION_BYTES) {
        visionBase64 = arrayBufferToBase64(buf);
        visionMime = "application/pdf";
        warning =
          (warning ? `${warning} ` : "") +
          "PDF will also be sent for AI document reading.";
      }
    } else if (ext === "pptx" || file.type.includes("presentation")) {
      kind = "presentation";
      const ppt = await extractPptx(buf);
      text = ppt.text;
      warning = ppt.warning;
    } else if (ext === "ppt") {
      kind = "presentation";
      warning = "Legacy .ppt is limited — upload .pptx or PDF for better extraction.";
      text = `[PRESENTATION FILE: ${file.name}]`;
    } else if (file.type.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) {
      kind = "image";
      text = `[IMAGE FILE: ${file.name}]`;
      if (buf.byteLength <= MAX_VISION_BYTES) {
        visionBase64 = arrayBufferToBase64(buf);
        visionMime =
          file.type && file.type.startsWith("image/")
            ? file.type
            : ext === "png"
              ? "image/png"
              : ext === "webp"
                ? "image/webp"
                : ext === "gif"
                  ? "image/gif"
                  : "image/jpeg";
        warning = "Image will be analysed with AI vision.";
      } else {
        warning = "Image is too large for vision analysis; rename/title context only.";
      }
    } else {
      kind = "other";
      text = new TextDecoder().decode(buf);
      if (!text.replace(/\u0000/g, "").trim()) {
        warning = "Could not extract text from this file.";
        text = `[FILE: ${file.name}]`;
      }
    }
  } catch (err) {
    warning = err instanceof Error ? `Extraction issue: ${err.message}` : "Extraction failed.";
    text = text || `[FILE: ${file.name}]`;
  }

  return {
    text: (text || `[FILE: ${file.name}]`).slice(0, MAX_CHARS),
    kind,
    warning,
    visionBase64,
    visionMime,
  };
}
