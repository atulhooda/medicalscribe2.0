# Engageo Scribe

AI medical scribe — record a patient encounter, transcribe it with **Sarvam AI**, and generate a structured, bullet-point clinical note with **Google Gemini**. Runs as a local Next.js web app.

## Features

- **Speech-to-text (Sarvam AI)** — synchronous for live segments, and **Batch STT** for the full recording (no 30-second limit, handles long consults; Hindi / English / mixed).
- **Clinical notes (Google Gemini)** — comprehensive, bullet-point History & Physical rendered as a clean report.
- **Speaker diarization** — labels each turn as Doctor / Patient.
- **Medical coding** — AI-suggested ICD-11, NAMASTE (AYUSH), SNOMED CT, and ICD-10 codes.
- **Export** — copy, download markdown, or print to PDF.
- **Local-first storage** — encounters are stored encrypted (AES-GCM) in the browser.

## Quick start

Requires Node.js 18+ and pnpm.

```bash
pnpm install
```

Create `apps/web/.env.local` (copy `apps/web/.env.local.example`) and set your keys:

```bash
GEMINI_API_KEY="your-gemini-key"       # https://aistudio.google.com/app/apikey
SARVAM_API_KEY="your-sarvam-key"       # https://dashboard.sarvam.ai/
NEXT_PUBLIC_SECURE_STORAGE_KEY="..."   # generate: openssl rand -base64 32
```

Run the app:

```bash
pnpm dev        # http://localhost:3001
```

## How it works

1. Record the encounter in the browser.
2. Live segments transcribe via Sarvam (sync) for a real-time preview.
3. On stop, the full recording is transcribed via **Sarvam Batch STT** (async job: upload → poll → download).
4. The transcript is sent to **Gemini**, which returns a structured, bullet-point clinical note.
5. Review the note as a report — suggest medical codes, label speakers, and export to PDF.

## Structure

- `apps/web/` — Next.js app (UI + API routes)
- `packages/pipeline/` — audio ingest, transcription, note assembly, rendering
- `packages/llm/` — Gemini client + clinical-note prompts
- `packages/storage/` — encrypted local storage
- `packages/ui/` — shared React components
- `config/` — shared configuration

## Configuration

Everything is env-driven (see `apps/web/.env.local.example`): transcription providers, models, batch mode/language/diarization, and timeouts. The authoritative full-recording transcription uses Sarvam Batch STT by default (`FINAL_TRANSCRIPTION_PROVIDER=sarvam_batch`).

## Notes

All AI-generated notes and medical codes are **drafts requiring clinician review**.

