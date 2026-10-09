import type { ExtractionResult } from "../types";

export class AIProviderError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = "AIProviderError";
    this.statusCode = statusCode;
  }
}

export interface ExtractionOptions {
  referenceDate?: Date | undefined;
  userTimeZone?: string | undefined;
}

export interface AIProvider {
  name: string;
  extract(content: string, options?: ExtractionOptions): Promise<ExtractionResult>;
}
