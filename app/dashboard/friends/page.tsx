import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, UserPlus } from "lucide-react";

import { auth } from "@/auth";
import { ThemeToggle } from "@/components/theme-toggle";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  acceptFriendRequestAction,
  listFriendPageData,
  rejectFriendRequestAction,
  removeFriendAction,
  sendFriendRequestAction,
} from "@/server/friends";

export default async function FriendsPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const { friends, incomingRequests, outgoingRequests } = await listFriendPageData(
    session.user.id,
  );

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8">
        <nav className="flex items-center justify-between border-b border-border pb-5">
          <Link
            href="/dashboard"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-1")}
          >
            <ArrowLeft className="size-4" />
            Dashboard
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Badge variant="outline">Friends</Badge>
          </div>
        </nav>

        <section className="grid flex-1 gap-8 py-10 lg:grid-cols-[320px_1fr]">
          <aside className="border border-border bg-card p-5 text-card-foreground">
            <UserPlus className="mb-4 size-8 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">Add a friend</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Send a request to another registered Vault user by email. Friends
              are useful collaborators for document sharing.
            </p>

            <form action={sendFriendRequestAction} className="mt-6 grid gap-3">
              <input
                name="email"
                type="email"
                required
                placeholder="person@example.com"
                className="h-9 border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <Button type="submit">
                <UserPlus className="size-4" />
                Send request
              </Button>
            </form>
          </aside>

          <div className="grid gap-8">
            <section className="border border-border bg-card p-5 text-card-foreground">
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
                      className="flex flex-col gap-3 border border-border bg-background p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <UserSummary
                        name={friend.name}
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

            <section className="border border-border bg-card p-5 text-card-foreground">
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
                      className="flex flex-col gap-3 border border-border bg-background p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <UserSummary
                        name={request.requesterName}
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

            <section className="border border-border bg-card p-5 text-card-foreground">
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
                      className="flex items-center justify-between border border-border bg-background p-4"
                    >
                      <div>
                        <p className="font-medium">
                          {request.recipientName ??
                            request.recipientEmail ??
                            "Unnamed user"}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {request.recipientEmail}
                        </p>
                      </div>
                      <Badge variant="outline">Pending</Badge>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="mt-4 border border-dashed border-border bg-background p-4 text-sm text-muted-foreground">
      {text}
    </div>
  );
}

function UserSummary({
  name,
  email,
  image,
}: {
  name: string | null;
  email: string | null;
  image: string | null;
}) {
  const fallback = (name ?? email ?? "U").slice(0, 1).toUpperCase();

  return (
    <div className="flex items-center gap-3">
      <Avatar>
        <AvatarImage src={image ?? undefined} alt={name ?? email ?? "User"} />
        <AvatarFallback>{fallback}</AvatarFallback>
      </Avatar>
      <div>
        <p className="font-medium">{name ?? email ?? "Unnamed user"}</p>
        <p className="text-sm text-muted-foreground">{email}</p>
      </div>
    </div>
  );
}
