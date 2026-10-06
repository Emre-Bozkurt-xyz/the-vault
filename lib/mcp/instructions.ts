/**
 * The MCP `instructions` string: clients add it to the agent's context on
 * connect, so it is the one place to teach the workflow across tools. Keep it
 * short — it is paid for in every conversation — and name only tools that
 * exist.
 */
export const vaultMcpInstructions = `Vault is the user's personal notes and documents app. Documents are Markdown, organized in folders, and may be shared between users.

Finding things:
- Documents are addressed by id; every listing also gives a \`path\` (folder path + title, e.g. "Courses/CS101/Todo"). Several documents can share a title in different folders, so reason with paths, not titles alone.
- When a request names a place ("my CS101 todo", "work notes"), start with list_folders, then search_documents or list_documents with \`folder\` set. Folder arguments take an id or a path.
- search_documents matches every query word against title, folder path, and body, and returns matching line numbers. Use get_outline and read_document (by heading or line range) to read large documents in parts.

Editing:
- Read before editing. edit_document takes exact, unique old_string anchors and never needs the whole document; append_to_document and insert_at_heading need no anchors. Edits merge live with anyone else editing.
- update_document changes the title and frontmatter properties (tags, summary, status, project, aliases), not the body.
- Agent edits create restore points; list_versions / restore_version undo them. delete_document moves a document to the Bin (list_deleted_documents, restore_document).

Extensions:
- Optional features (tasks, calendars, calculations, dictionary, stickers) expose actions through list_extension_actions and run_extension_action. Call list_extension_actions first for ids and input schemas. If a needed extension is listed under disabledExtensions, ask the user to enable it in Settings → Extensions.
- Checklist items ("- [ ] …", with optional :due[YYYY-MM-DD]) are tasks. With the Tasks extension enabled, use vault.tasks.listTasks to find them across folders (each comes with its document path) and setTaskStatus / setTaskDue / addTask to change them, rather than editing checkbox text by hand. Pass the user's local date as \`today\` when you know it.`;
