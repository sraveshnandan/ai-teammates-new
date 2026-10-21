import { google } from "@ai-sdk/google"
import type { LanguageModelUsage } from "ai"

type Model = ReturnType<typeof google>

// The model the chat agent talks to
// Using Google AI Studio directly - Gemini 3.8 Flash (latest stable)
export function chatModel(): Model {
  return google("gemini-3.8-flash")
}

// Google AI Studio pricing (Gemini 3.8 Flash) - per million tokens
// https://ai.google.dev/pricing
const pricing = { input: 0.075, output: 0.30 }

// What a call to the chat model cost, in millionths of a dollar
export function chatModelCost(usage: LanguageModelUsage) {
  return Math.ceil(
    (usage.inputTokens ?? 0) * pricing.input +
      (usage.outputTokens ?? 0) * pricing.output
  )
}