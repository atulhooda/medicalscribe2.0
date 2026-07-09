import assert from "node:assert/strict"
import test from "node:test"
import {
  resolveFinalTranscriptionProvider,
  resolveTranscriptionProvider,
} from "../providers/provider-resolver.js"

test("resolveTranscriptionProvider defaults to sarvam with saarika model", () => {
  const resolved = resolveTranscriptionProvider({})
  assert.equal(resolved.provider, "sarvam")
  assert.equal(resolved.model, "saarika:v2.5")
})

test("resolveTranscriptionProvider resolves the batch provider", () => {
  assert.equal(resolveTranscriptionProvider({ TRANSCRIPTION_PROVIDER: "sarvam" }).provider, "sarvam")
  const batch = resolveTranscriptionProvider({ TRANSCRIPTION_PROVIDER: "sarvam_batch" })
  assert.equal(batch.provider, "sarvam_batch")
  assert.equal(batch.model, "saaras:v3")
})

test("resolveFinalTranscriptionProvider defaults to Sarvam Batch STT", () => {
  assert.equal(resolveFinalTranscriptionProvider({}).provider, "sarvam_batch")
  // Explicit override forces the synchronous path.
  assert.equal(
    resolveFinalTranscriptionProvider({ FINAL_TRANSCRIPTION_PROVIDER: "sarvam" }).provider,
    "sarvam",
  )
})
