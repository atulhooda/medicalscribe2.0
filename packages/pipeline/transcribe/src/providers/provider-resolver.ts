import { transcribeWavBuffer as transcribeWithMedASR } from "./medasr-transcriber"
import { transcribeWavBuffer as transcribeWithSarvamBatch } from "./sarvam-batch-transcriber"
import { transcribeWavBuffer as transcribeWithSarvam } from "./sarvam-transcriber"
import { transcribeWavBuffer as transcribeWithWhisperLocal } from "./whisper-local-transcriber"

export type TranscriptionProvider = "sarvam" | "sarvam_batch" | "whisper_local" | "medasr"

export interface ResolvedTranscriptionProvider {
  provider: TranscriptionProvider
  model: string
}

const DEFAULT_SARVAM_MODEL = "saarika:v2.5"
const DEFAULT_SARVAM_BATCH_MODEL = "saaras:v3"
const DEFAULT_WHISPER_LOCAL_MODEL = "tiny.en"
const DEFAULT_MEDASR_MODEL = "medasr"

function normalizeProvider(rawProvider: string | undefined): string {
  return rawProvider?.trim().toLowerCase() || ""
}

export function resolveTranscriptionProvider(env: NodeJS.ProcessEnv = process.env): ResolvedTranscriptionProvider {
  const provider = normalizeProvider(env.TRANSCRIPTION_PROVIDER)

  if (provider === "sarvam_batch" || provider === "sarvam-batch" || provider === "batch") {
    return {
      provider: "sarvam_batch",
      model: env.SARVAM_BATCH_MODEL?.trim() || DEFAULT_SARVAM_BATCH_MODEL,
    }
  }

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

  // Default: Sarvam synchronous STT — low latency, used for the live segments.
  return {
    provider: "sarvam",
    model: env.SARVAM_MODEL?.trim() || DEFAULT_SARVAM_MODEL,
  }
}

/**
 * Provider for the authoritative full-recording transcription that feeds the
 * medical-note pipeline. Defaults to Sarvam Batch STT (asynchronous, handles
 * recordings of any length + speaker diarization). Override the whole recording
 * path with FINAL_TRANSCRIPTION_PROVIDER (e.g. "sarvam" to force the sync path).
 */
export function resolveFinalTranscriptionProvider(
  env: NodeJS.ProcessEnv = process.env,
): ResolvedTranscriptionProvider {
  const override = normalizeProvider(env.FINAL_TRANSCRIPTION_PROVIDER) || "sarvam_batch"
  return resolveTranscriptionProvider({ ...env, TRANSCRIPTION_PROVIDER: override })
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
    case "sarvam_batch":
      return transcribeWithSarvamBatch(buffer, filename)
    case "sarvam":
    default:
      return transcribeWithSarvam(buffer, filename)
  }
}
