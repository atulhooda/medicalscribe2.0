export const TARGET_SAMPLE_RATE = 16000
export const DEFAULT_SEGMENT_MS = 10000
export const DEFAULT_OVERLAP_MS = 250
export const MIN_FINAL_SEGMENT_MS = 8000

export class StreamingResampler {
  private readonly ratio: number
  private buffer: Float32Array

  constructor(private readonly sourceRate: number, private readonly targetRate: number) {
    const baseRatio = sourceRate / targetRate
    this.ratio = baseRatio > 0 ? baseRatio : 1
    this.buffer = new Float32Array(0)
  }

  process(input: Float32Array): Float32Array {
    if (input.length === 0) {
      return new Float32Array(0)
    }
    const combined = new Float32Array(this.buffer.length + input.length)
    combined.set(this.buffer)
    combined.set(input, this.buffer.length)

    const outputLength = Math.floor(combined.length / this.ratio)
    if (outputLength <= 0) {
      this.buffer = combined
      return new Float32Array(0)
    }

    const output = new Float32Array(outputLength)
    for (let i = 0; i < outputLength; i++) {
      const index = i * this.ratio
      const left = Math.floor(index)
      const right = Math.min(left + 1, combined.length - 1)
      const frac = index - left
      const leftSample = combined[left]
      const rightSample = combined[right]
      output[i] = leftSample + (rightSample - leftSample) * frac
    }

    const consumed = Math.floor(outputLength * this.ratio)
    const remaining = combined.length - consumed
    this.buffer = remaining > 0 ? combined.slice(consumed) : new Float32Array(0)
    return output
  }

  flush(): Float32Array {
    const remaining = this.buffer
    this.buffer = new Float32Array(0)
    return remaining
  }
}

export class SampleBuffer {
  private chunks: { data: Float32Array; offset: number }[] = []
  private totalLength = 0

  push(data: Float32Array) {
    if (data.length === 0) return
    this.chunks.push({ data, offset: 0 })
    this.totalLength += data.length
  }

  prepend(data: Float32Array) {
    if (data.length === 0) return
    this.chunks.unshift({ data, offset: 0 })
    this.totalLength += data.length
  }

  consume(count: number): Float32Array {
    if (count > this.totalLength) {
      throw new Error("Insufficient samples")
    }
    const result = new Float32Array(count)
    let copied = 0
    while (copied < count && this.chunks.length > 0) {
      const chunk = this.chunks[0]
      const available = chunk.data.length - chunk.offset
      const toCopy = Math.min(available, count - copied)
      if (toCopy > 0) {
        result.set(chunk.data.subarray(chunk.offset, chunk.offset + toCopy), copied)
        chunk.offset += toCopy
        copied += toCopy
        if (chunk.offset >= chunk.data.length) {
          this.chunks.shift()
        }
      } else {
        this.chunks.shift()
      }
    }
    this.totalLength -= count
    return result
  }

  drain(): Float32Array {
    if (this.totalLength === 0) {
      return new Float32Array(0)
    }
    const result = new Float32Array(this.totalLength)
    let offset = 0
    for (const chunk of this.chunks) {
      const slice = chunk.data.subarray(chunk.offset)
      result.set(slice, offset)
      offset += slice.length
    }
    this.chunks = []
    this.totalLength = 0
    return result
  }

  clear() {
    this.chunks = []
    this.totalLength = 0
  }

  get length() {
    return this.totalLength
  }
}

export function createWavBlob(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2
  const blockAlign = bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = samples.length * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i))
    }
  }

  writeString(0, "RIFF")
  view.setUint32(4, 36 + dataSize, true)
  writeString(8, "WAVE")
  writeString(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)
  writeString(36, "data")
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    offset += 2
  }

  return new Blob([buffer], { type: "audio/wav" })
}

export type SegmentEmitter = (segment: Float32Array) => void

export function drainSegments(buffer: SampleBuffer, segmentSamples: number, overlapSamples: number, emit: SegmentEmitter) {
  while (buffer.length >= segmentSamples) {
    const samples = buffer.consume(segmentSamples)
    if (overlapSamples > 0) {
      const overlapCopy = samples.slice(segmentSamples - overlapSamples)
      buffer.prepend(overlapCopy)
    }
    emit(samples)
  }
}

export function createFinalSegmentFromRemaining(
  remaining: Float32Array,
  minFinalSamples: number,
  segmentSamples: number,
): Float32Array | null {
  if (remaining.length < minFinalSamples) {
    return null
  }
  const padded = new Float32Array(segmentSamples)
  padded.set(remaining.subarray(0, Math.min(segmentSamples, remaining.length)))
  return padded
}
