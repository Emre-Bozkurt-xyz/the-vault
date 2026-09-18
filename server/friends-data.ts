/**
 * Data access for `@/server/friends`, for callers that have already
 * authenticated the user.
 *
 * These functions take a `userId` and trust it. They live here, in a module with
 * **no** `"use server"` directive, because every export of such a module is
 * registered as a callable server action — and as endpoints their only protection
 * would be that no client bundle happens to contain their action id. Never add the
 * directive to this file, and never accept a user id in an action.
 */

import { and, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { friendRequests, friendships, users } from "@/db/schema";

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
