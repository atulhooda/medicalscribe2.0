import { PipelineStageError } from "../../../shared/src/error"

const DEFAULT_SARVAM_URL = "https://api.sarvam.ai/speech-to-text"
const DEFAULT_SARVAM_MODEL = "saarika:v2.5"
// "unknown" lets Sarvam auto-detect the spoken language.
const DEFAULT_SARVAM_LANGUAGE = "unknown"
// Sarvam's sync API rejects audio longer than 30s — chunk below that with headroom.
const MAX_CHUNK_SECONDS = 28

/**
 * HIPAA Compliance: Validate that external endpoints use HTTPS to ensure PHI is encrypted in transit.
 * This prevents accidental misconfiguration that could expose sensitive data.
 */
function validateHttpsUrl(url: string, serviceName: string): void {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "https:") {
      throw new PipelineStageError(
        "configuration_error",
        `SECURITY ERROR: ${serviceName} endpoint must use HTTPS for HIPAA compliance. ` +
        `Received: ${parsed.protocol}//${parsed.host}`,
        false,
      )
    }
  } catch (error) {
    if (error instanceof TypeError) {
      throw new PipelineStageError("configuration_error", `Invalid ${serviceName} URL: ${url}`, false)
    }
    throw error
  }
}

interface WavData {
  offset: number
  size: number
  sampleRate: number
  numChannels: number
  bitDepth: number
}

/** Locate the PCM `data` chunk and read the format so we can slice by time. */
function findWavData(buf: Buffer): WavData | null {
  if (buf.length < 44) return null
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 4) !== "WAVE") return null
  let offset = 12
  let sampleRate = 0
  let numChannels = 0
  let bitDepth = 0
  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString("ascii", offset, offset + 4)
    const chunkSize = buf.readUInt32LE(offset + 4)
    const chunkStart = offset + 8
    if (chunkId === "fmt ") {
      numChannels = buf.readUInt16LE(chunkStart + 2)
      sampleRate = buf.readUInt32LE(chunkStart + 4)
      bitDepth = buf.readUInt16LE(chunkStart + 14)
    } else if (chunkId === "data") {
      return {
        offset: chunkStart,
        size: Math.min(chunkSize, buf.length - chunkStart),
        sampleRate,
        numChannels,
        bitDepth,
      }
    }
    offset = chunkStart + chunkSize + (chunkSize % 2)
  }
  return null
}

/** Wrap raw PCM samples in a standard 44-byte WAV header. */
function buildWav(pcm: Buffer, sampleRate: number, numChannels: number, bitDepth: number): Buffer {
  const blockAlign = numChannels * (bitDepth / 8)
  const byteRate = sampleRate * blockAlign
  const header = Buffer.alloc(44)
  header.write("RIFF", 0, "ascii")
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write("WAVE", 8, "ascii")
  header.write("fmt ", 12, "ascii")
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(numChannels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bitDepth, 34)
  header.write("data", 36, "ascii")
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

async function transcribeChunk(
  wav: Buffer,
  filename: string,
  key: string,
  url: string,
  model: string,
  language: string,
): Promise<string> {
  const formData = new FormData()
  const blob = new Blob([new Uint8Array(wav)], { type: "audio/wav" })
  formData.append("file", blob, filename)
  formData.append("model", model)
  if (language) {
    formData.append("language_code", language)
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      // Sarvam authenticates via a subscription-key header, not a Bearer token.
      "api-subscription-key": key,
    },
    body: formData,
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new PipelineStageError("api_error", `Transcription failed: ${response.status} ${errorText}`, true, {
      status: response.status,
      provider: "sarvam",
    })
  }

  const result = (await response.json()) as { transcript?: string }
  return result.transcript?.trim() ?? ""
}

export async function transcribeWavBuffer(buffer: Buffer, filename: string, apiKey?: string): Promise<string> {
  const sarvamUrl = process.env.SARVAM_URL || DEFAULT_SARVAM_URL
  const sarvamModel = process.env.SARVAM_MODEL || DEFAULT_SARVAM_MODEL
  const sarvamLanguage = process.env.SARVAM_LANGUAGE || DEFAULT_SARVAM_LANGUAGE

  // Validate HTTPS before sending any PHI
  validateHttpsUrl(sarvamUrl, "Sarvam API")

  const key = apiKey || process.env.SARVAM_API_KEY
  if (!key) {
    throw new PipelineStageError(
      "configuration_error",
      "Missing SARVAM_API_KEY. Please configure your API key in Settings.",
      false,
    )
  }

  const info = findWavData(buffer)

  // If we can read the format and the clip is longer than Sarvam's 30s sync
  // limit, split it into ≤28s WAV chunks, transcribe each, and stitch together.
  if (info && info.sampleRate > 0 && info.numChannels > 0 && info.bitDepth > 0) {
    const frameSize = info.numChannels * (info.bitDepth / 8)
    const bytesPerSecond = info.sampleRate * frameSize
    const durationSeconds = info.size / bytesPerSecond

    if (durationSeconds > MAX_CHUNK_SECONDS) {
      const maxChunkBytes = Math.floor((MAX_CHUNK_SECONDS * bytesPerSecond) / frameSize) * frameSize
      const pcm = buffer.subarray(info.offset, info.offset + info.size)
      const parts: string[] = []
      for (let start = 0; start < pcm.length; start += maxChunkBytes) {
        const chunkPcm = pcm.subarray(start, Math.min(start + maxChunkBytes, pcm.length))
        const chunkWav = buildWav(chunkPcm, info.sampleRate, info.numChannels, info.bitDepth)
        const partIndex = Math.floor(start / maxChunkBytes) + 1
        const text = await transcribeChunk(
          chunkWav,
          filename.replace(/\.wav$/i, `-part${partIndex}.wav`),
          key,
          sarvamUrl,
          sarvamModel,
          sarvamLanguage,
        )
        if (text) parts.push(text)
      }
      return parts.join(" ").trim()
    }
  }

  // Short clip (or unparseable header) — send in a single request.
  return transcribeChunk(buffer, filename, key, sarvamUrl, sarvamModel, sarvamLanguage)
}
