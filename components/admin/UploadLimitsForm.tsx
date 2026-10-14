import { Gauge, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ASSET_LIMITS } from "@/lib/config/asset-limits";
import { uploadCeilingMiB, type UploadLimitOverrides } from "@/lib/upload-limits";
import { updateUploadLimitsAction } from "@/server/assets-admin";

const MiB = 1024 * 1024;

const FIELDS = [
  {
    name: "imageMaxMiB",
    label: "Images",
    override: "imageMaxUploadBytes",
    defaultBytes: ASSET_LIMITS.imageMaxBytes,
  },
  {
    name: "pdfMaxMiB",
    label: "PDFs",
    override: "pdfMaxUploadBytes",
    defaultBytes: ASSET_LIMITS.pdfMaxBytes,
  },
  {
    name: "fileMaxMiB",
    label: "Other files",
    override: "fileMaxUploadBytes",
    defaultBytes: ASSET_LIMITS.fileMaxBytes,
  },
] as const;

export function UploadLimitsForm({
  overrides,
}: {
  overrides: UploadLimitOverrides | null;
}) {
  return (
    <section className="grid gap-4 border border-border/60 bg-card/45 p-4 text-card-foreground">
      <div className="grid gap-1">
        <div className="flex items-center gap-2">
          <Gauge className="size-5 text-primary" />
          <h2 className="text-lg font-semibold">Upload limits</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Largest single upload per type, in MiB. Leave a field blank to use the
          default. Changes apply to the next upload. The most any limit can be
          is {uploadCeilingMiB} MiB. &quot;Other files&quot; only matters for users
          allowed to upload any file type.
        </p>
      </div>

      <form action={updateUploadLimitsAction} className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-3">
          {FIELDS.map((field) => {
            const current = overrides?.[field.override] ?? null;
            const defaultMiB = field.defaultBytes / MiB;

            return (
              <label key={field.name} className="grid gap-1.5">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {field.label}
                </span>
                <Input
                  type="number"
                  name={field.name}
                  min={0.1}
                  max={uploadCeilingMiB}
                  step={0.1}
                  defaultValue={current ? roundMiB(current) : ""}
                  placeholder={`${defaultMiB} (default)`}
                  className="h-9"
                />
                <span className="text-xs text-muted-foreground">
                  {current
                    ? `Custom limit. Default is ${defaultMiB} MiB.`
                    : `Using the default, ${defaultMiB} MiB.`}
                </span>
              </label>
            );
          })}
        </div>
        <div>
          <Button type="submit" variant="outline" size="sm">
            <Save className="size-4" />
            Save limits
          </Button>
        </div>
      </form>
    </section>
  );
}

function roundMiB(bytes: number) {
  return Math.round((bytes / MiB) * 10) / 10;
}
