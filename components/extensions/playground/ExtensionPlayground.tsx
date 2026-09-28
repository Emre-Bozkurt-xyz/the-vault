"use client";

import { markdown as markdownLanguage } from "@codemirror/lang-markdown";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { DocumentOverlayHost } from "@/components/extensions/DocumentOverlayHost";
import {
  ExtensionOverlayLayer,
  ExtensionOverlaySurface,
} from "@/components/extensions/ExtensionOverlays";
import { useLiveContributions } from "@/components/extensions/use-live-contributions";
import { MarkdownDocument } from "@/components/markdown/MarkdownDocument";
import { createLiveBlockDecorationExtension } from "@/components/markdown/live-blocks";
import { extensionManifests } from "@/extensions/manifests";
import { clientExtensions } from "@/extensions/registry.client";
import {
  createRenderContext,
  type DocumentExtensions,
  type EditorModule,
  type ExtensionManifest,
  type ExtensionSettingsField,
  type ExtensionStateRow,
  type ExtensionSurface,
  type JsonValue,
  type PickedAsset,
} from "@/lib/extension-api";
import {
  ExtensionStateStoreProvider,
  type ExtensionStateStore,
} from "@/lib/extension-api/react";
import { runExtensionCommand } from "@/lib/extension-host/editor-handle";
import type { ExtensionFixture } from "@/lib/extension-host/fixtures";

const noSubscription = () => () => undefined;

/** A stable, obviously fake id: nothing here ever reaches the database. */
const PLAYGROUND_DOCUMENT_ID = "00000000-0000-4000-8000-00000000d0c5";

type StoreRows = Record<string, Record<string, ExtensionStateRow>>;

/** An in-memory extension state store, seeded from a fixture. */
function createPlaygroundStore(extensionId: string, seed: Record<string, ExtensionStateRow>) {
  let rows: StoreRows = { [extensionId]: { ...seed } };
  const listeners = new Set<() => void>();

  const store: ExtensionStateStore & { rows: () => StoreRows } = {
    rows: () => rows,
    get: (id, key) => rows[id]?.[key],
    set: (id, key, state, visibility) => {
      const previous = rows[id]?.[key];
      rows = {
        ...rows,
        [id]: {
          ...rows[id],
          [key]: { state, visibility, version: previous?.version ?? 1 },
        },
      };
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return store;
}

/** A read-only view of a store that only shows public rows, as a public page would. */
function publicView(store: ExtensionStateStore): ExtensionStateStore {
  return {
    get: (id, key) => {
      const row = store.get(id, key);
      return row?.visibility === "public" ? row : undefined;
    },
    set: () => undefined,
    subscribe: store.subscribe,
  };
}

function defaultSettings(manifest: ExtensionManifest): Record<string, unknown> {
  const parsed = manifest.settings?.schema.safeParse({});
  return parsed?.success ? parsed.data : {};
}

function documentExtensions(input: {
  extensionId: string;
  surface: ExtensionSurface;
  canEdit: boolean;
  enabled: boolean;
  settings: Record<string, unknown>;
  defaults: Record<string, unknown>;
  data: JsonValue | null;
}): DocumentExtensions {
  return {
    surface: input.surface,
    documentId: PLAYGROUND_DOCUMENT_ID,
    canEdit: input.canEdit,
    renderIds: [input.extensionId],
    enabledIds: input.enabled ? [input.extensionId] : [],
    // Settings apply only while enabled, exactly as the runtime resolves them.
    settings: { [input.extensionId]: input.enabled ? input.settings : input.defaults },
    // Blocks read state through the in-memory store, never from here.
    state: {},
    // What `loadRenderData` would return, from the fixture's `.data.json`.
    data: input.data === null ? {} : { [input.extensionId]: input.data },
  };
}

/**
 * The extension playground (`docs/23_EXTENSION_SDK_PLAN.md` §18.3). Renders
 * each fixture the ways a real document is seen, side by side, from one
 * in-memory state store, so an author can check the render/authoring split
 * and the visibility rules without two accounts and a published page.
 */
export function ExtensionPlayground({
  extensionId,
  fixtures,
}: {
  extensionId: string;
  fixtures: ExtensionFixture[];
}) {
  // Client-only: a development tool needs no server render, and
  // `MarkdownDocument` hydrated as a client component trips the heading-id
  // mismatch recorded in project-knowledge §16.
  const mounted = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  const manifest = extensionManifests.find((candidate) => candidate.id === extensionId);
  if (!mounted) {
    return <p className="text-sm text-muted-foreground">Loading playground…</p>;
  }
  if (!manifest) {
    return <p className="text-sm text-muted-foreground">Unknown extension {extensionId}.</p>;
  }

  return <Playground manifest={manifest} fixtures={fixtures} />;
}

function Playground({
  manifest,
  fixtures,
}: {
  manifest: ExtensionManifest;
  fixtures: ExtensionFixture[];
}) {
  const defaults = useMemo(() => defaultSettings(manifest), [manifest]);
  const [settings, setSettings] = useState(defaults);
  const [editorModule, setEditorModule] = useState<EditorModule | null>(null);

  useEffect(() => {
    const entry = clientExtensions.find((candidate) => candidate.manifest.id === manifest.id);
    let cancelled = false;
    entry
      ?.editor?.()
      .then((loaded) => {
        if (!cancelled) setEditorModule(loaded.default);
      })
      .catch((cause: unknown) => console.error("Editor module failed to load", cause));
    return () => {
      cancelled = true;
    };
  }, [manifest.id]);

  return (
    <div className="grid gap-8">
      {manifest.settings?.sections?.length ? (
        <SettingsPanel manifest={manifest} settings={settings} onChange={setSettings} />
      ) : null}
      {fixtures.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No fixtures yet. Add <code>extensions/&lt;name&gt;/fixtures/&lt;fixture&gt;.md</code>{" "}
          (and optionally <code>&lt;fixture&gt;.state.json</code>).
        </p>
      ) : (
        fixtures.map((fixture) => (
          <FixtureView
            key={fixture.name}
            manifest={manifest}
            fixture={fixture}
            settings={settings}
            defaults={defaults}
            editorModule={editorModule}
          />
        ))
      )}
    </div>
  );
}

function FixtureView({
  manifest,
  fixture,
  settings,
  defaults,
  editorModule,
}: {
  manifest: ExtensionManifest;
  fixture: ExtensionFixture;
  settings: Record<string, unknown>;
  defaults: Record<string, unknown>;
  editorModule: EditorModule | null;
}) {
  const [generation, setGeneration] = useState(0);
  const store = useMemo(() => {
    // A new generation (Reset) rebuilds the store from the fixture.
    void generation;
    return createPlaygroundStore(manifest.id, fixture.state);
  }, [manifest.id, fixture.state, generation]);
  const publicStore = useMemo(() => publicView(store), [store]);
  const [markdown, setMarkdown] = useState(fixture.markdown);

  const surfaces = useMemo(() => {
    const make = (surface: ExtensionSurface, canEdit: boolean, enabled: boolean) =>
      documentExtensions({
        extensionId: manifest.id,
        surface,
        canEdit,
        enabled,
        settings,
        defaults,
        data: fixture.data,
      });
    return {
      live: make("workspace", true, true),
      read: make("workspace", true, true),
      public: make("public", false, false),
      disabled: make("workspace", false, false),
    };
  }, [defaults, fixture.data, manifest.id, settings]);

  return (
    <section className="grid gap-3 rounded-lg border border-border/60 p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-mono text-sm font-semibold">{fixture.name}.md</h2>
        <button
          type="button"
          className="rounded border border-border/60 px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => {
            setMarkdown(fixture.markdown);
            setGeneration((value) => value + 1);
          }}
        >
          Reset fixture and state
        </button>
      </header>
      <div className="grid gap-4 xl:grid-cols-2">
        <Pane
          title="Live"
          detail="Editable, enabled, canEdit. Move the cursor onto a block to reveal its source."
        >
          <LiveEditor
            key={generation}
            initialMarkdown={fixture.markdown}
            extensions={surfaces.live}
            store={store}
            editorModule={editorModule}
            settings={settings}
            onChange={setMarkdown}
          />
        </Pane>
        <Pane title="Read" detail="Workspace read view: blocks are read-only here.">
          <ExtensionStateStoreProvider value={store}>
            <ExtensionOverlaySurface extensions={surfaces.read}>
              <MarkdownDocument markdown={markdown} contained={false} extensions={surfaces.read} />
            </ExtensionOverlaySurface>
          </ExtensionStateStoreProvider>
        </Pane>
        <Pane
          title="Public"
          detail="Anonymous reader of a published page: public state only. Render data comes from the fixture's .data.json, if any."
        >
          <ExtensionStateStoreProvider value={publicStore}>
            <ExtensionOverlaySurface extensions={surfaces.public}>
              <MarkdownDocument markdown={markdown} contained={false} extensions={surfaces.public} />
            </ExtensionOverlaySurface>
          </ExtensionStateStoreProvider>
        </Pane>
        <Pane
          title="Extension disabled"
          detail="A reader who has not enabled it: content still renders, settings are defaults."
        >
          <ExtensionStateStoreProvider value={store}>
            <ExtensionOverlaySurface extensions={surfaces.disabled}>
              <MarkdownDocument markdown={markdown} contained={false} extensions={surfaces.disabled} />
            </ExtensionOverlaySurface>
          </ExtensionStateStoreProvider>
        </Pane>
      </div>
    </section>
  );
}

function Pane({ title, detail, children }: { title: string; detail: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 content-start gap-2">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide">{title}</h3>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
      <div className="min-w-0 rounded-md border border-border/50 bg-card/40 p-3">{children}</div>
    </div>
  );
}

function LiveEditor({
  initialMarkdown,
  extensions,
  store,
  editorModule,
  settings,
  onChange,
}: {
  initialMarkdown: string;
  extensions: DocumentExtensions;
  store: ExtensionStateStore;
  editorModule: EditorModule | null;
  settings: Record<string, unknown>;
  onChange: (markdown: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [liveBlocks] = useState(() => new Compartment());
  // The extension's own Live-mode rendering (`live`), as the editor loads it.
  const liveExtensionIds = useMemo(() => [extensions.renderIds[0]], [extensions.renderIds]);
  const liveContributions = useLiveContributions(liveExtensionIds);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // The live-block engine is the same one the editor uses; everything else a
  // full editor adds (collab, autosave, menus) is out of scope here.
  useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: initialMarkdown,
        extensions: [
          markdownLanguage(),
          EditorView.lineWrapping,
          liveBlocks.of([]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [initialMarkdown, liveBlocks]);

  // Settings changes reconfigure only the block compartment, never the view.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: liveBlocks.reconfigure([
        createLiveBlockDecorationExtension({
          assetLinks: {},
          extensions,
          extensionStateStore: store,
        }),
        ...liveContributions.map(({ extensionId, create }) =>
          create(createRenderContext(extensions, extensionId)),
        ),
      ]),
    });
  }, [extensions, liveBlocks, liveContributions, store]);

  const commands = Object.keys(editorModule?.commands ?? {});

  return (
    <div className="grid gap-2">
      {commands.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {commands.map((commandId) => (
            <button
              key={commandId}
              type="button"
              className="rounded border border-border/60 px-2 py-1 font-mono text-[0.7rem] hover:bg-accent"
              onClick={() => {
                const view = viewRef.current;
                if (!view || !editorModule) return;
                runExtensionCommand(
                  editorModule.commands[commandId],
                  view,
                  {
                    extensionId: editorModule.manifestId,
                    documentId: PLAYGROUND_DOCUMENT_ID,
                    folderId: null,
                    settings,
                  },
                  { pickAsset: promptForAsset },
                );
              }}
            >
              {commandId}
            </button>
          ))}
        </div>
      ) : null}
      <ExtensionStateStoreProvider value={store}>
        <DocumentOverlayHost
          documentId={PLAYGROUND_DOCUMENT_ID}
          overlays={
            <ExtensionOverlayLayer
              extensions={extensions}
              links={{}}
              editorModules={editorModule ? [editorModule] : []}
            />
          }
        >
          <div ref={hostRef} className="vault-markdown-editor vault-markdown-editor-live min-h-40" />
        </DocumentOverlayHost>
      </ExtensionStateStoreProvider>
    </div>
  );
}

/**
 * The playground has no asset library picker; ask for an asset id instead, so
 * commands that pick an asset still run end to end. An id from your own
 * library also shows its image.
 */
async function promptForAsset(options: {
  kinds: ReadonlyArray<"image" | "pdf">;
  title?: string;
}): Promise<PickedAsset | null> {
  const id = window.prompt(`${options.title ?? "Pick an asset"}: asset id`)?.trim();
  if (!id) return null;
  return { id, kind: options.kinds[0] ?? "image", displayName: id, mimeType: "" };
}

function SettingsPanel({
  manifest,
  settings,
  onChange,
}: {
  manifest: ExtensionManifest;
  settings: Record<string, unknown>;
  onChange: (settings: Record<string, unknown>) => void;
}) {
  const update = (key: string, value: unknown) => {
    const next = { ...settings, [key]: value };
    const parsed = manifest.settings?.schema.safeParse(next);
    onChange(parsed?.success ? parsed.data : next);
  };

  return (
    <section className="grid gap-3 rounded-lg border border-border/60 p-4">
      <h2 className="text-sm font-semibold">Settings (from the manifest; applies live)</h2>
      {manifest.settings?.sections?.map((section) => (
        <div key={section.id} className="grid gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide">{section.label}</h3>
          {section.fields.map((field) => (
            <SettingsField
              key={field.key}
              field={field}
              value={settings[field.key]}
              onChange={(value) => update(field.key, value)}
            />
          ))}
        </div>
      ))}
    </section>
  );
}

function SettingsField({
  field,
  value,
  onChange,
}: {
  field: ExtensionSettingsField;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const label = <span className="text-sm">{field.label}</span>;

  switch (field.type) {
    case "select":
      return (
        <label className="flex items-center justify-between gap-3">
          {label}
          <select
            className="rounded border border-border/60 bg-background px-2 py-1 text-sm"
            value={String(value ?? "")}
            onChange={(event) => onChange(event.target.value)}
          >
            {field.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      );
    case "toggle":
      return (
        <label className="flex items-center justify-between gap-3">
          {label}
          <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
        </label>
      );
    case "number":
      return (
        <label className="flex items-center justify-between gap-3">
          {label}
          <input
            type="number"
            className="w-24 rounded border border-border/60 bg-background px-2 py-1 text-sm"
            value={typeof value === "number" ? value : ""}
            min={field.min}
            max={field.max}
            step={field.step}
            onChange={(event) => onChange(Number(event.target.value))}
          />
        </label>
      );
    case "text":
      return (
        <label className="flex items-center justify-between gap-3">
          {label}
          <input
            className="rounded border border-border/60 bg-background px-2 py-1 text-sm"
            value={String(value ?? "")}
            placeholder={field.placeholder}
            onChange={(event) => onChange(event.target.value)}
          />
        </label>
      );
    case "folder":
      return (
        <p className="flex items-center justify-between gap-3 text-sm">
          {label}
          <span className="text-xs text-muted-foreground">Folder picker: not available in the playground</span>
        </p>
      );
  }
}
