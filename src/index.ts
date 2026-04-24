import { Hono } from "hono";
// Import action registrations (side-effect import)
import "./actions";
import { config } from "./infra/config";
import { logger } from "./infra/logger";
import { errorHandler } from "./middleware/error-handler";
import { normalizeThrownErrors } from "./middleware/normalize-error";
import healthRoute from "./routes/health";
import internalActionsRoute from "./routes/internal-actions";
import readyRoute from "./routes/ready";
import { startScheduledEntryPublisher } from "./scheduling/scheduled-entry-publisher";

export const app = new Hono();

app.use("*", normalizeThrownErrors);
app.onError(errorHandler);

app.route("/health", healthRoute);
app.route("/ready", readyRoute);
app.route("/internal/cms-actions", internalActionsRoute);

logger.info(`Server starting on port ${config.port}`);

if (process.env.NODE_ENV !== "test") {
  startScheduledEntryPublisher();
}

export default {
  port: config.port,
  fetch: app.fetch,
};
