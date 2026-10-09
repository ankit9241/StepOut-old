export interface AudioTranscriber {
  transcribe(buffer: Buffer, mimeType: string): Promise<string>;
}

export class DefaultAudioTranscriber implements AudioTranscriber {
  async transcribe(buffer: Buffer, mimeType: string): Promise<string> {
    if (!buffer || buffer.length === 0) {
      throw new Error("Empty audio recording provided.");
    }

    const apiUrl = process.env["TRANSCRIPTION_API_URL"] || process.env["WHISPER_URL"];
    if (apiUrl) {
      const formData = new FormData();
      const blob = new Blob([new Uint8Array(buffer)], { type: mimeType });
      formData.append("file", blob, "audio.webm");

      const response = await fetch(apiUrl, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Transcription service returned HTTP ${response.status}`);
      }

      const data = (await response.json()) as { text?: string };
      if (!data.text?.trim()) {
        throw new Error("Transcription service returned empty speech transcript.");
      }
      return data.text.trim();
    }

    throw new Error(
      "Audio transcription requires either browser speech recognition or a configured TRANSCRIPTION_API_URL / WHISPER_URL (e.g. local Whisper or OpenAI-compatible endpoint).",
    );
  }
}

export type AudioTranscriberFn = (buffer: Buffer, mimeType: string) => Promise<string>;

let audioTranscriber: AudioTranscriber = new DefaultAudioTranscriber();

export function setAudioTranscriber(transcriber: AudioTranscriber | AudioTranscriberFn): void {
  if (typeof transcriber === "function") {
    audioTranscriber = { transcribe: transcriber };
  } else {
    audioTranscriber = transcriber;
  }
}

export function resetAudioTranscriber(): void {
  audioTranscriber = new DefaultAudioTranscriber();
}

export async function transcribeAudio(
  buffer: Buffer,
  mimeType: string,
  clientTranscript?: string | null,
): Promise<string> {
  if (clientTranscript && clientTranscript.trim()) {
    return clientTranscript.trim();
  }
  return audioTranscriber.transcribe(buffer, mimeType);
}
