import { NextResponse } from "next/server"
import { getGeminiApiKeyStatus } from "@storage/server-api-keys"

export async function GET() {
  try {
    const status = getGeminiApiKeyStatus()
    return NextResponse.json({
      hasGeminiKeyConfigured: status.hasGeminiKeyConfigured,
      source: status.source,
    })
  } catch {
    return NextResponse.json(
      {
        hasGeminiKeyConfigured: false,
        source: "none",
      },
      { status: 200 },
    )
  }
}
