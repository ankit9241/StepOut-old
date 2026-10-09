export type OcrEngine = (buffer: Buffer) => Promise<string>;

let customOcrEngine: OcrEngine | null = null;

export function setOcrEngine(engine: OcrEngine | null): void {
  customOcrEngine = engine;
}

export function resetOcrEngine(): void {
  customOcrEngine = null;
}

export async function extractTextFromImage(buffer: Buffer): Promise<string> {
  if (!buffer || buffer.length === 0) {
    throw new Error("Empty image file provided.");
  }

  if (customOcrEngine) {
    return customOcrEngine(buffer);
  }

  try {
    const Tesseract = (await import("tesseract.js")).default;
    const { data } = await Tesseract.recognize(buffer, "eng");
    const cleaned = (data.text || "").trim();
    if (!cleaned) {
      throw new Error(
        "No readable text found in the image. Please ensure the image is clear and contains text.",
      );
    }
    return cleaned;
  } catch (error) {
    if (error instanceof Error && error.message.includes("No readable text")) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`OCR processing failed: ${message}`);
  }
}
