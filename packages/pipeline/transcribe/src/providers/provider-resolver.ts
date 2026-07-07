import { transcribeWavBuffer as transcribeWithMedASR } from "./medasr-transcriber"
import { transcribeWavBuffer as transcribeWithSarvam } from "./sarvam-transcriber"
import { transcribeWavBuffer as transcribeWithWhisperLocal } from "./whisper-local-transcriber"

export type TranscriptionProvider = "sarvam" | "whisper_local" | "medasr"

export interface ResolvedTranscriptionProvider {
  provider: TranscriptionProvider
  model: string
}

const DEFAULT_SARVAM_MODEL = "saarika:v2.5"
const DEFAULT_WHISPER_LOCAL_MODEL = "tiny.en"
const DEFAULT_MEDASR_MODEL = "medasr"

function normalizeProvider(rawProvider: string | undefined): string {
  return rawProvider?.trim().toLowerCase() || ""
}

export function resolveTranscriptionProvider(env: NodeJS.ProcessEnv = process.env): ResolvedTranscriptionProvider {
  const provider = normalizeProvider(env.TRANSCRIPTION_PROVIDER)

  if (provider === "medasr" || provider === "med_asr") {
    return {
      provider: "medasr",
      model: env.MEDASR_MODEL?.trim() || DEFAULT_MEDASR_MODEL,
    }
  }

  if (provider === "whisper_local" || provider === "whisper-local" || provider === "local") {
    return {
      provider: "whisper_local",
      model: env.WHISPER_LOCAL_MODEL?.trim() || DEFAULT_WHISPER_LOCAL_MODEL,
    }
  }

  // Default: Sarvam hosted speech-to-text.
  return {
    provider: "sarvam",
    model: env.SARVAM_MODEL?.trim() || DEFAULT_SARVAM_MODEL,
  }
}

export async function transcribeWithResolvedProvider(
  buffer: Buffer,
  filename: string,
  resolved: ResolvedTranscriptionProvider = resolveTranscriptionProvider(),
): Promise<string> {
  switch (resolved.provider) {
    case "medasr":
      return transcribeWithMedASR(buffer, filename)
    case "whisper_local":
      return transcribeWithWhisperLocal(buffer, filename)
    case "sarvam":
    default:
      return transcribeWithSarvam(buffer, filename)
  }
}
