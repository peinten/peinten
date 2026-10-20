/** Runs tasks one at a time in submission order. Operations, strokes and peer commits all go through it. */
export class ApplyQueue {
  #tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => T | Promise<T>): Promise<T> {
    const result = this.#tail.then(task);
    this.#tail = result.catch(() => undefined);
    return result;
  }
}
