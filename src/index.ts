import { Hono } from "hono";
import { config } from "./infra/config";
import { logger } from "./infra/logger";
import { errorHandler } from "./middleware/error-handler";
import healthRoute from "./routes/health";
import readyRoute from "./routes/ready";
import internalActionsRoute from "./routes/internal-actions";
// Import action registrations (side-effect import)
import "./actions";

export const app = new Hono();

app.onError(errorHandler);

app.route("/health", healthRoute);
app.route("/ready", readyRoute);
app.route("/internal/cms-actions", internalActionsRoute);

logger.info(`Server starting on port ${config.port}`);

export default {
    port: config.port,
    fetch: app.fetch,
};
