import { transcribeWavBuffer as transcribeWithSarvamBatch } from "./sarvam-batch-transcriber"
import { transcribeWavBuffer as transcribeWithSarvam } from "./sarvam-transcriber"

export type TranscriptionProvider = "sarvam" | "sarvam_batch"

export interface ResolvedTranscriptionProvider {
  provider: TranscriptionProvider
  model: string
}

const DEFAULT_SARVAM_MODEL = "saarika:v2.5"
const DEFAULT_SARVAM_BATCH_MODEL = "saaras:v3"

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

  // Default: Sarvam synchronous STT — low latency, used for the live segments.
  return {
    provider: "sarvam",
    model: env.SARVAM_MODEL?.trim() || DEFAULT_SARVAM_MODEL,
  }
}

/**
 * Provider for the authoritative full-recording transcription that feeds the
 * medical-note pipeline. Defaults to Sarvam Batch STT (asynchronous, handles
 * recordings of any length + speaker diarization). Override with
 * FINAL_TRANSCRIPTION_PROVIDER (e.g. "sarvam" to force the sync path).
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
    case "sarvam_batch":
      return transcribeWithSarvamBatch(buffer, filename)
    case "sarvam":
    default:
      return transcribeWithSarvam(buffer, filename)
  }
}
