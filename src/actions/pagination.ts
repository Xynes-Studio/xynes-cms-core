import { z } from "zod";

export const PUBLIC_LIST_MAX_LIMIT = 100;

export function zPaginationLimit(options: {
  defaultLimit: number;
  maxLimit?: number;
}) {
  const maxLimit = options.maxLimit ?? PUBLIC_LIST_MAX_LIMIT;
  return z
    .number()
    .int()
    .min(1)
    .finite()
    .optional()
    .default(options.defaultLimit)
    .transform((value) => Math.min(value, maxLimit));
}
