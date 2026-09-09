import { describe, expect, it } from "vitest";

import type { FxRateTable } from "@/lib/calc/fx";
import { localBuiltInExtensions } from "@/lib/extensions/catalog";
import type {
  ExtensionAgentActionContext,
  VaultExtensionAgentAction,
} from "@/lib/extensions/types";

const TABLE: FxRateTable = {
  base: "EUR",
  date: "2026-09-08",
  provider: "ECB",
  rates: { USD: "1.1614", CAD: "1.6033" },
};

const DOC = `---
calc_currency: CAD
calc_rate_date: 2026-09-08
---

# Q1

:::calc
rent = 1200 CAD
domains = 42 CAD
:::

Quarter total :calc[rent * 3 + domains], EU host :calc[300 EUR].

Broken: :calc[2 CAD * 3 CAD].
`;

function action(id: string): VaultExtensionAgentAction {
  const found = localBuiltInExtensions
    .flatMap((extension) => extension.agent?.actions ?? [])
    .find((candidate) => candidate.id === id);

  if (!found) {
    throw new Error(`no action ${id}`);
  }

  return found;
}

/** The sandbox the dispatcher builds, with only what these actions may use. */
function context(markdown = DOC, fxTable: FxRateTable | null = TABLE) {
  return {
    user: { id: "u1" },
    fx: { getTable: async () => fxTable },
    document: {
      id: "d1",
      canEdit: false,
      state: {
        get: async () => null,
        set: async () => {},
        list: async () => [],
        delete: async () => {},
      },
      markdown: { read: async () => markdown },
    },
  } as unknown as ExtensionAgentActionContext;
}

async function run(id: string, input: unknown, ctx = context()) {
  const target = action(id);
  return target.handler(target.input.parse(input), ctx);
}

describe("vault.calc.listValues", () => {
  it("reports the document's settings, bindings, and values", async () => {
    const result = await run("vault.calc.listValues", {});
    const data = result.data as {
      displayCurrency: string | null;
      rateDate: string | null;
      bindings: string[];
      values: Array<{ name: string | null; state: string; value: string }>;
    };

    expect(data.displayCurrency).toBe("CAD");
    expect(data.rateDate).toBe("2026-09-08");
    expect(data.bindings).toEqual(["rent", "domains"]);
    expect(data.values.map((value) => value.name)).toContain("rent");
  });

  it("returns formatted results, not raw numbers for the model to re-add", async () => {
    const result = await run("vault.calc.listValues", {});
    const data = result.data as {
      values: Array<{ expression: string; value: string }>;
    };
    const total = data.values.find(
      (value) => value.expression === "rent * 3 + domains",
    );

    expect(total?.value).toContain("3,642.00");
  });

  it("carries conversion state and provenance", async () => {
    const result = await run("vault.calc.listValues", {});
    const data = result.data as {
      values: Array<{ expression: string; state: string; provenance: string | null }>;
    };
    // 300 EUR under `calc_currency: CAD` is displayed converted.
    const eu = data.values.find((value) => value.expression === "300 EUR");

    expect(eu?.state).toBe("converted");
    expect(eu?.provenance).toContain("ECB");
  });

  it("can omit failing values", async () => {
    const withErrors = (await run("vault.calc.listValues", {})).data as {
      values: unknown[];
    };
    const without = (
      await run("vault.calc.listValues", { includeErrors: false })
    ).data as { values: unknown[] };

    expect(without.values.length).toBe(withErrors.values.length - 1);
  });

  it("validates against its declared output schema", async () => {
    const result = await run("vault.calc.listValues", {});

    expect(action("vault.calc.listValues").output?.safeParse(result.data).success).toBe(
      true,
    );
  });

  it("refuses without document read access", async () => {
    await expect(
      run("vault.calc.listValues", {}, {
        user: { id: "u1" },
      } as ExtensionAgentActionContext),
    ).rejects.toThrow(/read access/);
  });
});

describe("vault.calc.evaluate", () => {
  it("evaluates against names the document binds", async () => {
    const result = await run("vault.calc.evaluate", {
      expression: "rent * 12",
    });
    const data = result.data as { value: string | null; state: string };

    expect(data.state).toBe("ok");
    expect(data.value).toContain("14,400.00");
  });

  it("converts and reports the rate it used", async () => {
    const result = await run("vault.calc.evaluate", {
      expression: "rent in USD",
    });
    const data = result.data as {
      state: string;
      value: string | null;
      provenance: string | null;
    };

    // An explicit `in USD` beats the document's `calc_currency: CAD`, so the
    // result stays in USD rather than being dragged back.
    expect(data.state).toBe("converted");
    expect(data.value).toContain("$");
    expect(data.provenance).toContain("1 CAD =");
  });

  it("reports a bad expression instead of throwing", async () => {
    const result = await run("vault.calc.evaluate", {
      expression: "rent * ",
    });
    const data = result.data as { value: string | null; state: string };

    expect(data.state).toBe("error");
    expect(data.value).toBeNull();
  });

  it("reports an unknown name rather than inventing a figure", async () => {
    const result = await run("vault.calc.evaluate", {
      expression: "salaries * 2",
    });
    const data = result.data as { state: string; message: string | null };

    expect(data.state).toBe("error");
    expect(data.message).toContain("not defined");
  });

  it("does not modify the document", async () => {
    // `mutates` drives whether the dispatcher demands edit access.
    expect(action("vault.calc.evaluate").mutates ?? false).toBe(false);
    expect(action("vault.calc.listValues").mutates ?? false).toBe(false);
  });

  it("works with no rates at all", async () => {
    const result = await run(
      "vault.calc.evaluate",
      { expression: "rent * 2" },
      context(DOC, null),
    );

    expect((result.data as { state: string }).state).toBe("ok");
  });
});

describe("the calc extension registration", () => {
  const calc = localBuiltInExtensions.find(
    (extension) => extension.id === "vault.calc",
  );

  it("declares only the permissions its actions use", () => {
    expect(calc?.permissions).toEqual(["document:read"]);

    for (const declared of calc?.agent?.actions ?? []) {
      for (const permission of declared.permissions ?? []) {
        expect(calc?.permissions).toContain(permission);
      }
    }
  });

  it("offers both slash commands", () => {
    expect(
      calc?.markdown?.slashCommands?.map((command) => command.label),
    ).toEqual(["calc", "calcblock"]);
  });

  // The two differ in more than their markdown: an inline value typed into a
  // sentence must not be inserted as its own block, which is what every other
  // extension contribution does and what the default placement still means.
  it("marks the inline value inline and leaves the block a block", () => {
    const [inline, block] = calc?.markdown?.slashCommands ?? [];

    expect(inline.insert.placement).toBe("inline");
    expect(inline.insert.markdown).toBe(":calc[]");
    expect(block.insert.placement ?? "block").toBe("block");
    expect(block.insert.markdown).toBe(":::calc\n\n:::");
  });

  // The cursor has to land inside the brackets and on the blank statement line
  // respectively, or every insertion needs the same two keystrokes to fix up.
  it("seats the cursor where the author types next", () => {
    const [inline, block] = calc?.markdown?.slashCommands ?? [];

    expect((inline.insert.markdown as string).slice(inline.insert.cursorOffset)).toBe(
      "]",
    );
    expect((block.insert.markdown as string).slice(block.insert.cursorOffset)).toBe(
      "\n:::",
    );
  });
});
