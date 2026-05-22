import cron from "node-cron";
import syncLeagues from "./syncLeagues.js";
import syncTeams from "./syncTeams.js";
import syncFixtures from "./syncFixtures.js";
import syncOdds from "./syncOdds.js";
import syncLiveFixtures from "./syncLiveFixtures.js";

/**
 * Legacy in-process cron registration.
 *
 * The runtime has moved to BullMQ (see `queues/scheduler.js` invoked by
 * `worker.js`). The API process should NOT register these schedules anymore
 * because they would race with the worker and double the upstream usage.
 *
 * `startCronJobs()` is kept for the `RUN_WORKER_INLINE=true` dev shortcut
 * (single-process local dev where you don't want to run the worker in a
 * second terminal). It refuses to register if the worker is enabled.
 */
export function startCronJobs() {
  if (process.env.RUN_WORKER_INLINE !== "true") {
    console.log(
      "[Cron] in-process cron disabled – jobs are owned by the BullMQ worker (set RUN_WORKER_INLINE=true to override)",
    );
    return;
  }

  console.warn(
    "[Cron] RUN_WORKER_INLINE=true – falling back to node-cron in the API process. Do NOT use in production.",
  );

  cron.schedule("0 3 * * *", syncLeagues);
  cron.schedule("0 4 * * *", syncTeams);
  cron.schedule("*/30 * * * *", syncFixtures);
  cron.schedule("*/2 * * * *", syncOdds);
  cron.schedule("*/30 * * * * *", syncLiveFixtures);

  console.log("[Cron] all sync jobs registered (inline mode)");
}
