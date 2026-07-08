import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SarvamAIClient } from "sarvamai"
import { PipelineStageError } from "../../../shared/src/error"

/**
 * Sarvam AI Batch Speech-to-Text provider.
 *
 * Unlike the synchronous endpoint (30s hard cap), the Batch API handles long
 * recordings (up to ~2h) via an asynchronous job: create → upload → start →
 * poll → download. We drive it through the official `sarvamai` Node SDK
 * (SarvamAIClient.speechToTextJob), which manages the underlying cloud-storage
 * upload/download for us.
 *
 * The public signature matches every other transcriber
 * (transcribeWavBuffer(buffer, filename, apiKey?) => Promise<string>) so it
 * plugs into the existing provider resolver with zero downstream changes.
 */

const DEFAULT_MODEL = "saaras:v3"
const DEFAULT_MODE = "transcribe"
const DEFAULT_LANGUAGE = "unknown" // auto-detect

function num(value: string | undefined, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function log(message: string): void {
  console.log(`[sarvam-batch] ${message}`)
}

async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      const message = error instanceof Error ? error.message : String(error)
      log(`${label} attempt ${attempt}/${attempts} failed: ${message}`)
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt))
      }
    }
  }
  throw lastError
}

interface SarvamOutput {
  transcript?: string
  diarized_transcript?: { entries?: Array<{ transcript?: string; speaker_id?: string }> }
}

function extractTranscript(data: SarvamOutput): string {
  if (typeof data.transcript === "string" && data.transcript.trim()) {
    return data.transcript.trim()
  }
  const entries = data.diarized_transcript?.entries
  if (Array.isArray(entries)) {
    return entries
      .map((entry) => (entry?.transcript || "").trim())
      .filter(Boolean)
      .join(" ")
      .trim()
  }
  return ""
}

export async function transcribeWavBuffer(buffer: Buffer, filename: string, apiKey?: string): Promise<string> {
  const key = (apiKey || process.env.SARVAM_API_KEY || "").trim()
  if (!key) {
    throw new PipelineStageError(
      "configuration_error",
      "Missing SARVAM_API_KEY. Please configure your API key in Settings.",
      false,
    )
  }

  const model = process.env.SARVAM_BATCH_MODEL || DEFAULT_MODEL
  const mode = process.env.SARVAM_BATCH_MODE || DEFAULT_MODE
  const languageCode = process.env.SARVAM_BATCH_LANGUAGE || process.env.SARVAM_LANGUAGE || DEFAULT_LANGUAGE
  const diarization = (process.env.SARVAM_BATCH_DIARIZATION ?? "true").toLowerCase() !== "false"
  const numSpeakers = num(process.env.SARVAM_BATCH_NUM_SPEAKERS, 2)
  const pollIntervalSeconds = num(process.env.SARVAM_BATCH_POLL_INTERVAL_SECONDS, 5)
  const timeoutSeconds = num(process.env.SARVAM_BATCH_TIMEOUT_SECONDS, 600)

  const client = new SarvamAIClient({ apiSubscriptionKey: key })

  const workDir = await mkdtemp(join(tmpdir(), "sarvam-batch-"))
  const safeName = /\.wav$/i.test(filename) ? filename.replace(/[^\w.-]/g, "_") : "audio.wav"
  const inputPath = join(workDir, safeName)
  const outputDir = join(workDir, "output")

  try {
    await writeFile(inputPath, buffer)
    await mkdir(outputDir, { recursive: true })

    log(`creating job (model=${model}, mode=${mode}, language=${languageCode}, diarization=${diarization})`)
    const job = await withRetry("createJob", () =>
      client.speechToTextJob.createJob({
        model,
        // `mode` only applies to the saaras:* family.
        mode: model.startsWith("saaras") ? mode : undefined,
        languageCode,
        withDiarization: diarization,
        numSpeakers: diarization ? numSpeakers : undefined,
        // Values come from env/config; the API accepts these strings at runtime.
      } as unknown as Parameters<typeof client.speechToTextJob.createJob>[0]),
    )
    log(`job created: ${job.jobId}`)

    await withRetry("uploadFiles", () => job.uploadFiles([inputPath]))
    log("audio uploaded")

    await withRetry("start", () => job.start())
    log("job started; polling until complete")

    const status = await job.waitUntilComplete(pollIntervalSeconds, timeoutSeconds)
    const state = (status as { job_state?: string })?.job_state ?? "unknown"
    log(`job finished with state: ${state}`)

    const succeeded = await job.isSuccessful().catch(() => true)
    if (!succeeded) {
      let detail = "Batch job did not complete successfully"
      try {
        const results = await job.getFileResults()
        detail = results.failed?.[0]?.error_message || detail
      } catch {
        // ignore — use generic detail
      }
      throw new PipelineStageError("api_error", `Sarvam batch transcription failed: ${detail}`, true, {
        provider: "sarvam_batch",
      })
    }

    await withRetry("downloadOutputs", () => job.downloadOutputs(outputDir))
    log("outputs downloaded")

    const files = (await readdir(outputDir)).filter((name) => name.toLowerCase().endsWith(".json"))
    const parts: string[] = []
    for (const name of files) {
      try {
        const raw = await readFile(join(outputDir, name), "utf-8")
        const text = extractTranscript(JSON.parse(raw) as SarvamOutput)
        if (text) parts.push(text)
      } catch (error) {
        log(`failed to parse output ${name}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    const transcript = parts.join(" ").trim()
    log(`transcript assembled (${transcript.length} chars from ${files.length} output file(s))`)
    return transcript
  } catch (error) {
    if (error instanceof PipelineStageError) throw error
    const message = error instanceof Error ? error.message : "Sarvam batch transcription failed"
    // waitUntilComplete throws a plain Error on timeout — surface it as recoverable.
    const isTimeout = /timeout|timed out/i.test(message)
    log(`error: ${message}`)
    throw new PipelineStageError(
      isTimeout ? "timeout_error" : "api_error",
      `Sarvam batch transcription failed: ${message}`,
      true,
      { provider: "sarvam_batch" },
    )
  } finally {
    // Always clean up temp audio + outputs (may contain PHI).
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}
