import { z } from "zod";

export const IsoDateTimeStringSchema = z.string().datetime({ local: true });
