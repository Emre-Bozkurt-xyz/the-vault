import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import StarterKit from "@tiptap/starter-kit";

export function createEditorExtensions({ history = true } = {}) {
  return [
    StarterKit.configure({
      heading: {
        levels: [1, 2, 3],
      },
      link: false,
      undoRedo: history ? undefined : false,
    }),
    Link.configure({
      openOnClick: false,
      autolink: true,
      defaultProtocol: "https",
    }),
    Placeholder.configure({
      placeholder: "Start writing...",
    }),
  ];
}

export const editorExtensions = createEditorExtensions();
