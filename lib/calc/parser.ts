/**
 * Recursive-descent parser for `:calc[…]`.
 *
 * This is deliberately an *expression* grammar, not a language: no conditionals,
 * no loops, no strings, and — the load-bearing restriction — no user-defined
 * functions. Named values only. The moment authors can define abstractions, a
 * note app contains a language runtime; keeping this closed is what stops that.
 *
 * Never uses `eval`/`new Function`. Documents here are shared and publishable, so
 * a string-eval path would be remote code execution in a reader's browser.
 */

import type { Decimal } from "@/lib/calc/decimal";
import { tokenize, type Token } from "@/lib/calc/tokenizer";
import { fail, ok, type CalcOutcome } from "@/lib/calc/types";

export type BinaryOperator = "+" | "-" | "*" | "/" | "^";

export type CalcNode =
  | {
      kind: "literal";
      value: Decimal;
      currency: string | null;
      position: number;
    }
  | { kind: "reference"; name: string; position: number }
  | {
      kind: "binary";
      operator: BinaryOperator;
      left: CalcNode;
      right: CalcNode;
      position: number;
    }
  | { kind: "negate"; operand: CalcNode; position: number }
  | { kind: "percent"; operand: CalcNode; position: number }
  | {
      kind: "convert";
      operand: CalcNode;
      currency: string;
      position: number;
    }
  | { kind: "call"; name: string; args: CalcNode[]; position: number };

/**
 * One `:calc[…]` occurrence. `name` is set for a binding (`rent = 1200 CAD`),
 * null for a bare read (`rent * 3`). A binding still produces a value, so it
 * renders inline in prose rather than being an invisible declaration.
 */
export type CalcStatement = {
  name: string | null;
  expression: CalcNode;
};

/** Nesting cap. Guards the recursive descent against a stack overflow. */
export const MAX_DEPTH = 32;

export function parse(source: string): CalcOutcome<CalcStatement> {
  const tokenized = tokenize(source);

  if (!tokenized.ok) {
    return tokenized;
  }

  const parser = new Parser(tokenized.value);
  return parser.parseStatement();
}

class Parser {
  private index = 0;
  private depth = 0;

  constructor(private readonly tokens: Token[]) {}

  private peek(offset = 0): Token {
    return (
      this.tokens[this.index + offset] ?? this.tokens[this.tokens.length - 1]
    );
  }

  private next(): Token {
    const token = this.peek();

    if (token.kind !== "end") {
      this.index += 1;
    }

    return token;
  }

  parseStatement(): CalcOutcome<CalcStatement> {
    let name: string | null = null;

    // Look ahead for `<name> =` before committing, so `a == b` style typos and
    // plain expressions starting with an identifier both stay expressions.
    if (this.peek(1).kind === "assign") {
      const target = this.peek();

      if (target.kind === "currency") {
        return fail(
          "reserved-name",
          `"${target.text}" is a currency code and cannot be used as a name.`,
          target.position,
        );
      }

      if (target.kind !== "identifier") {
        return fail(
          "syntax",
          `"${target.text}" is not a valid name.`,
          target.position,
        );
      }

      name = target.text;
      this.next();
      this.next();
    }

    const expression = this.parseConversion();

    if (!expression.ok) {
      return expression;
    }

    const trailing = this.peek();

    if (trailing.kind !== "end") {
      return fail(
        "syntax",
        `Unexpected "${trailing.text}" after the expression.`,
        trailing.position,
      );
    }

    return ok({ name, expression: expression.value });
  }

  /**
   * `expr in USD` — lowest precedence, so `rent * 3 + fees in USD` converts the
   * whole total. A sub-conversion is written with parentheses.
   */
  private parseConversion(): CalcOutcome<CalcNode> {
    const operand = this.parseAdditive();

    if (!operand.ok) {
      return operand;
    }

    let node = operand.value;

    while (this.peek().kind === "keyword") {
      const keyword = this.next();
      const target = this.next();

      if (target.kind !== "currency") {
        return fail(
          "syntax",
          `"${keyword.text}" must be followed by a currency code, got "${target.text || "end of expression"}".`,
          target.position,
        );
      }

      node = {
        kind: "convert",
        operand: node,
        currency: target.text,
        position: keyword.position,
      };
    }

    return ok(node);
  }

  private parseAdditive(): CalcOutcome<CalcNode> {
    const first = this.parseMultiplicative();

    if (!first.ok) {
      return first;
    }

    let left = first.value;

    while (
      this.peek().kind === "operator" &&
      (this.peek().text === "+" || this.peek().text === "-")
    ) {
      const operator = this.next();
      const right = this.parseMultiplicative();

      if (!right.ok) {
        return right;
      }

      left = {
        kind: "binary",
        operator: operator.text as BinaryOperator,
        left,
        right: right.value,
        position: operator.position,
      };
    }

    return ok(left);
  }

  private parseMultiplicative(): CalcOutcome<CalcNode> {
    const first = this.parseUnary();

    if (!first.ok) {
      return first;
    }

    let left = first.value;

    while (
      this.peek().kind === "operator" &&
      (this.peek().text === "*" || this.peek().text === "/")
    ) {
      const operator = this.next();
      const right = this.parseUnary();

      if (!right.ok) {
        return right;
      }

      left = {
        kind: "binary",
        operator: operator.text as BinaryOperator,
        left,
        right: right.value,
        position: operator.position,
      };
    }

    return ok(left);
  }

  /** Unary minus binds looser than `^`, so `-2^2` is `-(2^2)`. */
  private parseUnary(): CalcOutcome<CalcNode> {
    const token = this.peek();

    if (token.kind === "operator" && token.text === "-") {
      this.next();
      const operand = this.parseUnary();

      if (!operand.ok) {
        return operand;
      }

      return ok({
        kind: "negate",
        operand: operand.value,
        position: token.position,
      });
    }

    return this.parseExponent();
  }

  /** Right-associative: `2^3^2` is `2^(3^2)`. */
  private parseExponent(): CalcOutcome<CalcNode> {
    const base = this.parsePostfix();

    if (!base.ok) {
      return base;
    }

    const token = this.peek();

    if (token.kind !== "operator" || token.text !== "^") {
      return base;
    }

    this.next();
    const exponent = this.parseUnary();

    if (!exponent.ok) {
      return exponent;
    }

    return ok({
      kind: "binary",
      operator: "^",
      left: base.value,
      right: exponent.value,
      position: token.position,
    });
  }

  private parsePostfix(): CalcOutcome<CalcNode> {
    const primary = this.parsePrimary();

    if (!primary.ok) {
      return primary;
    }

    let node = primary.value;

    while (this.peek().kind === "percent") {
      const token = this.next();
      node = { kind: "percent", operand: node, position: token.position };
    }

    return ok(node);
  }

  private parsePrimary(): CalcOutcome<CalcNode> {
    if (this.depth >= MAX_DEPTH) {
      return fail(
        "limit-exceeded",
        `Expression is nested deeper than ${MAX_DEPTH} levels.`,
        this.peek().position,
      );
    }

    const token = this.next();

    if (token.kind === "number") {
      // `100 CAD` — a currency code directly after a literal is its unit.
      const unit = this.peek().kind === "currency" ? this.next().text : null;

      return ok({
        kind: "literal",
        value: token.value as Decimal,
        currency: unit,
        position: token.position,
      });
    }

    if (token.kind === "identifier") {
      if (this.peek().kind === "lparen") {
        return this.parseCall(token);
      }

      return ok({
        kind: "reference",
        name: token.text,
        position: token.position,
      });
    }

    if (token.kind === "lparen") {
      this.depth += 1;
      const inner = this.parseConversion();
      this.depth -= 1;

      if (!inner.ok) {
        return inner;
      }

      if (this.peek().kind !== "rparen") {
        return fail("syntax", "Missing closing parenthesis.", token.position);
      }

      this.next();
      return ok(inner.value);
    }

    if (token.kind === "currency") {
      return fail(
        "syntax",
        `"${token.text}" is a currency code; it needs an amount, like "100 ${token.text}".`,
        token.position,
      );
    }

    if (token.kind === "end") {
      return fail("syntax", "Expression is empty.", token.position);
    }

    return fail("syntax", `Unexpected "${token.text}".`, token.position);
  }

  private parseCall(name: Token): CalcOutcome<CalcNode> {
    this.next(); // consume "("
    this.depth += 1;

    const args: CalcNode[] = [];

    if (this.peek().kind !== "rparen") {
      for (;;) {
        const argument = this.parseConversion();

        if (!argument.ok) {
          this.depth -= 1;
          return argument;
        }

        args.push(argument.value);

        if (this.peek().kind !== "comma") {
          break;
        }

        this.next();
      }
    }

    this.depth -= 1;

    if (this.peek().kind !== "rparen") {
      return fail(
        "syntax",
        `Missing closing parenthesis for "${name.text}".`,
        name.position,
      );
    }

    this.next();

    return ok({
      kind: "call",
      name: name.text,
      args,
      position: name.position,
    });
  }
}
