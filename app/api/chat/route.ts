import { auth as clerkAuth } from "@clerk/nextjs/server"
import { streamText } from "ai"
import { db } from "@/db"
import { chatMembers, chats, type Bot, type Chat } from "@/db/schema"
import { USAGE_LIMIT_ERROR } from "@/lib/billing"
import { MEMORY_FILE } from "@/lib/daytona"
import { createHandoffTool, type Handoff } from "@/lib/handoff-tool"
import { chatModel, chatModelCost } from "@/lib/model"
import { createSandboxTools, type ChatUIMessage } from "@/lib/sandbox-tools"
import { getUsage, recordUsage } from "@/lib/usage"
import { asc, eq } from "drizzle-orm"
import { isStepCount } from "ai"

const clientDataSchema = {
  botId: { type: "string", optional: true },
} as const

async function getChatBots(chatId: string, botId?: string) {
  const row = await db.query.chats.findFirst({
    where: eq(chats.id, chatId),
    with: {
      members: {
        orderBy: [asc(chatMembers.joinedAt), asc(chatMembers.botId)],
        with: { bot: true },
      },
    },
  })

  const bots = row?.members.map((member) => member.bot) ?? []
  const bot = bots.find((bot) => bot.id === botId) ?? bots[0]
  if (!row || !bot) throw new Error("Bot is not in this chat")

  return { chat: row, bots, bot }
}

function buildGroupInstructions(bot: Bot, chat: Chat, bots: Bot[]) {
  const teammates = bots
    .filter((teammate) => teammate.id !== bot.id)
    .map(
      (teammate) => `- ${teammate.name} (id: ${teammate.id}): ${teammate.job}`
    )
    .join("\n")

  return [
    `You are in a group chat${chat.name ? ` called "${chat.name}"` : ""}, together with the person and these other teammates. Each of them has a job and a sandbox of their own:\n\n${teammates}`,
    "The person addresses each message to one teammate, and this one is yours: either they picked you, or a teammate handed it to you. Earlier replies in this conversation may have been written by other teammates rather than by you. Use them as context, and do not present their work as your own.",
    "Besides your sandbox tools you have a handoff tool. Call it when a request clearly belongs to a teammate's job rather than yours, with their id and a short note on what is needed. That teammate then takes over and answers in your place, so write nothing more once you have called it. Do not hand off what you can do well yourself, or because a request is merely hard, and never pass a request back to a teammate who handed it to you. When nobody fits better, answer it yourself.",
  ]
}

const memoryInstructions = [
  "You talk to the person in more than one conversation: a private one-to-one chat, and any group chats they add you to. Each conversation only shows you its own messages, so nothing said in one is visible to you in another. Your memory is what carries across: notes you save with the remember tool and read back with the recall tool, the same notes in every conversation.",
  "Call recall before you answer anything that could depend on another conversation: a question about the person, their preferences, their projects, earlier decisions or earlier work, or a reference to something you cannot find in this conversation. Never say you do not know something about the person, and never ask them to tell you, until you have called recall in this turn. Skip it only for requests that plainly stand on their own.",
  `Call remember in the same turn you learn something that would be useful in a later conversation, and every time the person asks you to remember something. Telling them you will remember is not enough: unless you call remember, it is gone as soon as this conversation is. Leave out small talk and details that only matter to the request in front of you. The notes live in ${MEMORY_FILE} in your sandbox's home directory, which you can edit with the file tools when a note has gone out of date.`,
]

function buildInstructions(bot: Bot, group?: { chat: Chat; bots: Bot[] }) {
  return [
    `You are ${bot.name}, an AI teammate. Your job: ${bot.job}`,
    "You work alongside the person you are talking to as a member of their team. They gave you your name and your job, and they come to you for that job. Stay in that role, and when asked who you are, answer as yourself.",
    bot.instructions &&
      `They also told you how to go about your job:\n\n${bot.instructions}`,
    "You have a sandbox of your own: an isolated Linux machine in the cloud with its own filesystem, network, CPU, memory and disk. It belongs to you alone, is not shared with other teammates, and stays yours for as long as you exist. Files you leave there are still there next time.",
    "Your tools all act on that sandbox. You can run shell commands and read, write and list files. It also has a graphical desktop, 1024x768 pixels, that you operate with the mouse and keyboard tools. Prefer the shell and file tools when they can do the job; use the desktop for things that need a screen.",
    "On the desktop you work blind until you look: call viewScreen to see it before you click or type, and again afterwards to check what happened. viewScreen is for your own eyes. Call showScreen instead only when the person asks to see the screen or asks what is on it, because that one puts the screenshot in the chat.",
    ...memoryInstructions,
    ...(group ? buildGroupInstructions(bot, group.chat, group.bots) : []),
    "Do the work rather than describing how it could be done, and say plainly when something failed.",
  ]
    .filter(Boolean)
    .join("\n\n")
}

export async function POST(req: Request) {
  try {
    const { isAuthenticated, userId } = await clerkAuth()
    if (!isAuthenticated) {
      return new Response("Unauthorized", { status: 401 })
    }

    const { chatId, messages, clientData } = await req.json()

    const {
      chat: row,
      bots,
      bot,
    } = await getChatBots(chatId, clientData?.botId)

    // Verify ownership
    if (row.userId !== userId) {
      return new Response("Forbidden", { status: 403 })
    }

    const group = row.kind === "group" ? { chat: row, bots } : undefined

    // Every turn, as a session outlives the plan it was started on
    const usage = await getUsage(row.userId)
    if (!usage || usage.remaining.ai <= 0) {
      return new Response(USAGE_LIMIT_ERROR, { status: 402 })
    }

    // Build tools
    let current = bot
    const held = new Set([bot.id])
    let checkedAt = 0

    const sandboxTools = createSandboxTools(async () => {
      if (Date.now() - checkedAt > 60_000) {
        const usage = await getUsage(userId)
        if (!usage || usage.remaining.sandbox <= 0) {
          throw new Error(
            "The sandbox hours for this billing period are used up, so the sandbox can't be used until the period resets."
          )
        }
        checkedAt = Date.now()
      }

      return current.sandboxId
    })

    const tools = row.kind !== "group"
      ? sandboxTools
      : {
          ...sandboxTools,
          ...createHandoffTool((botId) => {
            const target = bots.find((bot) => bot.id === botId)
            if (!target) throw new Error("No teammate in this chat has that id.")
            if (held.has(target.id)) {
              throw new Error(
                `${target.name} already had this request. Answer it yourself.`
              )
            }
            current = target
            held.add(target.id)
            return { botId: target.id, name: target.name }
          }),
        }

    const stream = streamText({
      model: chatModel(),
      system: buildInstructions(bot, group),
      messages,
      tools: tools as any,
      prepareStep: ({ steps }) => {
        const handoff = steps
          .flatMap((step) => step.toolResults)
          .findLast((result) => result.toolName === "handoff")
        const currentBot =
          handoff &&
          bots.find((bot) => bot.id === (handoff.output as Handoff).botId)

        return currentBot
          ? { instructions: buildInstructions(currentBot, group) }
          : undefined
      },
      stopWhen: [
        isStepCount(50),
        ({ steps }) =>
          steps.reduce((cost, step) => cost + chatModelCost(step.usage), 0) >=
          usage.remaining.ai,
      ],
      onFinish: async ({ usage: turnUsage }) => {
        if (turnUsage) {
          await recordUsage([
            {
              userId: row.userId,
              kind: "ai",
              amount: chatModelCost(turnUsage),
              idempotencyKey: `ai:${chatId}:${Date.now()}`,
            },
          ])
        }
      },
    })

    return stream.toTextStreamResponse()
  } catch (error) {
    console.error("Chat error:", error)
    return new Response("Internal Server Error", { status: 500 })
  }
}