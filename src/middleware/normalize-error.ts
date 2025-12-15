import type { Context, Next } from "hono";

export async function normalizeThrownErrors(_c: Context, next: Next) {
  try {
    await next();
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err));
  }
}
