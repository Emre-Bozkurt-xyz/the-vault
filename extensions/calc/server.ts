import "server-only";

import { z } from "zod";

import { defineServer } from "@/lib/extension-api/server";
// Core modules until slice 6 moves calc's engine into this folder (plan §14).
import { parseCalcSettings } from "@/lib/calc/settings";
import { EMPTY_PRESENTATION } from "@/lib/markdown/calc-directive";
import {
  buildCalcDocument,
  calcKey,
  calcPiecesFromMarkdown,
} from "@/lib/markdown/calc-document";

import manifest from "./manifest";

const calcValueSchema = z.object({
  key: z.string(),
  name: z
    .string()
    .nullable()
    .describe("Bound name, or null for a bare expression."),
  expression: z.string(),
  value: z.string().describe('Formatted result, e.g. "CA$1,200.00".'),
  state: z.enum(["ok", "converted", "stale", "error"]),
  message: z
    .string()
    .nullable()
    .describe("Failure reason when state is error."),
  provenance: z
    .string()
    .nullable()
    .describe("Rate, provider and day behind a converted value."),
});

const listValuesInputSchema = z.object({
  includeErrors: z
    .boolean()
    .default(true)
    .describe("Include values that failed to evaluate (default true)."),
});

const listValuesOutputSchema = z.object({
  displayCurrency: z.string().nullable(),
  rateDate: z.string().nullable(),
  bindings: z.array(z.string()),
  values: z.array(calcValueSchema),
});

const evaluateInputSchema = z.object({
  expression: z
    .string()
    .min(1)
    .max(500)
    .describe(
      'A calc expression, e.g. "rent * 3 + domains in USD". Names bound anywhere in the document are in scope.',
    ),
});

const evaluateOutputSchema = z.object({
  expression: z.string(),
  value: z.string().nullable(),
  state: z.enum(["ok", "converted", "stale", "error"]),
  message: z.string().nullable(),
  provenance: z.string().nullable(),
});

export default defineServer(manifest, {
  // Every surface prices `:calc` conversions from the same daily table.
  // `calc_rate_date` pins the report to a day so its totals stay the same on
  // every reading instead of drifting with the market. Never blocks on the
  // provider when anything is cached, and null (not an error) when nothing is:
  // conversions then report a missing rate and the document still renders.
  loadRenderData: async (context) => ({
    fxTable: await context.fx.getTable({
      date: parseCalcSettings(context.document.markdown).rateDate ?? undefined,
    }),
  }),
  actions: [
    {
      id: "vault.calc.listValues",
      title: "List calculated values",
      description:
        "Read every :calc value in a document — the names it binds, each expression, and its formatted result. Use this to answer questions about a document's figures instead of re-doing its arithmetic.",
      scope: "document",
      mutates: false,
      permissions: ["document:read"],
      input: listValuesInputSchema,
      output: listValuesOutputSchema,
      async handler(input, context) {
        const markdown = await context.document?.markdown?.read?.();

        if (markdown === undefined) {
          throw new Error("This action requires document read access.");
        }

        const { includeErrors } = input as z.infer<
          typeof listValuesInputSchema
        >;
        const settings = parseCalcSettings(markdown);
        const fxTable = (await context.fx?.getTable()) ?? null;

        const document = buildCalcDocument(calcPiecesFromMarkdown(markdown), {
          fxTable,
          displayCurrency: settings.displayCurrency,
        });

        const values = [...document.results.values()]
          .filter((value) => includeErrors || value.state !== "error")
          .map((value) => ({
            key: value.key,
            name: value.labelKind === "name" ? value.label : null,
            expression: value.expression,
            value: value.value,
            state: value.state,
            message: value.message,
            provenance: value.provenance,
          }));

        return {
          data: {
            displayCurrency: settings.displayCurrency,
            rateDate: settings.rateDate,
            bindings: document.bindings,
            values,
          },
          message: `${values.length} calc value${values.length === 1 ? "" : "s"}, ${document.bindings.length} named.`,
        };
      },
    },
    {
      id: "vault.calc.evaluate",
      title: "Evaluate against a document",
      description:
        'Evaluate a calc expression using the names a document defines, without editing it. Use for follow-up arithmetic the document does not already state, e.g. "what is rent * 12 in USD".',
      scope: "document",
      mutates: false,
      permissions: ["document:read"],
      input: evaluateInputSchema,
      output: evaluateOutputSchema,
      async handler(input, context) {
        const markdown = await context.document?.markdown?.read?.();

        if (markdown === undefined) {
          throw new Error("This action requires document read access.");
        }

        const { expression } = input as z.infer<typeof evaluateInputSchema>;
        const settings = parseCalcSettings(markdown);
        const fxTable = (await context.fx?.getTable()) ?? null;

        // Appended as one more occurrence at the end, so it sees every name
        // the document binds and obeys the same definition-before-use rule
        // a reader would.
        const pieces = [
          ...calcPiecesFromMarkdown(markdown),
          {
            type: "calc-block" as const,
            lines: [{ expression }],
            presentation: EMPTY_PRESENTATION,
            collapsed: false,
          },
        ];

        const document = buildCalcDocument(pieces, {
          fxTable,
          displayCurrency: settings.displayCurrency,
        });
        const result = document.results.get(calcKey(pieces.length - 1, 0));

        if (!result) {
          throw new Error("Expression could not be evaluated.");
        }

        return {
          data: {
            expression,
            value: result.state === "error" ? null : result.value,
            state: result.state,
            message: result.message,
            provenance: result.provenance,
          },
          message:
            result.state === "error"
              ? `Could not evaluate: ${result.message}`
              : `${expression} = ${result.value}`,
        };
      },
    },
  ],
});
