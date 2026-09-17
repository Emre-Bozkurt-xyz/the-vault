"use client";

import { useState, useTransition, type ReactNode } from "react";

import {
  NumberControl,
  SelectControl,
  ToggleControl,
} from "@/components/settings/PreferenceSettingsSections";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  ExtensionSettingsField,
  ExtensionSettingsSection,
} from "@/lib/extensions/types";
import {
  resetUserExtensionSettingsAction,
  upsertUserExtensionSettingsAction,
} from "@/server/user-settings-actions";

type ExtensionSettingsPageProps = {
  extensionId: string;
  version: number;
  sections: ExtensionSettingsSection[];
  /** Defaults merged with what the user has stored. */
  values: Record<string, unknown>;
  defaults: Record<string, unknown>;
  /** The user's own folders, for `folder` fields. Empty when none are declared. */
  folderOptions: Array<{ id: string; path: string }>;
};

/**
 * One extension's settings, rendered generically from what the extension
 * declares in `lib/extensions/catalog.ts`.
 *
 * Deliberately quieter than the app's own settings pages — no card, no icons,
 * rows divided by hairlines — so an extension's options read as secondary to the
 * core ones. Every change saves immediately through
 * `upsertUserExtensionSettingsAction`, which validates against the extension's
 * own schema on the server; this form only ever sends plain values.
 */
export function ExtensionSettingsPage({
  extensionId,
  version,
  sections,
  values: initialValues,
  defaults,
  folderOptions,
}: ExtensionSettingsPageProps) {
  const [values, setValues] = useState(initialValues);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function save(next: Record<string, unknown>) {
    const previous = values;
    setValues(next);
    setError(null);
    startTransition(async () => {
      try {
        await upsertUserExtensionSettingsAction({ extensionId, settings: next });
      } catch {
        // The server rejected the value against the extension's schema; put the
        // form back to what is actually stored rather than show a lie.
        setValues(previous);
        setError("That value was not accepted.");
      }
    });
  }

  function reset() {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("extensionId", extensionId);
      await resetUserExtensionSettingsAction(formData);
      setValues(defaults);
    });
  }

  return (
    <div className="grid max-w-3xl gap-7">
      <div className="-mb-4 flex h-4 justify-end">
        <span className="text-xs text-muted-foreground">
          {error ? (
            <span className="text-destructive">{error}</span>
          ) : isPending ? (
            "Saving…"
          ) : (
            "Saved"
          )}
        </span>
      </div>

      {sections.map((section) => (
        <section key={section.id}>
          {sections.length > 1 || section.label ? (
            <h3 className="pb-1.5 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {section.label}
            </h3>
          ) : null}
          <div className="border-t border-border/60">
            {section.fields.map((field) => (
              <FieldRow key={field.key} field={field}>
                <FieldControl
                  field={field}
                  value={values[field.key]}
                  folderOptions={folderOptions}
                  onChange={(value) => save({ ...values, [field.key]: value })}
                />
              </FieldRow>
            ))}
          </div>
        </section>
      ))}

      <footer className="flex items-center justify-between gap-3 pt-1 text-xs text-muted-foreground">
        <span>
          {extensionId} · v{version}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={isPending}
          onClick={reset}
        >
          Reset to defaults
        </Button>
      </footer>
    </div>
  );
}

function FieldRow({
  field,
  children,
}: {
  field: ExtensionSettingsField;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-2 border-b border-border/60 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
      <div className="min-w-0">
        <p className="text-sm">{field.label}</p>
        {field.description ? (
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
            {field.description}
          </p>
        ) : null}
      </div>
      <div className="flex min-w-0 justify-start sm:justify-end">{children}</div>
    </div>
  );
}

function FieldControl({
  field,
  value,
  folderOptions,
  onChange,
}: {
  field: ExtensionSettingsField;
  value: unknown;
  folderOptions: Array<{ id: string; path: string }>;
  onChange: (value: unknown) => void;
}) {
  switch (field.type) {
    case "toggle":
      return <ToggleControl checked={value === true} onChange={onChange} />;
    case "select":
      return (
        <SelectControl
          value={typeof value === "string" ? value : ""}
          options={field.options.map((option) => [option.value, option.label])}
          onChange={onChange}
        />
      );
    case "number":
      return (
        <NumberControl
          value={typeof value === "number" ? value : 0}
          min={field.min ?? Number.MIN_SAFE_INTEGER}
          max={field.max ?? Number.MAX_SAFE_INTEGER}
          step={field.step}
          onChange={onChange}
        />
      );
    case "text":
      return (
        <TextFieldControl
          value={typeof value === "string" ? value : ""}
          placeholder={field.placeholder}
          onCommit={onChange}
        />
      );
    case "folder": {
      const selected = typeof value === "string" ? value : "";
      // A chosen folder that has since been deleted is kept visible rather than
      // silently shown as the empty option — the stored value is still that id,
      // and the server falls back from it wherever it is used.
      const missing =
        selected && !folderOptions.some((option) => option.id === selected);

      return (
        <SelectControl
          value={selected}
          options={[
            ["", field.emptyLabel],
            ...(missing ? ([[selected, "Unavailable folder"]] as [string, string][]) : []),
            ...folderOptions.map(
              (option) => [option.id, option.path] as [string, string],
            ),
          ]}
          onChange={(next) => onChange(next || null)}
        />
      );
    }
  }
}

/** Text saves when the field is left, not per keystroke. */
function TextFieldControl({
  value,
  placeholder,
  onCommit,
}: {
  value: string;
  placeholder?: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  return (
    <Input
      value={draft}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== value) {
          onCommit(draft);
        }
      }}
      className="w-56"
    />
  );
}
