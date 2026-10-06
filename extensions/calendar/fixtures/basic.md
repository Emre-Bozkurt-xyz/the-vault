# Sprint planning

A public calendar: every reader sees its entries, including anonymous readers
of a published page.

:::calendar{id=sprint}

A private calendar: only people with access to the document see it. On a
public page it renders empty.

:::calendar{id=personal}

An anchor with a malformed id renders an empty calendar that cannot save:

:::calendar{id=bad!id}

```md
:::calendar{id=inside-code}
```

The anchor above is inside a code fence, so it stays code.
