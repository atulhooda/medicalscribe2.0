import type { NextRequest } from "next/server"
import { runLLMRequest } from "@llm"
import { getGeminiApiKey } from "@storage/server-api-keys"

export const runtime = "nodejs"

const SYSTEM_PROMPT = [
  "You are a clinical coding assistant. Given a clinical note (and optionally the raw transcript), identify the most relevant ICD-11 codes (WHO ICD-11 for Mortality and Morbidity Statistics, MMS) for the documented problems, symptoms, and diagnoses.",
  "Return one code per line in exactly this pipe-delimited format: CODE | Title | one short reason grounded in the documentation.",
  "Use real ICD-11 stem codes (for example 'CA23' for asthma, 'ME84.2' for pain in limb). Prefer specific diagnoses; include symptom codes when no firm diagnosis is documented.",
  "List at most 8 codes, most relevant first. If nothing is codable, output exactly: NONE.",
  "Do not add headers, numbering, commentary, or markdown code fences.",
].join(" ")

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { note?: string; transcript?: string }
    const note = (body.note || "").trim()
    const transcript = (body.transcript || "").trim()
    if (!note && !transcript) {
      return Response.json({ codes: [] })
    }

    const apiKey = getGeminiApiKey()
    const prompt = [note ? `Clinical note:\n${note}` : "", transcript ? `\nTranscript:\n${transcript}` : ""]
      .join("\n")
      .trim()

    const raw = await runLLMRequest({ system: SYSTEM_PROMPT, prompt, apiKey })

    const codes: { code: string; title: string; rationale: string }[] = []
    for (const line of raw.split("\n")) {
      const cleaned = line.trim().replace(/^[-*\d.]+\s*/, "")
      if (!cleaned || /^none$/i.test(cleaned)) continue
      const parts = cleaned.split("|").map((p) => p.trim())
      if (parts.length < 2) continue
      const code = parts[0].replace(/`/g, "")
      if (!code || !/^[0-9A-Za-z]/.test(code)) continue
      codes.push({ code, title: parts[1] || "", rationale: parts[2] || "" })
    }

    return Response.json({ codes })
  } catch (error) {
    const message = error instanceof Error ? error.message : "ICD suggestion failed"
    return Response.json({ error: message }, { status: 500 })
  }
}
