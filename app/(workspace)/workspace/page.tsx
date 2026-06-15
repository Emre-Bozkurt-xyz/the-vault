import { WorkspacePageRegistration } from "@/components/workspace/WorkspaceChrome";
import { WorkspaceNewTab } from "@/components/workspace/WorkspaceNewTab";
import { getWorkspaceData } from "@/server/workspace";

export default async function WorkspacePage() {
  const workspace = await getWorkspaceData();
  const userLabel =
    workspace.profile.nickname ??
    workspace.profile.username ??
    workspace.profile.email ??
    "New tab";

  return (
    <>
      <WorkspacePageRegistration
        page={{ type: "new", title: "New tab", href: "/workspace" }}
      />
      <WorkspaceNewTab
        recentDocuments={workspace.recent}
        searchableDocuments={[...workspace.owned, ...workspace.shared]}
        userLabel={userLabel}
      />
    </>
  );
}
