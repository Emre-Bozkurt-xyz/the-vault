import { redirect } from "next/navigation";
import { UserPlus } from "lucide-react";

import { auth } from "@/auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UserSearchField } from "@/components/user-search-field";
import { WorkspacePageRegistration } from "@/components/workspace/WorkspaceChrome";
import {
  acceptFriendRequestAction,
  listFriendPageData,
  rejectFriendRequestAction,
  removeFriendAction,
  sendFriendRequestAction,
} from "@/server/friends";
import { requireCompletedProfile } from "@/server/profile";

export default async function FriendsPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  await requireCompletedProfile();
  const { friends, incomingRequests, outgoingRequests } =
    await listFriendPageData(session.user.id);

  return (
    <>
      <WorkspacePageRegistration
        page={{ type: "settings", title: "Friends", href: "/dashboard/friends" }}
      />
      <section className="mx-auto grid w-full max-w-6xl gap-5 py-4">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border/70 pb-5">
          <div>
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
              Account
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight vault-display">
              Friends
            </h1>
          </div>
          <Badge variant="outline">{friends.length} friends</Badge>
        </header>

        <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
          <aside className="vault-fade-up border border-border/60 bg-card/45 p-5 text-card-foreground">
            <UserPlus className="mb-4 size-8 text-primary" />
            <h2 className="text-xl font-semibold tracking-tight vault-display">
              Add a friend
            </h2>

            <form action={sendFriendRequestAction} className="mt-6 grid gap-3">
              <UserSearchField />
              <Button type="submit" className="gap-2">
                <UserPlus className="size-4" />
                Send request
              </Button>
            </form>
          </aside>

          <div className="grid gap-6">
            <section className="vault-fade-up vault-delay-1 border border-border/60 bg-card/45 p-5 text-card-foreground">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold">Friends</h2>
                <Badge variant="outline">{friends.length}</Badge>
              </div>

              {friends.length === 0 ? (
                <EmptyState text="No friends yet. Send a request to start building your collaborator list." />
              ) : (
                <div className="mt-4 grid gap-3">
                  {friends.map((friend) => (
                    <div
                      key={friend.id}
                      className="flex flex-col gap-3 border border-border/60 bg-background/60 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <UserSummary
                        name={friend.name}
                        username={friend.username}
                        email={friend.email}
                        image={friend.image}
                      />
                      <form action={removeFriendAction}>
                        <input type="hidden" name="friendId" value={friend.id} />
                        <Button type="submit" variant="outline" size="sm">
                          Remove
                        </Button>
                      </form>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="vault-fade-up vault-delay-2 border border-border/60 bg-card/45 p-5 text-card-foreground">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold">Incoming requests</h2>
                <Badge variant="outline">{incomingRequests.length}</Badge>
              </div>

              {incomingRequests.length === 0 ? (
                <EmptyState text="No pending requests." />
              ) : (
                <div className="mt-4 grid gap-3">
                  {incomingRequests.map((request) => (
                    <div
                      key={request.id}
                      className="flex flex-col gap-3 border border-border/60 bg-background/60 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <UserSummary
                        name={request.requesterName}
                        username={request.requesterUsername}
                        email={request.requesterEmail}
                        image={request.requesterImage}
                      />
                      <div className="flex gap-2">
                        <form action={acceptFriendRequestAction}>
                          <input type="hidden" name="requestId" value={request.id} />
                          <Button type="submit" size="sm">
                            Accept
                          </Button>
                        </form>
                        <form action={rejectFriendRequestAction}>
                          <input type="hidden" name="requestId" value={request.id} />
                          <Button type="submit" variant="outline" size="sm">
                            Reject
                          </Button>
                        </form>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="vault-fade-up vault-delay-3 border border-border/60 bg-card/45 p-5 text-card-foreground">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold">Sent requests</h2>
                <Badge variant="outline">{outgoingRequests.length}</Badge>
              </div>

              {outgoingRequests.length === 0 ? (
                <EmptyState text="No sent requests waiting for a response." />
              ) : (
                <div className="mt-4 grid gap-3">
                  {outgoingRequests.map((request) => (
                    <div
                      key={request.id}
                      className="flex items-center justify-between border border-border/60 bg-background/60 px-3 py-2.5"
                    >
                      <UserSummary
                        name={request.recipientName}
                        username={request.recipientUsername}
                        email={request.recipientEmail}
                        image={request.recipientImage}
                      />
                      <Badge variant="outline">Pending</Badge>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </section>
    </>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="mt-4 border border-dashed border-border/70 bg-background/60 p-4 text-sm text-muted-foreground">
      {text}
    </div>
  );
}

function UserSummary({
  name,
  username,
  email,
  image,
}: {
  name: string | null;
  username?: string | null;
  email: string | null;
  image: string | null;
}) {
  const fallback = (name ?? username ?? email ?? "U").slice(0, 1).toUpperCase();

  return (
    <div className="flex items-center gap-3">
      <Avatar>
        <AvatarImage src={image ?? undefined} alt={name ?? email ?? "User"} />
        <AvatarFallback>{fallback}</AvatarFallback>
      </Avatar>
      <div>
        <p className="font-medium">
          {name ?? username ?? email ?? "Unnamed user"}
          {username ? (
            <span className="ml-2 text-muted-foreground">@{username}</span>
          ) : null}
        </p>
        <p className="text-sm text-muted-foreground">{email}</p>
      </div>
    </div>
  );
}
