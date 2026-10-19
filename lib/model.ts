import { google } from "@ai-sdk/google"
import type { LanguageModelUsage } from "ai"

type Model = ReturnType<typeof google>

// The model the chat agent talks to
// Using Google AI Studio directly - Gemini 1.5 Pro or Flash
export function chatModel(): Model {
  return google("gemini-1.5-pro-latest")
}

// Google AI Studio pricing (Gemini 1.5 Pro) - per million tokens
// https://ai.google.dev/pricing
const pricing = { input: 3.50, output: 10.50 }

// What a call to the chat model cost, in millionths of a dollar
export function chatModelCost(usage: LanguageModelUsage) {
  return Math.ceil(
    (usage.inputTokens ?? 0) * pricing.input +
      (usage.outputTokens ?? 0) * pricing.output
  )
}