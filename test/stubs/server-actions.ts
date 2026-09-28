// Vitest stand-in for the extension server actions client code imports.
//
// In the app, a "use server" module imported by a client component becomes an
// RPC stub at build time. Vitest has no such transform, so importing the real
// module would load auth and the database. Extension components and hooks
// import these; unit tests exercise them without a server, and any test that
// actually calls one gets a clear failure instead of a hang.
function unavailable(name: string): never {
  throw new Error(`${name} is a server action and is not available in unit tests.`);
}

export async function runExtensionActionAction(): Promise<never> {
  return unavailable("runExtensionActionAction");
}

export async function getDocumentExtensionStateAction(): Promise<never> {
  return unavailable("getDocumentExtensionStateAction");
}

export async function listDocumentExtensionStatesAction(): Promise<never> {
  return unavailable("listDocumentExtensionStatesAction");
}

export async function upsertDocumentExtensionStateAction(): Promise<never> {
  return unavailable("upsertDocumentExtensionStateAction");
}

export async function deleteDocumentExtensionStateAction(): Promise<never> {
  return unavailable("deleteDocumentExtensionStateAction");
}
