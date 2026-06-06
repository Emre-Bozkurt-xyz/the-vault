"use server";

import { and, eq, or, sql } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { db } from "@/db";
import { friendRequests, friendships, users } from "@/db/schema";
import { requireActiveUser } from "@/server/authz";

const friendTargetSchema = z.object({
  userId: z.string().uuid().optional(),
  query: z.string().trim().min(1).max(120).optional(),
});
const requestIdSchema = z.string().uuid();
const userIdSchema = z.string().uuid();

function normalizeFriendPair(userA: string, userB: string) {
  return userA < userB
    ? { userLowId: userA, userHighId: userB }
    : { userLowId: userB, userHighId: userA };
}

export async function sendFriendRequestAction(formData: FormData) {
  const user = await requireActiveUser();

  const input = friendTargetSchema.parse({
    userId: formData.get("userId") || undefined,
    query: formData.get("query") || undefined,
  });

  const [recipient] = input.userId
    ? await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1)
    : input.query
      ? await db
          .select({ id: users.id })
          .from(users)
          .where(
            or(
              eq(users.email, input.query.toLowerCase()),
              eq(users.username, input.query.toLowerCase().replace(/^@/, "")),
            ),
          )
          .limit(1)
      : [];

  if (!recipient || recipient.id === user.id) {
    redirect("/dashboard/friends");
  }

  const pair = normalizeFriendPair(user.id, recipient.id);
  const [existingFriendship] = await db
    .select({ id: friendships.id })
    .from(friendships)
    .where(
      and(
        eq(friendships.userLowId, pair.userLowId),
        eq(friendships.userHighId, pair.userHighId),
      ),
    )
    .limit(1);

  if (existingFriendship) {
    redirect("/dashboard/friends");
  }

  const [reversePending] = await db
    .select({ id: friendRequests.id })
    .from(friendRequests)
    .where(
      and(
        eq(friendRequests.requesterId, recipient.id),
        eq(friendRequests.recipientId, user.id),
        eq(friendRequests.status, "pending"),
      ),
    )
    .limit(1);

  if (reversePending) {
    redirect("/dashboard/friends");
  }

  await db
    .insert(friendRequests)
    .values({
      requesterId: user.id,
      recipientId: recipient.id,
      status: "pending",
    })
    .onConflictDoUpdate({
      target: [friendRequests.requesterId, friendRequests.recipientId],
      set: {
        status: "pending",
        updatedAt: sql`now()`,
      },
    });

  redirect("/dashboard/friends");
}

export async function acceptFriendRequestAction(formData: FormData) {
  const user = await requireActiveUser();

  const requestId = requestIdSchema.parse(formData.get("requestId"));

  const [request] = await db
    .select({
      requesterId: friendRequests.requesterId,
      recipientId: friendRequests.recipientId,
      status: friendRequests.status,
    })
    .from(friendRequests)
    .where(eq(friendRequests.id, requestId))
    .limit(1);

  if (
    !request ||
    request.recipientId !== user.id ||
    request.status !== "pending"
  ) {
    notFound();
  }

  const pair = normalizeFriendPair(request.requesterId, request.recipientId);

  await db.transaction(async (tx) => {
    await tx
      .update(friendRequests)
      .set({
        status: "accepted",
        updatedAt: sql`now()`,
      })
      .where(eq(friendRequests.id, requestId));

    await tx
      .insert(friendships)
      .values(pair)
      .onConflictDoNothing({
        target: [friendships.userLowId, friendships.userHighId],
      });
  });

  redirect("/dashboard/friends");
}

export async function rejectFriendRequestAction(formData: FormData) {
  const user = await requireActiveUser();

  const requestId = requestIdSchema.parse(formData.get("requestId"));

  const [request] = await db
    .select({
      recipientId: friendRequests.recipientId,
      status: friendRequests.status,
    })
    .from(friendRequests)
    .where(eq(friendRequests.id, requestId))
    .limit(1);

  if (
    !request ||
    request.recipientId !== user.id ||
    request.status !== "pending"
  ) {
    notFound();
  }

  await db
    .update(friendRequests)
    .set({
      status: "rejected",
      updatedAt: sql`now()`,
    })
    .where(eq(friendRequests.id, requestId));

  redirect("/dashboard/friends");
}

export async function removeFriendAction(formData: FormData) {
  const user = await requireActiveUser();

  const friendId = userIdSchema.parse(formData.get("friendId"));
  const pair = normalizeFriendPair(user.id, friendId);

  await db
    .delete(friendships)
    .where(
      and(
        eq(friendships.userLowId, pair.userLowId),
        eq(friendships.userHighId, pair.userHighId),
      ),
    );

  redirect("/dashboard/friends");
}

export async function listFriendPageData(userId: string) {
  const [incomingRequests, outgoingRequests, friendPairs] = await Promise.all([
    db
      .select({
        id: friendRequests.id,
        requesterId: users.id,
        requesterName: users.name,
        requesterUsername: users.username,
        requesterEmail: users.email,
        requesterImage: users.image,
      })
      .from(friendRequests)
      .innerJoin(users, eq(friendRequests.requesterId, users.id))
      .where(
        and(
          eq(friendRequests.recipientId, userId),
          eq(friendRequests.status, "pending"),
        ),
      ),
    db
      .select({
        id: friendRequests.id,
        recipientName: users.name,
        recipientUsername: users.username,
        recipientEmail: users.email,
        recipientImage: users.image,
      })
      .from(friendRequests)
      .innerJoin(users, eq(friendRequests.recipientId, users.id))
      .where(
        and(
          eq(friendRequests.requesterId, userId),
          eq(friendRequests.status, "pending"),
        ),
      ),
    db
      .select({
        userLowId: friendships.userLowId,
        userHighId: friendships.userHighId,
      })
      .from(friendships)
      .where(or(eq(friendships.userLowId, userId), eq(friendships.userHighId, userId))),
  ]);

  const friendIds = friendPairs.map((pair) =>
    pair.userLowId === userId ? pair.userHighId : pair.userLowId,
  );

  const friendList = await listUsersByIds(friendIds);

  return {
    incomingRequests,
    outgoingRequests,
    friends: friendList.filter((friend) => friend.id !== userId),
  };
}

export async function listFriendsForUser(userId: string) {
  const friendPairs = await db
    .select({
      userLowId: friendships.userLowId,
      userHighId: friendships.userHighId,
    })
    .from(friendships)
    .where(or(eq(friendships.userLowId, userId), eq(friendships.userHighId, userId)));

  const friendIds = friendPairs.map((pair) =>
    pair.userLowId === userId ? pair.userHighId : pair.userLowId,
  );

  return listUsersByIds(friendIds);
}

async function listUsersByIds(userIds: string[]) {
  if (userIds.length === 0) {
    return [];
  }

  return db
    .select({
      id: users.id,
      name: users.name,
      username: users.username,
      email: users.email,
      image: users.image,
    })
    .from(users)
    .where(or(...userIds.map((userId) => eq(users.id, userId))));
}
