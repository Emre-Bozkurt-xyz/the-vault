import { WorkspaceChrome } from "@/components/workspace/WorkspaceChrome";
import { getWorkspaceData } from "@/server/workspace";
import type { ReactNode } from "react";

export default async function WorkspaceLayout({
  children,
}: {
  children: ReactNode;
}) {
  const workspace = await getWorkspaceData();

  return <WorkspaceChrome workspace={workspace}>{children}</WorkspaceChrome>;
}
