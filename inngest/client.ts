import { Inngest } from "inngest"

export const inngest = new Inngest({
  id: "ai-teammates",
  name: "AI Teammates",
  credentials: {
    signingKey: process.env.INNGEST_SIGNING_KEY || undefined,
    eventKey: process.env.INNGEST_EVENT_KEY || undefined,
  },
})