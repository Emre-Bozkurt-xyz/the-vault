import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, UserPlus } from "lucide-react";

import { auth } from "@/auth";
import { ThemeToggle } from "@/components/theme-toggle";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-10 px-6 py-8">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-6">
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
        </header>

        <section className="grid gap-8 lg:grid-cols-[320px_1fr]">
          <aside className="vault-fade-up rounded-3xl border border-border/60 bg-card/80 p-6 text-card-foreground shadow-[0_18px_60px_-50px_rgba(0,0,0,0.6)] backdrop-blur">
            <UserPlus className="mb-4 size-8 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight vault-display">
              Add a friend
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Send a request to another registered Vault user by email. Friends
              are useful collaborators for document sharing.
            </p>

            <form action={sendFriendRequestAction} className="mt-6 grid gap-3">
              <Input
                name="email"
                type="email"
                required
                placeholder="person@example.com"
              />
              <Button type="submit" className="gap-2">
                <UserPlus className="size-4" />
                Send request
              </Button>
            </form>
          </aside>

          <div className="grid gap-6">
            <section className="vault-fade-up vault-delay-1 rounded-3xl border border-border/60 bg-card/80 p-6 text-card-foreground shadow-[0_18px_60px_-50px_rgba(0,0,0,0.6)] backdrop-blur">
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
                      className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-background/70 p-4 sm:flex-row sm:items-center sm:justify-between"
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

            <section className="vault-fade-up vault-delay-2 rounded-3xl border border-border/60 bg-card/80 p-6 text-card-foreground shadow-[0_18px_60px_-50px_rgba(0,0,0,0.6)] backdrop-blur">
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
                      className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-background/70 p-4 sm:flex-row sm:items-center sm:justify-between"
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

            <section className="vault-fade-up vault-delay-3 rounded-3xl border border-border/60 bg-card/80 p-6 text-card-foreground shadow-[0_18px_60px_-50px_rgba(0,0,0,0.6)] backdrop-blur">
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
                      className="flex items-center justify-between rounded-2xl border border-border/60 bg-background/70 p-4"
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
    <div className="mt-4 rounded-2xl border border-dashed border-border/70 bg-background/60 p-4 text-sm text-muted-foreground">
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
