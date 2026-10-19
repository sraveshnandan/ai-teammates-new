import { tasks } from "@trigger.dev/sdk"

// Loaded by Trigger.dev before any task runs. No Sentry initialization.
// Logs are sent in batches, and the process can be frozen or gone as soon as
// the run ends or starts waiting
tasks.onComplete(async () => {
  // Sentry flush removed
})
tasks.onWait(async () => {
  // Sentry flush removed
})

// Fires once a run has used up its retries. The payload is left out, as a
// chat's payload is the person's messages.
tasks.onFailure(async ({ error, ctx }) => {
  // Sentry captureException removed

  // The process can be frozen or gone as soon as the run ends
  // Sentry flush removed
})
