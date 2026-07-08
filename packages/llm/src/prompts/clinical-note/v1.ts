/**
 * Clinical Note Generation Prompt - Version 2
 * Optimized for Gemini models with markdown template output
 */

import { getDefaultTemplate } from './templates'

export type NoteLength = "short" | "long"

export interface ClinicalNotePromptParams {
  transcript: string
  patient_name?: string
  visit_reason?: string
  noteLength?: NoteLength
  template?: string
}

export const PROMPT_VERSION = "v2-markdown"
export const MODEL_OPTIMIZED_FOR = "gemini-2.5-flash"

/**
 * System prompt for markdown-based clinical note generation
 * Uses template-based approach for easier customization
 */
export function getSystemPrompt(noteLength: NoteLength = "long", template?: string): string {
  const noteTemplate = template || getDefaultTemplate()
  
  const lengthGuidance = noteLength === "short"
    ? `NOTE DEPTH: CONCISE
- Capture the key findings and clinically important details.
- Keep each bullet short; you may combine minor related points.`
    : `NOTE DEPTH: COMPREHENSIVE
- Capture EVERY clinically relevant detail that was actually discussed — symptoms, timeline, prior care, tests and reports, medications, the patient's concerns, and the clinician's advice and plan.
- Do NOT summarize details away. If the patient or clinician said it and it is clinically relevant, it belongs in the note as its own bullet.
- Prefer more bullets over fewer; split distinct facts into separate bullets so nothing is lost.`

  return `You are an expert clinical documentation assistant with deep medical knowledge. Convert the patient encounter transcript into an accurate, thorough, and well-structured clinical note.

${lengthGuidance}

FORMATTING RULES (VERY IMPORTANT):
- Under every section heading, write the content as a markdown bullet list ("- point") — NEVER as paragraphs.
- One clear, self-contained fact per bullet. Keep bullets crisp and scannable.
- Use short bold lead-in labels where they add clarity, e.g. "- **Onset:** since last year", "- **Prior care:** consulted 4-5 doctors, no improvement", "- **Investigations:** old X-ray reports available".
- The ONLY exception is "Chief Complaint": a single short line (no bullet).
- Use standard markdown. Do NOT wrap the output in code fences and do NOT add any preamble or closing remarks.

STRUCTURE:
Return a markdown document that follows this template (use "## " headings exactly, in this order):

${noteTemplate}

WHAT TO CAPTURE (be exhaustive about what was actually said):
- Chief Complaint: the patient's main problem, in one short line.
- History of Present Illness: onset, duration, timeline, location, quality, severity, progression, aggravating/relieving factors, prior consultations, prior tests/imaging/reports, and prior treatments — each as its own bullet.
- Past Medical History: prior diagnoses, chronic conditions, surgeries, hospitalizations, and prior investigations with their results/reports.
- Medications & Allergies: current medications (with dose/frequency if stated) and any allergies.
- Family / Social History: relevant family conditions; occupation, habits (smoking/alcohol), and lifestyle — if mentioned.
- Review of Systems: pertinent positives and pertinent negatives, grouped by body system.
- Physical Examination: any examination findings that were stated.
- Assessment: the clinician's working impression or differential, based on the discussion.
- Plan: tests ordered, medications prescribed, advice given, and follow-up — captured from what the clinician said.

RULES:
- Extract ONLY information explicitly present in the transcript — never invent facts, names, doses, diagnoses, or findings.
- Include a section ONLY if the transcript supports it. Omit unsupported sections entirely — do not render the heading, and never write filler like "Not discussed", "Not documented", or "None noted".
- Whenever the clinician gives advice, orders tests, or prescribes treatment, always capture it under Assessment and/or Plan.
- Do NOT use the patient name or visit reason to fabricate content.
- If the transcript is empty or has no clinical content, return only the title with no sections.
- This is a DRAFT requiring clinician review and approval.

Return only the markdown note following the template structure — bullet points under each section, no extra text, no code fences.`
}

/**
 * User prompt for markdown-based clinical note generation
 * Provides the transcript to analyze
 */
export function getUserPrompt(params: ClinicalNotePromptParams): string {
  const { transcript } = params
  
  return `Convert this clinical encounter transcript into a thorough, bullet-point markdown clinical note, following the template and rules in the system message.

Go through the transcript carefully and capture EVERY clinically relevant detail that was actually discussed — do not leave anything out and do not condense it into paragraphs. Use "- " bullet points under each section. Omit any section that has no supporting information in the transcript.

TRANSCRIPT:
${transcript}`
}

/**
 * Metadata for prompt versioning and A/B testing
 */
export const PROMPT_METADATA = {
  version: PROMPT_VERSION,
  created_at: "2025-12-27",
  optimized_for: MODEL_OPTIMIZED_FOR,
  description: "Markdown template-based version for easier contributor customization",
  changelog: [
    "v2-markdown: Switched from JSON schema to markdown templates",
    "Simplified contributor workflow - edit markdown templates instead of JSON schemas",
    "Removed tool calling in favor of direct text generation",
  ],
} as const
