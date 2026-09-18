---
title: Calc
slug: calc
category: Extensions
order: 30
public: true
---

# Calc

Calc puts computed values inside your prose, so a document can hold a small
report without turning into a spreadsheet.

```md
Hosting is :calc[rent = 1200 CAD] per month.
Domains came to :calc[domains = 42 USD].
Quarter total: :calc[rent * 3 + domains in USD].
```

Turn it on from **Settings → Extensions** (see [[guide:extensions-and-settings]]).

It is a calculator that understands currency, not a currency widget:
`:calc[3 * 7]` is as valid as a conversion.

## Writing a value

Type `/calc` for an inline value, or `/calcblock` for a block of declarations.
You can also type the syntax directly — `:::` at the start of a line opens a menu
of block types.

An inline value is `:calc[…]`:

```md
:calc[2 + 2]                 a bare expression
:calc[rent = 1200 CAD]       binds the name `rent`, and shows the value
:calc[rent * 3]              uses a name bound earlier in the document
:calc[rent in USD]           converts for display
```

A name must be bound **before** it is used, reading top to bottom. That rule is
what makes circular definitions impossible.

## Declaration blocks

When a document has several inputs, group them:

```md
:::calc
rent = 1200 CAD
domains = 42 CAD
transfer = 18.50 CAD
:::
```

The block renders as a tidy list with the values aligned. Add `{collapsed}` to
fold it away for readers — you will still see the rows while editing, since
hiding your own inputs would make the block impossible to work on.

## Currency

Amounts are written as a number and an ISO code in capitals: `1200 CAD`,
`42 USD`, `¥1,200` comes out of `1200 JPY`. Codes must be uppercase, which is how
Vault tells the currency `CAD` from a name you called `cad`.

Conversion uses daily European Central Bank rates:

```md
:calc[rent in USD]
:calc[rent]{as=USD}
```

**Conversion never rewrites your document.** The amount you typed stays exactly
as written; the conversion is only how it is displayed, so switching back costs
nothing and no exchange rate is silently frozen into your text.

What each unit combination does:

| Expression | Result |
|---|---|
| `100 CAD + 20 CAD` | CAD |
| `100 CAD * 3` | CAD |
| `100 CAD / 20 CAD` | a plain number |
| `100 CAD + 20 USD` | CAD — the left side decides |
| `100 CAD * 20 CAD` | an error |
| `100 CAD + 20` | an error |
| `100 CAD + 20%` | an error, deliberately: what the percent applies to is too easy to get wrong |

## Functions

`sum`, `min`, `max`, `abs`, `round`, and `any` are available:

```md
:calc[sum(rent * 3, domains, transfer)]
:calc[round(rent / 3, 2)]
```

There are no functions you can define yourself. Names hold values, and a document
that needs more than that wants a code block, not a calculator.

## Display options

Options go in braces after the value, separated by spaces:

```md
:calc[rent]{show=expr}     show the expression instead of the result
:calc[rent]{show=name}     show the bound name
:calc[rent]{dp=0}          decimal places
:calc[rent]{as=EUR}        display in this currency
```

## Document-wide settings

Two document properties change how a whole document reads:

```md
---
calc_currency: USD
calc_rate_date: 2026-09-08
---
```

`calc_currency` denominates every value that does not say otherwise.
`calc_rate_date` pins conversions to one day's rates, which is what makes a
report reproducible — anyone opening it later sees the same figures you did.

These live in the document rather than in your settings on purpose: "this report
is in USD, at this day's rates" is a claim the document makes, so it travels with
the document, survives export, and is visible to anyone who can read it.

Anything you spell out beats the document default: `{as=EUR}` wins over
`in EUR`, which wins over `calc_currency`.

## When something is wrong

A bad expression becomes one error chip with the reason, never a blank page or a
broken document. A conversion with no rate available says so rather than guessing.

## Reading values without doing the arithmetic

With Calc enabled, an AI assistant connected to your vault can read every
computed value in a document — the names it binds, each expression, and its
formatted result — and can evaluate a follow-up expression against those names
without editing anything. It reads the document's own figures rather than
re-deriving them, which is one less chance to be wrong.

## Where calc values do *not* compute

Inside inline `code` and fenced code blocks, `:calc[…]` stays literal text. That
is how this guide shows the syntax without every example turning into a number.
