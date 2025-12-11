import { Context, Next } from "hono";
import { logger } from "../infra/logger";

export const errorHandler = (err: Error, c: Context) => {
    logger.error("Request failed", err);
    // TODO: Integrate proper @xynes/errors mapping later
    return c.json({
        error: {
            code: "INTERNAL_SERVER_ERROR",
            message: err.message || "Something went wrong",
        },
    }, 500);
};
