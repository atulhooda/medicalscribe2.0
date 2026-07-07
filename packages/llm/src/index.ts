export interface LLMRequest {
  system: string
  prompt: string
  model?: string
  apiKey?: string
  /**
   * @deprecated JSON schema tool calling is no longer used.
   * The system now generates markdown directly.
   */
  jsonSchema?: {
    name: string
    schema: Record<string, unknown>
  }
}

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta"
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"

/**
 * HIPAA Compliance: Validate that the Gemini endpoint uses HTTPS.
 * This prevents future configuration overrides that could expose PHI in transit.
 */
function validateGeminiHttps(baseUrl: string): void {
  try {
    const parsed = new URL(baseUrl)
    if (parsed.protocol !== "https:") {
      throw new Error(
        `SECURITY ERROR: Gemini API endpoint must use HTTPS for HIPAA compliance. ` +
        `Received: ${parsed.protocol}//${parsed.host}`
      )
    }
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(`Invalid Gemini API URL: ${baseUrl}`)
    }
    throw error
  }
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> }
    finishReason?: string
  }>
  promptFeedback?: { blockReason?: string }
}

export async function runLLMRequest({ system, prompt, model, apiKey, jsonSchema }: LLMRequest): Promise<string> {
  const geminiApiKey = (apiKey || process.env.GEMINI_API_KEY || "").trim()

  const normalizedKey = geminiApiKey.toLowerCase()
  const looksPlaceholder =
    !geminiApiKey ||
    normalizedKey.includes("your_key") ||
    normalizedKey.includes("your-key") ||
    normalizedKey.includes("placeholder")

  if (looksPlaceholder) {
    throw new Error(
      "GEMINI_API_KEY is required. " +
      "Please configure it in Settings."
    )
  }

  // Only accept Gemini model ids; ignore any legacy (non-Gemini) model id passed in.
  const resolvedModel = model && model.startsWith("gemini") ? model : DEFAULT_GEMINI_MODEL

  const baseUrl = process.env.GEMINI_API_BASE || GEMINI_API_BASE

  // Validate HTTPS before sending any PHI
  validateGeminiHttps(baseUrl)

  // JSON schema is deprecated - we now generate markdown directly
  if (jsonSchema) {
    console.warn("⚠️  jsonSchema parameter is deprecated and will be ignored. The system now generates markdown directly.")
  }

  const requestBody = {
    systemInstruction: {
      parts: [{ text: system }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      maxOutputTokens: 4096,
    },
  }

  const url = `${baseUrl}/models/${resolvedModel}:generateContent`

  // Gemini API keys (any prefix — "AIza...", "AQ...", etc.) authenticate via the
  // x-goog-api-key header. Bearer auth is only for OAuth 2 access tokens, which
  // this app does not use.
  const authHeaders: Record<string, string> = { "x-goog-api-key": geminiApiKey }

  const timeoutMs = Number(process.env.GEMINI_TIMEOUT_MS || 45000)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let response: Response
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Gemini request timed out after ${timeoutMs}ms`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "")
    throw new Error(`Gemini request failed: ${response.status} ${errorText}`)
  }

  const data = (await response.json()) as GeminiResponse

  if (data.promptFeedback?.blockReason) {
    throw new Error(`Gemini blocked the request: ${data.promptFeedback.blockReason}`)
  }

  const textContent = data.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("")

  if (!textContent) {
    throw new Error("No text content in Gemini response")
  }

  return textContent
}

// Export prompts for versioned prompt management
export * as prompts from "./prompts"
