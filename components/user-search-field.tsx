"use client";

import { useEffect, useMemo, useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";

type UserSearchResult = {
  id: string;
  nickname: string | null;
  username: string | null;
  email: string | null;
  image: string | null;
};

type UserSearchFieldProps = {
  inputName?: string;
  userIdName?: string;
  placeholder?: string;
};

export function UserSearchField({
  inputName = "query",
  userIdName = "userId",
  placeholder = "Nickname, username, or email",
}: UserSearchFieldProps) {
  const [query, setQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState<UserSearchResult | null>(null);
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const debouncedQuery = useDebouncedValue(query, 180);

  useEffect(() => {
    if (debouncedQuery.trim().length < 2 || selectedUser) {
      return;
    }

    let cancelled = false;

    fetch(`/api/users/search?q=${encodeURIComponent(debouncedQuery)}`)
      .then((response) => (response.ok ? response.json() : { users: [] }))
      .then((data: { users?: UserSearchResult[] }) => {
        if (!cancelled) {
          setResults(data.users ?? []);
          setOpen(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResults([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, selectedUser]);

  const selectedUserId = selectedUser?.id ?? "";
  const displayResults = useMemo(
    () =>
      open && !selectedUser && query.trim().length >= 2 && results.length > 0
        ? results
        : [],
    [open, query, results, selectedUser],
  );

  return (
    <div className="relative">
      <input type="hidden" name={userIdName} value={selectedUserId} />
      <Input
        name={inputName}
        value={query}
        autoComplete="off"
        placeholder={placeholder}
        onChange={(event) => {
          setSelectedUser(null);
          setQuery(event.target.value);
        }}
        onFocus={() => setOpen(true)}
      />
      {displayResults.length > 0 ? (
        <div className="absolute left-0 right-0 top-[calc(100%+0.35rem)] z-20 overflow-hidden rounded-2xl border border-border/70 bg-popover text-popover-foreground shadow-xl">
          {displayResults.map((user) => (
            <button
              key={user.id}
              type="button"
              className="flex w-full items-center gap-3 border-b border-border/50 px-3 py-3 text-left transition last:border-b-0 hover:bg-muted/60"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setSelectedUser(user);
                setQuery(user.username ? `@${user.username}` : user.email ?? "");
                setOpen(false);
              }}
            >
              <Avatar className="size-9">
                <AvatarImage
                  src={user.image ?? undefined}
                  alt={user.nickname ?? user.username ?? user.email ?? "User"}
                />
                <AvatarFallback>
                  {(user.nickname ?? user.username ?? user.email ?? "U")
                    .slice(0, 1)
                    .toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">
                  {user.nickname ?? user.username ?? user.email ?? "Unnamed user"}
                  {user.username ? (
                    <span className="ml-2 text-muted-foreground">
                      @{user.username}
                    </span>
                  ) : null}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {user.email}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function useDebouncedValue(value: string, delay: number) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedValue(value), delay);

    return () => window.clearTimeout(timeout);
  }, [delay, value]);

  return debouncedValue;
}
