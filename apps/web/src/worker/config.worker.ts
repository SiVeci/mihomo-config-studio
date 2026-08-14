import { createWorkerState, handleWorkerRequest } from './protocol.js';
import type { WorkerRequest, WorkerResponse } from './protocol.js';

/**
 * Narrow, file-local shadow of the ambient `self` — deliberately not the
 * `webworker` lib's `DedicatedWorkerGlobalScope`. Adding that lib project-wide
 * would collide with the `dom` lib the rest of `apps/web` needs; referencing
 * it per-file (`/// <reference lib="webworker" />`) redeclares globals like
 * `self` that `dom` already declares differently. A local `declare const`
 * types exactly what this file touches without either problem.
 */
declare const self: {
  onmessage: ((event: { data: WorkerRequest }) => void) | null;
  postMessage(message: WorkerResponse): void;
};

const state = createWorkerState();

self.onmessage = (event) => {
  self.postMessage(handleWorkerRequest(state, event.data));
};
