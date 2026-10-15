"use client";

import { useEffect } from "react";

import { connectLiveTaskEvents } from "@/lib/tasks/live-events";

/** Mounted once by the workspace shell while Tasks is on. Renders nothing. */
export function LiveTaskEvents() {
  useEffect(() => connectLiveTaskEvents(), []);
  return null;
}
