/**
 * Starter programs offered when a new fence's language is picked from the
 * completion menu. Each is the smallest program that runs as-is under the
 * runner's profile — Java's class is `Main` because the profile compiles
 * `Main.java` — and is written in the style its formatter produces, so
 * pressing Format straight after inserting one changes nothing.
 *
 * `select` names the text left selected after insertion: the greeting, so the
 * first keystroke replaces it.
 */
export type CodeTemplate = { body: string; select: string };

const GREETING = "Hello, world!";

const TEMPLATES: Record<string, string> = {
  python: `def main() -> None:
    print("${GREETING}")


if __name__ == "__main__":
    main()`,
  javascript: `console.log("${GREETING}");`,
  java: `public class Main {
  public static void main(String[] args) {
    System.out.println("${GREETING}");
  }
}`,
  haskell: `main :: IO ()
main = putStrLn "${GREETING}"`,
  c: `#include <stdio.h>

int main(void) {
  printf("${GREETING}\\n");
  return 0;
}`,
  cpp: `#include <iostream>

int main() {
  std::cout << "${GREETING}\\n";
  return 0;
}`,
};

export function codeTemplate(languageId: string): CodeTemplate | null {
  const body = TEMPLATES[languageId];
  return body ? { body, select: GREETING } : null;
}
