import runHoldReaper from "../../jobs/holdReaper.js";

export async function processHoldReaper(job) {
  const result = await runHoldReaper();
  return { job: job.name, ...result };
}
