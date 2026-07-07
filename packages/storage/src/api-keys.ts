/**
 * API Keys storage
 * Uses secure storage for sensitive API keys
 */

import { loadSecureItem, saveSecureItem } from "./secure-storage"

export interface ApiKeys {
  sarvamApiKey: string
  geminiApiKey: string
}

export interface MixedModeAuthStatus {
  hasGeminiKeyConfigured: boolean
  source: "server_file" | "env" | "none"
}

const API_KEYS_STORAGE_KEY = "engageoscribe_api_keys"

const DEFAULT_API_KEYS: ApiKeys = {
  sarvamApiKey: "",
  geminiApiKey: "",
}

export async function getApiKeys(): Promise<ApiKeys> {
  try {
    const stored = await loadSecureItem<ApiKeys>(API_KEYS_STORAGE_KEY)
    if (!stored) {
      return DEFAULT_API_KEYS
    }
    return {
      ...DEFAULT_API_KEYS,
      ...stored,
    }
  } catch (error) {
    console.error("Failed to load API keys:", error)
    return DEFAULT_API_KEYS
  }
}

export async function setApiKeys(keys: Partial<ApiKeys>): Promise<void> {
  try {
    const current = await getApiKeys()
    const updated = {
      ...current,
      ...keys,
    }

    // Save to secure storage (client-side)
    await saveSecureItem(API_KEYS_STORAGE_KEY, updated)

    // Also save to server-side config file
    if (typeof window !== "undefined") {
      try {
        const response = await fetch("/api/settings/api-keys", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(updated),
        })

        if (!response.ok) {
          console.error("Failed to sync API keys to server")
        }
      } catch (error) {
        console.error("Failed to sync API keys to server:", error)
        // Don't throw - client-side storage succeeded
      }
    }
  } catch (error) {
    console.error("Failed to save API keys:", error)
    throw error
  }
}

export async function getMixedModeAuthStatus(): Promise<MixedModeAuthStatus> {
  try {
    const response = await fetch("/api/settings/mixed-auth-status", { method: "GET" })
    if (!response.ok) {
      return { hasGeminiKeyConfigured: false, source: "none" }
    }
    const parsed = (await response.json()) as Partial<MixedModeAuthStatus>
    return {
      hasGeminiKeyConfigured: !!parsed.hasGeminiKeyConfigured,
      source: parsed.source === "server_file" || parsed.source === "env" ? parsed.source : "none",
    }
  } catch {
    return { hasGeminiKeyConfigured: false, source: "none" }
  }
}

export function validateApiKey(key: string, type: "sarvam" | "gemini"): boolean {
  if (!key || typeof key !== "string") return false
  const trimmed = key.trim()

  if (type === "sarvam") {
    // Sarvam subscription keys start with "sk_"
    return trimmed.startsWith("sk_") || trimmed.startsWith("sk-")
  } else if (type === "gemini") {
    // Google Gemini API keys typically start with "AIza"; OAuth-style tokens start with "AQ."
    return trimmed.startsWith("AIza") || trimmed.startsWith("AQ.") || trimmed.length >= 20
  }

  return false
}
