export { parseWavHeader } from "./core/wav"
export type { WavInfo } from "./core/wav"
export { useSegmentUpload } from "./hooks/use-segment-upload"
export type { PendingSegment, UploadError } from "./hooks/use-segment-upload"

// Transcription providers
export { transcribeWavBuffer as transcribeWithSarvam } from "./providers/sarvam-transcriber"
export { transcribeWavBuffer as transcribeWithSarvamBatch } from "./providers/sarvam-batch-transcriber"
export { transcribeWavBuffer as transcribeWithWhisperLocal } from "./providers/whisper-local-transcriber"
export { transcribeWavBuffer as transcribeWithMedASR } from "./providers/medasr-transcriber"
export {
  resolveTranscriptionProvider,
  resolveFinalTranscriptionProvider,
  transcribeWithResolvedProvider,
  type ResolvedTranscriptionProvider,
  type TranscriptionProvider,
} from "./providers/provider-resolver"

// Default to hosted Sarvam speech-to-text (requires SARVAM_API_KEY)
export { transcribeWavBuffer } from "./providers/sarvam-transcriber"
