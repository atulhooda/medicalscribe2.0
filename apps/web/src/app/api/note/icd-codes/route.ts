import type { NextRequest } from "next/server"
import { runLLMRequest } from "@llm"
import { getGeminiApiKey } from "@storage/server-api-keys"

export const runtime = "nodejs"

const SYSTEM_PROMPT = [
  "You are a clinical coding assistant for Indian healthcare. Given a clinical note (and optionally the raw transcript), suggest standardized medical codes for the documented problems, symptoms, and diagnoses across these coding systems:",
  "ICD-11 (WHO ICD-11 for Mortality and Morbidity Statistics); NAMASTE (India's National AYUSH Morbidity & Standardized Terminologies for Ayurveda, Siddha and Unani); SNOMED CT (international clinical terminology); ICD-10 (legacy billing).",
  "Return one code per line in exactly this pipe-delimited format: SYSTEM | CODE | Title | one short reason grounded in the documentation.",
  "SYSTEM must be exactly one of: ICD-11, NAMASTE, SNOMED CT, ICD-10.",
  "Use real codes in each system's correct format (e.g. ICD-11 'CA23' for asthma; ICD-10 'J45.909'; SNOMED CT '195967001'). For NAMASTE, give the closest AYUSH term/code only when clinically appropriate for traditional-medicine documentation.",
  "Group by system (ICD-11 first), most relevant first, at most 3 codes per system. Skip a system if nothing applicable. If nothing is codable at all, output exactly: NONE.",
  "Only include codes you are reasonably confident about. Do not add headers, numbering, commentary, or markdown fences.",
].join(" ")

const SYSTEM_ALIASES: Record<string, string> = {
  "icd-11": "ICD-11",
  icd11: "ICD-11",
  namaste: "NAMASTE",
  "snomed ct": "SNOMED CT",
  "snomed-ct": "SNOMED CT",
  snomed: "SNOMED CT",
  "icd-10": "ICD-10",
  icd10: "ICD-10",
}

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

    const codes: { system: string; code: string; title: string; rationale: string }[] = []
    for (const line of raw.split("\n")) {
      const cleaned = line.trim().replace(/^[-*\d.]+\s*/, "")
      if (!cleaned || /^none$/i.test(cleaned)) continue
      const parts = cleaned.split("|").map((p) => p.trim().replace(/`/g, ""))
      if (parts.length < 3) continue
      const system = SYSTEM_ALIASES[parts[0].toLowerCase()] || parts[0]
      const code = parts[1]
      if (!code) continue
      codes.push({ system, code, title: parts[2] || "", rationale: parts[3] || "" })
    }

    return Response.json({ codes })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Code suggestion failed"
    return Response.json({ error: message }, { status: 500 })
  }
}
