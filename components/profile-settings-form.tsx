"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { updateProfileAction } from "@/server/profile";

type ProfileSettingsFormProps = {
  username: string;
  nickname: string;
  error?: string;
  saved?: string;
};

type AvailabilityState =
  | { status: "idle"; message: string }
  | { status: "checking"; message: string }
  | { status: "valid"; message: string }
  | { status: "invalid"; message: string };

export function ProfileSettingsForm({
  username,
  nickname,
  error,
  saved,
}: ProfileSettingsFormProps) {
  const [usernameValue, setUsernameValue] = useState(username);
  const [availability, setAvailability] = useState<AvailabilityState>({
    status: "valid",
    message: "This is your current username.",
  });
  const debouncedUsername = useDebouncedValue(usernameValue, 250);
  const usernameChanged = usernameValue !== username;

  useEffect(() => {
    if (!debouncedUsername) {
      return;
    }

    let cancelled = false;

    fetch(
      `/api/users/username-availability?username=${encodeURIComponent(
        debouncedUsername,
      )}`,
    )
      .then((response) => response.json())
      .then((data: { available?: boolean; message?: string }) => {
        if (cancelled) {
          return;
        }

        setAvailability({
          status: data.available ? "valid" : "invalid",
          message:
            data.message ??
            (data.available ? "Username available." : "Username unavailable."),
        });
      })
      .catch(() => {
        if (!cancelled) {
          setAvailability({
            status: "invalid",
            message: "Could not check username right now.",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedUsername]);

  const disabled = useMemo(
    () => availability.status === "checking" || availability.status === "invalid",
    [availability.status],
  );

  return (
    <form action={updateProfileAction} className="grid gap-4">
      {error === "username-taken" ? (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          That username was taken before the change could be saved.
        </div>
      ) : null}
      {saved === "profile" ? (
        <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-600 dark:text-emerald-300">
          Profile updated.
        </div>
      ) : null}

      <label className="grid gap-2 text-sm font-medium">
        Username
        <Input
          name="username"
          value={usernameValue}
          required
          minLength={3}
          maxLength={30}
          pattern="[a-z0-9_]+"
          onChange={(event) => {
            const nextUsername = event.target.value
              .toLowerCase()
              .replace(/[^a-z0-9_]/g, "");
            setUsernameValue(nextUsername);
            setAvailability(
              nextUsername.length === 0
                ? {
                    status: "invalid",
                    message: "Username is required.",
                  }
                : {
                    status: "checking",
                    message: "Checking username...",
                  },
            );
          }}
          aria-invalid={availability.status === "invalid"}
        />
        <span
          className={cn(
            "flex items-center gap-1.5 text-xs font-normal",
            availability.status === "valid"
              ? "text-emerald-600 dark:text-emerald-300"
              : availability.status === "invalid"
                ? "text-destructive"
                : "text-muted-foreground",
          )}
        >
          {availability.status === "checking" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : availability.status === "valid" ? (
            <CheckCircle2 className="size-3.5" />
          ) : (
            <XCircle className="size-3.5" />
          )}
          {availability.message}
          {usernameChanged && availability.status === "valid"
            ? " Friends and collaborators remain connected by account ID."
            : null}
        </span>
      </label>

      <label className="grid gap-2 text-sm font-medium">
        Nickname
        <Input
          name="nickname"
          defaultValue={nickname}
          required
          maxLength={80}
        />
        <span className="text-xs font-normal text-muted-foreground">
          Nicknames do not need to be unique.
        </span>
      </label>

      <Button type="submit" disabled={disabled}>
        Save profile
      </Button>
    </form>
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
