import { Context, Next } from "hono";
import { logger } from "../infra/logger";

export const errorHandler = async (c: Context, next: Next) => {
    try {
        await next();
    } catch (err: any) {
        logger.error("Request failed", err);
        // TODO: Integrate proper @xynes/errors mapping later
        return c.json({
            error: {
                code: "INTERNAL_SERVER_ERROR",
                message: err.message || "Something went wrong",
            },
        }, 500);
    }
};
