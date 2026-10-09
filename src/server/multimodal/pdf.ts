export type PdfParserFn = (buffer: Buffer) => Promise<string>;

let customPdfParser: PdfParserFn | null = null;

export function setPdfParser(parser: PdfParserFn | null): void {
  customPdfParser = parser;
}

export function resetPdfParser(): void {
  customPdfParser = null;
}

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  if (!buffer || buffer.length === 0) {
    throw new Error("Empty PDF file provided.");
  }

  let textResult = "";
  if (customPdfParser) {
    textResult = await customPdfParser(buffer);
  } else {
    try {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      textResult = result.text || "";
      if (typeof parser.destroy === "function") {
        await parser.destroy();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to parse PDF: ${message}`);
    }
  }

  // Remove common page marker lines like "-- 1 of 1 --"
  const cleaned = textResult
    .replace(/--\s*\d+\s*of\s*\d+\s*--/gi, "")
    .replace(/\r\n/g, "\n")
    .trim();

  if (!cleaned) {
    throw new Error(
      "This PDF contains no extractable text. It may be scanned or empty. Please upload as an image or ensure selectable text.",
    );
  }

  return cleaned;
}
