"use server"

import { auth as clerkAuth } from "@clerk/nextjs/server"
import { inngest } from "@/inngest/client"
import { and, eq, inArray, notInArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { db } from "@/db"
import {
  bots,
  chatMembers,
  chats,
  chatTranscripts,
  groupChatInsertSchema,
  type GroupChatInsert,
} from "@/db/schema"
import type { Feature } from "@/lib/billing"
import { getBotDesktopUrl } from "@/lib/daytona"
import type { ChatUIMessage } from "@/lib/sandbox-tools"
import { getUsage } from "@/lib/usage"
import { getChat } from "@/queries/chats"

async function assertChatOwner(chatId: string) {
  const chat = await getChat(chatId)
  if (!chat) throw new Error("Chat not found")
}

async function assertFeature(feature: Feature) {
  const { has, userId } = await clerkAuth()
  if (!has({ feature })) {
    throw new Error("Upgrade required")
  }
}

export async function sendChatMessage(
  chatId: string,
  messages: ChatUIMessage[],
  clientData?: { botId?: string }
) {
  await assertFeature("bots")
  await assertChatOwner(chatId)

  const { userId } = await clerkAuth()
  if (!userId) throw new Error("Unauthorized")

  // Save transcript to database
  await db
    .insert(chatTranscripts)
    .values({ chatId, messages: JSON.stringify(messages) })
    .onConflictDoUpdate({
      target: chatTranscripts.chatId,
      set: { messages: JSON.stringify(messages), updatedAt: new Date() },
    })

  // Send event to Inngest for processing
  await inngest.send({
    name: "chat/message",
    data: { chatId, clientData, messages, userId },
  })

  return { success: true }
}

export async function loadTranscript(params: { chatId: string }) {
  await assertChatOwner(params.chatId)

  const transcript = await db.query.chatTranscripts.findFirst({
    where: eq(chatTranscripts.chatId, params.chatId),
  })

  return { messages: transcript ? JSON.parse(transcript.messages) : [] as ChatUIMessage[] }
}

export async function getDesktopUrl(chatId: string) {
  await assertFeature("sandboxes")

  const chat = await getChat(chatId)
  // Only a direct chat has one desktop to show
  if (!chat || chat.kind !== "direct") throw new Error("Chat not found")

  // Showing the desktop starts the sandbox
  const usage = await getUsage(chat.userId)
  if (!usage || usage.remaining.sandbox <= 0) {
    throw new Error("Usage limit reached")
  }

  const startedAt = Date.now()
  const url = await getBotDesktopUrl(chat.bots[0].sandboxId)

  return url
}

export async function createGroupChat(values: GroupChatInsert) {
  const { isAuthenticated, userId } = await clerkAuth()
  if (!isAuthenticated) throw new Error("Unauthorized")

  const data = groupChatInsertSchema.parse(values)
  const botIds = [...new Set(data.botIds)]

  // The IDs come from the browser; every one must be a bot of this user
  const owned = await db
    .select({ id: bots.id })
    .from(bots)
    .where(and(eq(bots.userId, userId), inArray(bots.id, botIds)))
  if (botIds.length < 2 || owned.length !== botIds.length) {
    throw new Error("Bot not found")
  }

  const chat = await db.transaction(async (tx) => {
    const [chat] = await tx
      .insert(chats)
      .values({ userId, kind: "group", name: data.name })
      .returning()

    await tx
      .insert(chatMembers)
      .values(botIds.map((botId) => ({ chatId: chat.id, botId })))

    return chat
  })

  revalidatePath("/", "layout")

  return chat
}

export async function updateGroupChat(chatId: string, values: GroupChatInsert) {
  const { isAuthenticated, userId } = await clerkAuth()
  if (!isAuthenticated) throw new Error("Unauthorized")

  const data = groupChatInsertSchema.parse(values)
  const botIds = [...new Set(data.botIds)]

  // The IDs come from the browser; every one must be a bot of this user
  const owned = await db
    .select({ id: bots.id })
    .from(bots)
    .where(and(eq(bots.userId, userId), inArray(bots.id, botIds)))
  if (botIds.length < 2 || owned.length !== botIds.length) {
    throw new Error("Bot not found")
  }

  const chat = await db.transaction(async (tx) => {
    const [chat] = await tx
      .update(chats)
      .set({ name: data.name })
      .where(
        and(
          eq(chats.id, chatId),
          eq(chats.userId, userId),
          eq(chats.kind, "group")
        )
      )
      .returning()
    if (!chat) throw new Error("Chat not found")

    await tx
      .delete(chatMembers)
      .where(
        and(
          eq(chatMembers.chatId, chatId),
          notInArray(chatMembers.botId, botIds)
        )
      )

    // Bots that stay keep the row they joined with, and so their place
    await tx
      .insert(chatMembers)
      .values(botIds.map((botId) => ({ chatId, botId })))
      .onConflictDoNothing()

    return chat
  })

  revalidatePath("/", "layout")

  return chat
}

export async function deleteGroupChat(chatId: string) {
  const { isAuthenticated, userId } = await clerkAuth()
  if (!isAuthenticated) throw new Error("Unauthorized")

  // Memberships go with the chat; the bots stay
  const [chat] = await db
    .delete(chats)
    .where(
      and(
        eq(chats.id, chatId),
        eq(chats.userId, userId),
        eq(chats.kind, "group")
      )
    )
    .returning({ id: chats.id })
  if (!chat) throw new Error("Chat not found")

  revalidatePath("/", "layout")

  return chat
}