import type { NextRequest } from "next/server"
import { runLLMRequest } from "@llm"
import { getGeminiApiKey } from "@storage/server-api-keys"

export const runtime = "nodejs"

const SYSTEM_PROMPT = [
  "You label who is speaking in a doctor–patient medical conversation transcript.",
  "The conversation may be in Hindi, English, or a mix; keep the original language and wording exactly.",
  "For every utterance, decide if the speaker is the Doctor (asks questions, examines, advises, prescribes, reassures) or the Patient (describes symptoms, answers questions, asks about treatment).",
  "Output each utterance on its own line prefixed with exactly 'Doctor:' or 'Patient:'.",
  "Do not translate, summarize, merge turns, or add any commentary.",
].join(" ")

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { transcript?: string }
    const transcript = (body.transcript || "").trim()
    if (!transcript) {
      return Response.json({ turns: [] })
    }

    const apiKey = getGeminiApiKey()
    const labeled = await runLLMRequest({
      system: SYSTEM_PROMPT,
      prompt: `Transcript:\n${transcript}`,
      apiKey,
    })

    const turns: { speaker: string; text: string }[] = []
    for (const raw of labeled.split("\n")) {
      const line = raw.trim()
      if (!line) continue
      const match = line.match(/^\**\s*(Doctor|Patient|Clinician|Physician|Nurse|Provider)\s*\**\s*:\s*(.*)$/i)
      if (match) {
        const speaker = /patient/i.test(match[1]) ? "Patient" : "Doctor"
        const text = match[2].trim()
        if (text) turns.push({ speaker, text })
      } else if (turns.length > 0) {
        turns[turns.length - 1].text += " " + line
      } else {
        turns.push({ speaker: "Unknown", text: line })
      }
    }

    return Response.json({ turns })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Diarization failed"
    return Response.json({ error: message }, { status: 500 })
  }
}
