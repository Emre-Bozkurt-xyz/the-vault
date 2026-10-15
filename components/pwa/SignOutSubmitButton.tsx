"use client";

import { Button } from "@/components/ui/button";
import { clearOfflinePages } from "@/lib/pwa/offline-pages";

/** A sign-out form's submit button that first clears offline page copies. */
export function SignOutSubmitButton() {
  return (
    <Button type="submit" variant="outline" onClick={clearOfflinePages}>
      Sign out
    </Button>
  );
}
