import { Hono } from "hono";
import { config } from "./infra/config";
import { logger } from "./infra/logger";
import { errorHandler } from "./middleware/error-handler";
import healthRoute from "./routes/health";

const app = new Hono();

app.onError(errorHandler);

app.route("/health", healthRoute);

logger.info(`Server starting on port ${config.port}`);

export default {
    port: config.port,
    fetch: app.fetch,
};
