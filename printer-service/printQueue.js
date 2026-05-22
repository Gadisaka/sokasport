import crypto from "crypto";
import { log } from "./logger.js";
import { classifySerialError } from "./printerManager.js";

export class PrintQueue {
  /** @param {import("./printerManager.js").PrinterManager} printerManager */
  constructor(printerManager) {
    this.manager = printerManager;
    /** @type {Array<{ id: string, buffer: Buffer, enqueuedAt: number, resolve: Function }>} */
    this.jobs = [];
    this.processing = false;
    this.lastJobId = null;
    this.lastJobStatus = null;
  }

  getStats() {
    return {
      queueLength: this.jobs.length,
      processing: this.processing,
      lastJobId: this.lastJobId,
      lastJobStatus: this.lastJobStatus,
    };
  }

  /**
   * @param {Buffer} buffer
   * @returns {Promise<{ success: boolean, jobId: string, port?: string, code?: string, message?: string }>}
   */
  enqueue(buffer) {
    const id = crypto.randomUUID();
    log("info", "queue_enqueue", {
      jobId: id,
      queueLength: this.jobs.length + 1,
      bytes: buffer.length,
    });

    return new Promise((resolve) => {
      this.jobs.push({
        id,
        buffer,
        enqueuedAt: Date.now(),
        resolve,
      });
      void this.drain();
    });
  }

  async drain() {
    if (this.processing) return;
    this.processing = true;

    while (this.jobs.length > 0) {
      const job = this.jobs.shift();
      log("info", "queue_dequeue", {
        jobId: job.id,
        remaining: this.jobs.length,
      });

      try {
        await this.manager.write(job.buffer, undefined, job.id);
        this.lastJobId = job.id;
        this.lastJobStatus = "success";
        job.resolve({
          success: true,
          jobId: job.id,
          port: this.manager.comPath,
        });
      } catch (error) {
        this.lastJobId = job.id;
        this.lastJobStatus = "failed";
        const classified = classifySerialError(error);
        job.resolve({
          success: false,
          jobId: job.id,
          port: this.manager.comPath,
          code: classified.code,
          message: classified.message,
        });
      }
    }

    this.processing = false;
  }
}
