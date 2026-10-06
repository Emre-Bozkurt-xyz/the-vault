---
calc_currency: CAD
---

# Hosting budget

The inputs, as a declarations block:

:::calc
rent = 1200 CAD
domains = 42 USD
backups = 9.5 EUR
:::

Monthly total: :calc[total = rent + domains + backups], or :calc[total in USD]{as=USD} for the US office.

A quarter costs :calc[total * 3]{dp=0}, and the working reads :calc[rent * 3]{show=expr}.

A folded block keeps its inputs out of the way:

:::calc{collapsed}
margin = 0.15
:::

With margin: :calc[total * (1 + margin)].

An error stays on its own value: :calc[rent * domains].

Quoted syntax is never evaluated: `:calc[rent * 3]` and

```md
:::calc
ignored = 1 CAD
:::
```
