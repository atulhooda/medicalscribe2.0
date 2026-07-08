"use client"

import { useState, useEffect, useRef, type ReactNode } from "react"
import type { Encounter } from "@storage/types"
import { Button } from "@ui/lib/ui/button"
import { Textarea } from "@ui/lib/ui/textarea"
import { Badge } from "@ui/lib/ui/badge"
import { ScrollArea } from "@ui/lib/ui/scroll-area"
import { Save, Copy, Download, Check, AlertTriangle, Send, X, MessageSquare, Loader2, Eye, Pencil, Users, Printer, Sparkles } from "lucide-react"
import { format } from "date-fns"
import { cn } from "@ui/lib/utils"

const VISIT_TYPE_LABELS: Record<string, string> = {
  history_physical: "History & Physical",
  problem_visit: "Problem Visit",
  consult_note: "Consult Note",
}

/* ---------------------------------------------------------------------------
   Clinical note renderer — turns the LLM's markdown into styled Engageo cards.
   Self-contained (no markdown dependency): handles ## sections, ### subheads,
   - bullets, **bold**, `code`, and "Label: value" lines.
--------------------------------------------------------------------------- */

type NoteBlock =
  | { kind: "subheading"; text: string }
  | { kind: "bullets"; items: string[] }
  | { kind: "paragraph"; text: string }

function renderInline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean)
  return parts.map((part, i) => {
    const bold = part.match(/^\*\*([^*]+)\*\*$/)
    if (bold) {
      return (
        <strong key={i} className="font-semibold text-foreground">
          {bold[1]}
        </strong>
      )
    }
    const code = part.match(/^`([^`]+)`$/)
    if (code) {
      return (
        <code key={i} className="rounded bg-secondary px-1 py-0.5 font-mono text-[0.85em]">
          {code[1]}
        </code>
      )
    }
    return <span key={i}>{part}</span>
  })
}

function parseNoteBlocks(body: string): NoteBlock[] {
  const blocks: NoteBlock[] = []
  let para: string[] = []
  let bullets: string[] = []
  const flushPara = () => {
    if (para.length) {
      blocks.push({ kind: "paragraph", text: para.join(" ") })
      para = []
    }
  }
  const flushBullets = () => {
    if (bullets.length) {
      blocks.push({ kind: "bullets", items: bullets })
      bullets = []
    }
  }
  for (const raw of body.split("\n")) {
    const line = raw.trim()
    if (!line) {
      flushPara()
      flushBullets()
      continue
    }
    const sub = line.match(/^#{3,6}\s+(.+)$/)
    const bullet = line.match(/^[-*]\s+(.+)$/)
    if (sub) {
      flushPara()
      flushBullets()
      blocks.push({ kind: "subheading", text: sub[1] })
      continue
    }
    if (bullet) {
      flushPara()
      bullets.push(bullet[1])
      continue
    }
    flushBullets()
    para.push(line)
  }
  flushPara()
  flushBullets()
  return blocks
}

function NoteBlocks({ body }: { body: string }) {
  const blocks = parseNoteBlocks(body)
  if (blocks.length === 0) {
    return <p className="text-[15px] leading-relaxed text-muted-foreground">—</p>
  }
  return (
    <div className="space-y-3">
      {blocks.map((block, i) => {
        if (block.kind === "subheading") {
          return (
            <p key={i} className="pt-1 font-display text-sm font-semibold text-foreground">
              {renderInline(block.text)}
            </p>
          )
        }
        if (block.kind === "bullets") {
          return (
            <ul key={i} className="space-y-1.5">
              {block.items.map((item, j) => (
                <li key={j} className="flex gap-2.5 text-[14.5px] leading-[1.75] text-foreground/90">
                  <span className="mt-[0.6em] h-1 w-1 shrink-0 rounded-full bg-primary/60" />
                  <span>{renderInline(item)}</span>
                </li>
              ))}
            </ul>
          )
        }
        const label = block.text.match(/^([A-Z][A-Za-z0-9 &/()'-]{1,48}?):\s+([\s\S]+)$/)
        if (label) {
          return (
            <p key={i} className="text-[14.5px] leading-[1.75] text-foreground/90">
              <strong className="font-semibold text-foreground">{label[1]}:</strong> {renderInline(label[2])}
            </p>
          )
        }
        return (
          <p key={i} className="text-[14.5px] leading-[1.75] text-foreground/90">
            {renderInline(block.text)}
          </p>
        )
      })}
    </div>
  )
}

// Canonical clinical section names we recognize — used to split notes into
// cards even when the LLM writes "**Chief Complaint:** ..." instead of "## ".
const KNOWN_SECTIONS = [
  "Chief Complaint",
  "History of Present Illness",
  "HPI",
  "Review of Systems",
  "ROS",
  "Past Medical History",
  "PMH",
  "Past Surgical History",
  "Medications",
  "Current Medications",
  "Allergies",
  "Family History",
  "Social History",
  "Physical Exam",
  "Physical Examination",
  "Vitals",
  "Vital Signs",
  "Objective",
  "Subjective",
  "Assessment",
  "Assessment and Plan",
  "Impression",
  "Diagnosis",
  "Plan",
  "Labs",
  "Results",
  "Imaging",
  "Disposition",
  "Follow-up",
  "Follow Up",
]

function detectSectionLabel(line: string): { title: string; rest: string } | null {
  const cleaned = line
    .replace(/^\s*[-*]\s+/, "")
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .trim()
  const match = cleaned.match(/^([A-Za-z][A-Za-z /&-]{2,48}?):\s*(.*)$/)
  if (!match) return null
  const canonical = KNOWN_SECTIONS.find((s) => s.toLowerCase() === match[1].trim().toLowerCase())
  if (!canonical) return null
  return { title: canonical, rest: match[2].trim() }
}

function splitNoteSections(markdown: string): { title: string | null; body: string }[] {
  const sections: { title: string | null; body: string }[] = []
  let title: string | null = null
  let buffer: string[] = []
  const flush = () => {
    const body = buffer.join("\n").trim()
    if (title !== null || body.length > 0) sections.push({ title, body })
    buffer = []
  }
  for (const line of markdown.split("\n")) {
    const h1 = line.match(/^#\s+(.+?)\s*$/)
    if (h1) continue // skip the "# Clinical Note" title
    const h2 = line.match(/^##+\s+(.+?)\s*$/)
    if (h2) {
      flush()
      title = h2[1].trim()
      continue
    }
    const label = detectSectionLabel(line)
    if (label) {
      flush()
      title = label.title
      buffer = label.rest ? [label.rest] : []
      continue
    }
    buffer.push(line)
  }
  flush()
  return sections
}

function ReportField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-sm font-medium text-foreground">{value || "—"}</dd>
    </div>
  )
}

type MedicalCode = { system: string; code: string; title: string; rationale?: string }

function systemChipClass(system: string): string {
  switch (system) {
    case "ICD-11":
      return "bg-primary/10 text-primary ring-primary/20"
    case "NAMASTE":
      return "bg-amber-100 text-amber-700 ring-amber-300/50"
    case "SNOMED CT":
      return "bg-emerald-100 text-emerald-700 ring-emerald-300/50"
    case "ICD-10":
      return "bg-secondary text-muted-foreground ring-border"
    default:
      return "bg-muted text-muted-foreground ring-border"
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

function inlineToHtml(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
}

function bodyToHtml(body: string): string {
  return parseNoteBlocks(body)
    .map((block) => {
      if (block.kind === "subheading") return `<p class="sub">${inlineToHtml(block.text)}</p>`
      if (block.kind === "bullets") return `<ul>${block.items.map((it) => `<li>${inlineToHtml(it)}</li>`).join("")}</ul>`
      return `<p>${inlineToHtml(block.text)}</p>`
    })
    .join("")
}

// Build a standalone, print-ready HTML document of the report (for "Export → PDF").
function buildReportHtml(encounter: Encounter, markdown: string, icdCodes: MedicalCode[] | null): string {
  const created = new Date(encounter.created_at)
  const visitLabel = encounter.visit_reason
    ? VISIT_TYPE_LABELS[encounter.visit_reason] || encounter.visit_reason
    : "Clinical Note"
  const sections = splitNoteSections((markdown || "").trim()).filter((s) => s.title !== null || s.body.length > 0)
  const dateStr = format(created, "MMMM d, yyyy 'at' h:mm a")

  const sectionsHtml = sections
    .map(
      (s, i) =>
        `<section>${
          s.title ? `<h3><span class="num">${String(i + 1).padStart(2, "0")}</span> ${escapeHtml(s.title)}</h3>` : ""
        }<div class="body">${bodyToHtml(s.body)}</div></section>`,
    )
    .join("")

  const icdHtml =
    icdCodes && icdCodes.length > 0
      ? `<section><h3><span class="num">RX</span> Suggested Medical Codes</h3><table class="icd"><thead><tr><th>System</th><th>Code</th><th>Title</th><th>Rationale</th></tr></thead><tbody>${icdCodes
          .map(
            (c) =>
              `<tr><td class="sys">${escapeHtml(c.system)}</td><td class="code">${escapeHtml(c.code)}</td><td>${escapeHtml(
                c.title,
              )}</td><td>${escapeHtml(c.rationale || "")}</td></tr>`,
          )
          .join(
            "",
          )}</tbody></table><p class="disclaimer">AI-suggested across ICD-11, NAMASTE, SNOMED CT &amp; ICD-10 — verify against each official source before clinical or billing use.</p></section>`
      : ""

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(
    encounter.patient_name || "Clinical Report",
  )} — Clinical Report</title><style>
*{box-sizing:border-box}
body{font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f0d0b;margin:0;padding:40px;background:#fff}
.sheet{max-width:760px;margin:0 auto}
.stripe{display:flex;height:3px;width:56px;margin-bottom:12px}.stripe span{flex:1}.stripe span:nth-child(1){background:#e8552a}.stripe span:nth-child(2){background:#3d5afe}.stripe span:nth-child(3){background:#0f0d0b}
header{border-bottom:2px solid #0f0d0b;padding-bottom:16px;display:flex;justify-content:space-between;align-items:flex-start;gap:24px}
.brand h1{font-size:20px;margin:0;font-weight:700;letter-spacing:-.02em}.brand p{margin:2px 0 0;font-size:12px;color:#6b6560}
.meta{text-align:right}.meta .label{font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#6b6560;font-family:ui-monospace,monospace}.meta .date{font-size:13px;margin-top:4px}
dl.demo{display:grid;grid-template-columns:repeat(3,1fr);gap:12px 24px;border-bottom:1px solid #e4ddd5;padding:16px 0;margin:0}
dl.demo dt{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:#6b6560;font-family:ui-monospace,monospace}
dl.demo dd{margin:2px 0 0;font-size:14px;font-weight:500}
section{margin-top:22px;page-break-inside:avoid}
h3{font-size:12.5px;text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid #e4ddd5;padding-bottom:5px;margin:0 0 10px}h3 .num{font-family:ui-monospace,monospace;color:#3d5afe}
.body p{font-size:14px;line-height:1.7;margin:0 0 8px;color:#1b1815}.body p.sub{font-weight:600}
.body ul{margin:0 0 8px;padding-left:18px}.body li{font-size:14px;line-height:1.7}
table.icd{width:100%;border-collapse:collapse;margin-top:4px}
table.icd th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#6b6560;border-bottom:1px solid #e4ddd5;padding:6px 8px}
table.icd td{font-size:13px;padding:7px 8px;border-bottom:1px solid #f0ece6;vertical-align:top}table.icd td.code{font-family:ui-monospace,monospace;font-weight:600;color:#2339c4;white-space:nowrap}table.icd td.sys{font-family:ui-monospace,monospace;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:#6b6560;white-space:nowrap}
.disclaimer{font-size:11px;color:#6b6560;margin-top:8px;font-style:italic}
footer{border-top:1px solid #e4ddd5;margin-top:28px;padding-top:12px;font-size:11px;color:#6b6560;display:flex;justify-content:space-between}
@media print{body{padding:0}@page{margin:18mm}}
</style></head><body><div class="sheet"><header><div class="brand"><div class="stripe"><span></span><span></span><span></span></div><h1>Engageo Scribe</h1><p>Clinical Documentation</p></div><div class="meta"><div class="label">Clinical Report</div><div class="date">${escapeHtml(
    dateStr,
  )}</div></div></header><dl class="demo"><div><dt>Patient</dt><dd>${escapeHtml(
    encounter.patient_name || "Unknown Patient",
  )}</dd></div><div><dt>MRN</dt><dd>${escapeHtml(
    encounter.patient_id || "—",
  )}</dd></div><div><dt>Visit Type</dt><dd>${escapeHtml(
    visitLabel,
  )}</dd></div></dl>${sectionsHtml}${icdHtml}<footer><span>Generated by Engageo Scribe · Draft for clinician review</span><span>${escapeHtml(
    encounter.id.slice(0, 8),
  )}</span></footer></div></body></html>`
}

interface ClinicalNoteViewProps {
  markdown: string
  encounter: Encounter
  icdCodes: MedicalCode[] | null
  icdLoading: boolean
  icdError: string
  onSuggestIcd: () => void
}

function ClinicalNoteView({ markdown, encounter, icdCodes, icdLoading, icdError, onSuggestIcd }: ClinicalNoteViewProps) {
  const trimmed = markdown.trim()
  const created = new Date(encounter.created_at)
  const visitLabel = encounter.visit_reason
    ? VISIT_TYPE_LABELS[encounter.visit_reason] || encounter.visit_reason
    : "Clinical Note"
  const sections = trimmed
    ? splitNoteSections(trimmed).filter((s) => s.title !== null || s.body.length > 0)
    : []

  return (
    <div className="mx-auto max-w-[820px] pb-10">
      <article className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_1px_3px_rgba(15,13,11,0.05),0_30px_60px_-30px_rgba(15,13,11,0.30)]">
        {/* Letterhead */}
        <header className="border-b-2 border-foreground/80 px-6 pb-5 pt-8 sm:px-12">
          <div className="flex items-start justify-between gap-6">
            <div>
              <div className="stripe-bar mb-3 w-14">
                <span />
                <span />
                <span />
              </div>
              <h1 className="font-display text-lg font-bold tracking-tight text-foreground">Engageo Scribe</h1>
              <p className="mt-0.5 text-xs text-muted-foreground">Clinical Documentation</p>
            </div>
            <div className="text-right">
              <span className="section-label justify-end">Clinical Report</span>
              <p className="mt-2 text-sm font-medium text-foreground">{format(created, "MMMM d, yyyy")}</p>
              <p className="text-xs text-muted-foreground">{format(created, "h:mm a")}</p>
            </div>
          </div>
        </header>

        {/* Patient demographics */}
        <dl className="grid grid-cols-2 gap-x-8 gap-y-4 border-b border-border px-6 py-6 sm:grid-cols-3 sm:px-12">
          <ReportField label="Patient" value={encounter.patient_name || "Unknown Patient"} />
          <ReportField label="MRN" value={encounter.patient_id || ""} />
          <ReportField label="Visit Type" value={visitLabel} />
        </dl>

        {/* Report body */}
        <div className="px-6 pb-10 pt-8 sm:px-12">
          {sections.length === 0 ? (
            <p className="text-sm text-muted-foreground">No clinical note yet.</p>
          ) : (
            <div className="space-y-7">
              {sections.map((section, i) => (
                <section key={i}>
                  {section.title && (
                    <h3 className="flex items-baseline gap-2.5 border-b border-border pb-1.5 font-display text-[12.5px] font-semibold uppercase tracking-[0.09em] text-foreground">
                      <span className="font-mono text-primary">{String(i + 1).padStart(2, "0")}</span>
                      <span>{section.title}</span>
                    </h3>
                  )}
                  <div className={cn(section.title && "mt-3")}>
                    <NoteBlocks body={section.body} />
                  </div>
                </section>
              ))}
            </div>
          )}

          {/* AI multi-system medical coding */}
          <section className="mt-8 border-t border-border pt-6">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="flex items-baseline gap-2.5 font-display text-[12.5px] font-semibold uppercase tracking-[0.09em] text-foreground">
                  <span className="font-mono text-primary">RX</span>
                  <span>Suggested Medical Codes</span>
                </h3>
                <p className="mt-1 text-[11px] text-muted-foreground">ICD-11 · NAMASTE · SNOMED CT · ICD-10</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={onSuggestIcd}
                disabled={icdLoading || !trimmed}
                className="h-8 rounded-full px-3"
              >
                {icdLoading ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-1.5 h-4 w-4" />
                )}
                <span className="text-xs">
                  {icdLoading ? "Detecting..." : icdCodes ? "Regenerate" : "Suggest codes"}
                </span>
              </Button>
            </div>

            {icdError && (
              <div className="mb-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{icdError}</span>
              </div>
            )}

            {icdCodes === null ? (
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                Let AI detect the relevant codes for the documented problems across ICD-11, NAMASTE, SNOMED CT and ICD-10.
              </p>
            ) : icdCodes.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">No codable conditions detected.</p>
            ) : (
              <>
                <div className="overflow-hidden rounded-xl border border-border">
                  {icdCodes.map((c, i) => (
                    <div key={i} className={cn("px-4 py-3", i > 0 && "border-t border-border/70")}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset",
                            systemChipClass(c.system),
                          )}
                        >
                          {c.system}
                        </span>
                        <span className="font-mono text-[13px] font-semibold text-foreground">{c.code}</span>
                        <span className="text-sm text-foreground">{c.title}</span>
                      </div>
                      {c.rationale && (
                        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{c.rationale}</p>
                      )}
                    </div>
                  ))}
                </div>
                <p className="mt-2.5 text-[11px] italic text-muted-foreground">
                  AI-suggested — verify each against its official source (ICD-11 / NAMASTE / SNOMED CT / ICD-10) before clinical or billing use.
                </p>
              </>
            )}
          </section>
        </div>

        {/* Footer */}
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-secondary/30 px-6 py-4 sm:px-12">
          <p className="text-[11px] text-muted-foreground">Generated by Engageo Scribe · Draft for clinician review</p>
          <p className="font-mono text-[11px] text-muted-foreground/70">{encounter.id.slice(0, 8)}</p>
        </footer>
      </article>
    </div>
  )
}

interface NoteEditorProps {
  encounter: Encounter
  onSave: (noteText: string) => void
}

type TabType = "note" | "transcript"
type OpenClawInitState = "idle" | "sending" | "sent" | "failed"

type OpenClawPayload = {
  source: "engageoscribe"
  encounterId: string
  patientName: string
  patientId: string
  visitReason: string
  noteMarkdown: string
  transcript: string
  requestedAction: "openemr_apply_note"
}

type OpenClawMessage = {
  id: string
  role: "user" | "assistant" | "system"
  text: string
  createdAt: string
  runId?: string
  status?: string
}

function messageId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  )
}

type SpeakerTurn = { speaker: string; text: string }

function TranscriptView({ transcript }: { transcript: string }) {
  const [turns, setTurns] = useState<SpeakerTurn[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const text = (transcript || "").trim()

  const identifySpeakers = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/transcript/diarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: text }),
      })
      const data = (await res.json()) as { turns?: SpeakerTurn[]; error?: string }
      if (!res.ok || data.error) throw new Error(data.error || `Request failed (${res.status})`)
      setTurns(data.turns || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to identify speakers")
    } finally {
      setLoading(false)
    }
  }

  if (!text) {
    return (
      <div className="mx-auto flex min-h-[300px] max-w-3xl items-center justify-center rounded-2xl border border-dashed border-border">
        <p className="text-sm text-muted-foreground">No transcript available</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl pb-10">
      <div className="mb-4 flex items-center justify-between gap-3">
        <span className="section-label">{turns === null ? "Raw Transcript" : "Conversation"}</span>
        {turns === null ? (
          <Button
            variant="outline"
            size="sm"
            onClick={identifySpeakers}
            disabled={loading}
            className="h-8 rounded-full px-3"
          >
            {loading ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Users className="mr-1.5 h-4 w-4" />
            )}
            <span className="text-xs">{loading ? "Identifying..." : "Identify speakers"}</span>
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setTurns(null)}
            className="h-8 rounded-full px-3 text-muted-foreground hover:text-foreground"
          >
            <span className="text-xs">Show raw</span>
          </Button>
        )}
      </div>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {turns === null ? (
        <div className="rounded-2xl border border-border bg-card p-6 shadow-[0_1px_2px_rgba(15,13,11,0.04),0_16px_32px_-20px_rgba(15,13,11,0.14)]">
          <pre className="whitespace-pre-wrap font-sans text-[14.5px] leading-[1.85] text-foreground/90">{text}</pre>
        </div>
      ) : turns.length === 0 ? (
        <p className="text-sm text-muted-foreground">No speaker turns detected.</p>
      ) : (
        <div className="space-y-3">
          {turns.map((turn, i) => {
            const isPatient = turn.speaker === "Patient"
            const isDoctor = turn.speaker === "Doctor"
            return (
              <div key={i} className={cn("flex items-start gap-3", isPatient && "flex-row-reverse")}>
                <span
                  className={cn(
                    "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ring-1 ring-inset",
                    isDoctor && "bg-primary/12 text-primary ring-primary/20",
                    isPatient && "bg-secondary text-foreground/70 ring-border",
                    !isDoctor && !isPatient && "bg-muted text-muted-foreground ring-border",
                  )}
                >
                  {isDoctor ? "Dr" : isPatient ? "Pt" : "?"}
                </span>
                <div
                  className={cn(
                    "max-w-[82%] rounded-2xl border px-4 py-2.5",
                    isDoctor && "border-primary/15 bg-primary/[0.06]",
                    !isDoctor && "border-border bg-card",
                  )}
                >
                  <p
                    className={cn(
                      "mb-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.1em]",
                      isDoctor ? "text-primary" : "text-muted-foreground",
                    )}
                  >
                    {turn.speaker}
                  </p>
                  <p className="text-[14.5px] leading-relaxed text-foreground/90">{turn.text}</p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function NoteEditor({ encounter, onSave }: NoteEditorProps) {
  const [activeTab, setActiveTab] = useState<TabType>("note")
  const [noteMarkdown, setNoteMarkdown] = useState<string>(encounter.note_text || "")
  const [hasChanges, setHasChanges] = useState(false)
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState(false)
  const [noteViewMode, setNoteViewMode] = useState<"preview" | "edit">("preview")
  const [icdCodes, setMedicalCodes] = useState<MedicalCode[] | null>(null)
  const [icdLoading, setIcdLoading] = useState(false)
  const [icdError, setIcdError] = useState("")

  const [openClawAvailable, setOpenClawAvailable] = useState(false)
  const [openClawPanelOpen, setOpenClawPanelOpen] = useState(false)
  const [openClawInitState, setOpenClawInitState] = useState<OpenClawInitState>("idle")
  const [openClawSessionId, setOpenClawSessionId] = useState<string>("")
  const [openClawError, setOpenClawError] = useState("")
  const [openClawMessages, setOpenClawMessages] = useState<OpenClawMessage[]>([])
  const [openClawInput, setOpenClawInput] = useState("")
  const [openClawSending, setOpenClawSending] = useState(false)
  const chatBottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setNoteMarkdown(encounter.note_text || "")
    setHasChanges(false)
    setOpenClawPanelOpen(false)
    setOpenClawInitState("idle")
    setOpenClawSessionId("")
    setOpenClawError("")
    setOpenClawMessages([])
    setOpenClawInput("")
    setOpenClawSending(false)
    setMedicalCodes(null)
    setIcdError("")
    setIcdLoading(false)
  }, [encounter.id, encounter.note_text])

  useEffect(() => {
    if (typeof window === "undefined") return
    const desktop = (window as Window & {
      desktop?: {
        engageoscribeBackend?: {
          invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
        }
      }
    }).desktop
    setOpenClawAvailable(Boolean(desktop?.engageoscribeBackend))
  }, [])

  useEffect(() => {
    if (!openClawPanelOpen) return
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [openClawMessages, openClawPanelOpen, openClawSending])

  const handleNoteChange = (value: string) => {
    setNoteMarkdown(value)
    setHasChanges(true)
    setSaved(false)
  }

  const handleSave = () => {
    onSave(noteMarkdown)
    setHasChanges(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleCopy = async () => {
    const textToCopy = activeTab === "note" ? noteMarkdown : encounter.transcript_text
    await navigator.clipboard.writeText(textToCopy)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleExport = () => {
    const isNote = activeTab === "note"
    const content = isNote ? noteMarkdown : encounter.transcript_text
    const blob = new Blob([content], { type: isNote ? "text/markdown" : "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    const suffix = isNote ? "note" : "transcript"
    const extension = isNote ? "md" : "txt"
    a.download = `${encounter.patient_name || "encounter"}_${suffix}_${format(new Date(encounter.created_at), "yyyy-MM-dd")}.${extension}`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleExportPdf = () => {
    const html = buildReportHtml(encounter, noteMarkdown, icdCodes)
    const win = window.open("", "_blank")
    if (!win) return
    win.document.open()
    win.document.write(html)
    win.document.close()
    win.focus()
    // Give the new window a beat to lay out fonts/content before invoking print.
    setTimeout(() => win.print(), 400)
  }

  const handleSuggestIcd = async () => {
    setIcdLoading(true)
    setIcdError("")
    try {
      const res = await fetch("/api/note/icd-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: noteMarkdown, transcript: encounter.transcript_text || "" }),
      })
      const data = (await res.json()) as { codes?: MedicalCode[]; error?: string }
      if (!res.ok || data.error) throw new Error(data.error || `Request failed (${res.status})`)
      setMedicalCodes(data.codes || [])
    } catch (e) {
      setIcdError(e instanceof Error ? e.message : "Failed to suggest ICD-11 codes")
    } finally {
      setIcdLoading(false)
    }
  }

  const appendMessage = (message: OpenClawMessage) => {
    setOpenClawMessages((prev) => [...prev, message])
  }

  const sendChatTurn = async (message: string, options?: { isInitial?: boolean }) => {
    const desktop = (window as Window & {
      desktop?: {
        engageoscribeBackend?: {
          invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
        }
      }
    }).desktop

    if (!desktop?.engageoscribeBackend) {
      setOpenClawError("OpenClaw chat is only available in the desktop app.")
      setOpenClawInitState("failed")
      appendMessage({
        id: messageId(),
        role: "system",
        text: "OpenClaw chat is only available in desktop mode.",
        createdAt: new Date().toISOString(),
      })
      return
    }

    if (!options?.isInitial) {
      appendMessage({
        id: messageId(),
        role: "user",
        text: message,
        createdAt: new Date().toISOString(),
      })
    }

    if (options?.isInitial) {
      setOpenClawInitState("sending")
    }
    setOpenClawSending(true)
    setOpenClawError("")

    try {
      const result = (await desktop.engageoscribeBackend.invoke("openclaw-chat-turn", {
        encounterId: encounter.id,
        patientName: encounter.patient_name || "",
        patientId: encounter.patient_id || "",
        visitReason: encounter.visit_reason || "",
        noteMarkdown,
        transcript: encounter.transcript_text || "",
        sessionId: openClawSessionId || undefined,
        message,
      })) as {
        success?: boolean
        error?: string
        sessionId?: string
        runId?: string
        status?: string
        responseText?: string
        rawOutput?: string
      }

      if (!result?.success) {
        const errorMessage = result?.error || "OpenClaw did not accept the request."
        if (options?.isInitial) {
          setOpenClawInitState("failed")
        }
        setOpenClawError(errorMessage)
        appendMessage({
          id: messageId(),
          role: "system",
          text: errorMessage,
          createdAt: new Date().toISOString(),
          status: "error",
        })
        return
      }

      if (result.sessionId) {
        setOpenClawSessionId(result.sessionId)
      }

      if (options?.isInitial) {
        setOpenClawInitState("sent")
        appendMessage({
          id: messageId(),
          role: "system",
          text: "Clinical note handoff sent to OpenClaw. Continue here to monitor and chat.",
          createdAt: new Date().toISOString(),
          status: result.status,
        })
      }

      appendMessage({
        id: messageId(),
        role: "assistant",
        text: result.responseText || result.rawOutput || "OpenClaw returned no response text.",
        createdAt: new Date().toISOString(),
        runId: result.runId,
        status: result.status,
      })
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "OpenClaw chat failed."
      if (options?.isInitial) {
        setOpenClawInitState("failed")
      }
      setOpenClawError(messageText)
      appendMessage({
        id: messageId(),
        role: "system",
        text: messageText,
        createdAt: new Date().toISOString(),
        status: "error",
      })
    } finally {
      setOpenClawSending(false)
    }
  }

  const buildInitialHandoffMessage = (): string => {
    const payload: OpenClawPayload = {
      source: "engageoscribe",
      encounterId: encounter.id,
      patientName: encounter.patient_name || "",
      patientId: encounter.patient_id || "",
      visitReason: encounter.visit_reason || "",
      noteMarkdown,
      transcript: encounter.transcript_text || "",
      requestedAction: "openemr_apply_note",
    }

    return [
      "You are receiving a structured handoff from Engageo Scribe.",
      "Primary objective: execute the OpenEMR action for this encounter now.",
      "Action target: apply the note into OpenEMR for the current patient chart or create/update the current encounter note.",
      "If patient resolution is ambiguous, ask for confirmation before writing data.",
      "Return a concise status after action execution.",
      "",
      `Encounter ID: ${payload.encounterId || "(missing)"}`,
      `Patient Name: ${payload.patientName || "(missing)"}`,
      `Patient ID: ${payload.patientId || "(missing)"}`,
      `Visit Reason: ${payload.visitReason || "(missing)"}`,
      `Requested Action: ${payload.requestedAction}`,
      "",
      "Clinical note markdown:",
      payload.noteMarkdown || "(missing)",
      "",
      "Transcript (optional context):",
      payload.transcript || "(missing)",
    ].join("\n")
  }

  const handleOpenOpenClawChat = async () => {
    setOpenClawPanelOpen(true)

    if (!openClawAvailable) {
      setOpenClawInitState("failed")
      setOpenClawError("OpenClaw handoff is only available in the desktop app.")
      if (openClawMessages.length === 0) {
        appendMessage({
          id: messageId(),
          role: "system",
          text: "OpenClaw handoff is only available in desktop mode.",
          createdAt: new Date().toISOString(),
          status: "error",
        })
      }
      return
    }

    if (openClawMessages.length === 0 && !openClawSending) {
      const initialMessage = buildInitialHandoffMessage()
      await sendChatTurn(initialMessage, { isInitial: true })
    }
  }

  const handleSendUserMessage = async () => {
    const text = openClawInput.trim()
    if (!text || openClawSending) return
    setOpenClawInput("")
    await sendChatTurn(text)
  }

  return (
    <>
      <div className="flex h-full flex-col">
        <div className="shrink-0 border-b border-border bg-background px-8 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-medium text-foreground">{encounter.patient_name || "Unknown Patient"}</h2>
                {encounter.patient_id && (
                  <Badge
                    variant="secondary"
                    className="rounded-full font-mono text-xs bg-secondary text-muted-foreground"
                  >
                    {encounter.patient_id}
                  </Badge>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                <span>{format(new Date(encounter.created_at), "MMM d, yyyy 'at' h:mm a")}</span>
                {encounter.visit_reason && (
                  <>
                    <span className="text-border">·</span>
                    <span>{VISIT_TYPE_LABELS[encounter.visit_reason] || encounter.visit_reason}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-4 border-b border-border">
            <div className="flex gap-1">
              <button
                onClick={() => setActiveTab("note")}
                className={cn(
                  "px-4 py-2 text-sm font-medium transition-colors",
                  "border-b-2 -mb-px",
                  activeTab === "note"
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                Clinical Note
              </button>
              <button
                onClick={() => setActiveTab("transcript")}
                className={cn(
                  "px-4 py-2 text-sm font-medium transition-colors",
                  "border-b-2 -mb-px",
                  activeTab === "transcript"
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                Transcript
              </button>
            </div>

            <div className="flex items-center gap-1 pb-2">
              {activeTab === "note" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setNoteViewMode((m) => (m === "preview" ? "edit" : "preview"))}
                  className="h-8 rounded-full px-3 text-muted-foreground hover:text-foreground"
                  title={noteViewMode === "preview" ? "Edit markdown" : "Preview note"}
                >
                  {noteViewMode === "preview" ? (
                    <Pencil className="h-4 w-4 mr-1.5" />
                  ) : (
                    <Eye className="h-4 w-4 mr-1.5" />
                  )}
                  <span className="text-xs">{noteViewMode === "preview" ? "Edit" : "Preview"}</span>
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCopy}
                className="h-8 rounded-full px-3 text-muted-foreground hover:text-foreground"
              >
                {copied ? <Check className="h-4 w-4 mr-1.5" /> : <Copy className="h-4 w-4 mr-1.5" />}
                <span className="text-xs">Copy</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleExport}
                className="h-8 rounded-full px-3 text-muted-foreground hover:text-foreground"
              >
                <Download className="h-4 w-4 mr-1.5" />
                <span className="text-xs">Export</span>
              </Button>
              {activeTab === "note" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleExportPdf}
                  disabled={!noteMarkdown.trim()}
                  className="h-8 rounded-full px-3 text-muted-foreground hover:text-foreground"
                  title="Export as PDF (print to PDF)"
                >
                  <Printer className="h-4 w-4 mr-1.5" />
                  <span className="text-xs">PDF</span>
                </Button>
              )}
              {activeTab === "note" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleOpenOpenClawChat}
                  disabled={!noteMarkdown.trim() || openClawInitState === "sending"}
                  className="h-8 rounded-full px-3 text-muted-foreground hover:text-foreground"
                  title={openClawAvailable ? "Send to WhatsApp" : "WhatsApp handoff is available in desktop mode"}
                >
                  {openClawInitState === "sending" ? (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : openClawInitState === "sent" ? (
                    <Check className="h-4 w-4 mr-1.5" />
                  ) : (
                    <WhatsAppIcon className="h-4 w-4 mr-1.5" />
                  )}
                  <span className="text-xs">
                    {openClawInitState === "sending"
                      ? "Opening WhatsApp..."
                      : openClawInitState === "sent"
                        ? "Open WhatsApp Chat"
                        : "Send to WhatsApp"}
                  </span>
                </Button>
              )}
              {activeTab === "note" && (
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={!hasChanges}
                  className={cn(
                    "ml-1 h-8 rounded-full px-3 bg-foreground text-background hover:bg-foreground/90",
                    saved && "bg-success hover:bg-success",
                  )}
                >
                  {saved ? <Check className="h-4 w-4 mr-1.5" /> : <Save className="h-4 w-4 mr-1.5" />}
                  <span className="text-xs">{saved ? "Saved" : "Save"}</span>
                </Button>
              )}
            </div>
          </div>
        </div>

        <ScrollArea className="flex-1 min-h-0">
          <div className="p-8">
            {activeTab === "note" ? (
              <>
                {noteViewMode === "preview" ? (
                  <ClinicalNoteView
                    markdown={noteMarkdown}
                    encounter={encounter}
                    icdCodes={icdCodes}
                    icdLoading={icdLoading}
                    icdError={icdError}
                    onSuggestIcd={handleSuggestIcd}
                  />
                ) : (
                  <Textarea
                    value={noteMarkdown}
                    onChange={(e) => handleNoteChange(e.target.value)}
                    placeholder="Clinical note markdown..."
                    className="min-h-[600px] resize-none rounded-xl border-border bg-secondary font-mono text-sm leading-relaxed focus-visible:ring-1 focus-visible:ring-ring"
                  />
                )}
                {openClawError && openClawInitState === "failed" && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{openClawError}</span>
                  </div>
                )}
              </>
            ) : (
              <TranscriptView transcript={encounter.transcript_text || ""} />
            )}
          </div>
        </ScrollArea>
      </div>

      {openClawPanelOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setOpenClawPanelOpen(false)} />
          <aside className="fixed right-0 top-0 z-50 h-screen w-[440px] border-l border-border bg-background shadow-2xl">
            <div className="flex h-full flex-col">
              <div className="border-b border-border px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">OpenClaw Chat</p>
                    <p className="text-xs text-muted-foreground">
                      {openClawSessionId ? `Session: ${openClawSessionId}` : "Preparing session..."}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setOpenClawPanelOpen(false)}
                    className="h-8 rounded-full px-2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                <div className="space-y-3">
                  {openClawMessages.map((msg) => (
                    <div
                      key={msg.id}
                      className={cn(
                        "max-w-[90%] rounded-xl px-3 py-2 text-xs",
                        msg.role === "user" && "ml-auto bg-foreground text-background",
                        msg.role === "assistant" && "mr-auto border border-border bg-secondary text-foreground",
                        msg.role === "system" && "mr-auto border border-amber-300/40 bg-amber-100/20 text-foreground",
                      )}
                    >
                      <div className="whitespace-pre-wrap leading-relaxed">{msg.text}</div>
                      <div className="mt-1 text-[10px] opacity-70">
                        {format(new Date(msg.createdAt), "h:mm:ss a")}
                        {msg.runId ? ` · run ${msg.runId}` : ""}
                        {msg.status ? ` · ${msg.status}` : ""}
                      </div>
                    </div>
                  ))}
                  {openClawSending && (
                    <div className="mr-auto inline-flex items-center gap-2 rounded-xl border border-border bg-secondary px-3 py-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Waiting for OpenClaw...</span>
                    </div>
                  )}
                  <div ref={chatBottomRef} />
                </div>
              </div>

              <div className="border-t border-border p-3">
                <div className="flex items-end gap-2">
                  <Textarea
                    value={openClawInput}
                    onChange={(e) => setOpenClawInput(e.target.value)}
                    placeholder="Message OpenClaw..."
                    className="min-h-[44px] max-h-[140px] resize-y rounded-xl border-border bg-secondary text-sm"
                    disabled={openClawSending || openClawInitState === "sending"}
                  />
                  <Button
                    size="sm"
                    onClick={handleSendUserMessage}
                    disabled={!openClawInput.trim() || openClawSending || openClawInitState === "sending"}
                    className="h-10 rounded-full px-3"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </aside>
        </>
      )}
    </>
  )
}
