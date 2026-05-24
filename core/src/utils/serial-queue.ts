// 串行队列：同一 key 的任务按顺序执行，不同 key 并行
// 用法：queue.enqueue("session-a", () => doWork())

export class SerialQueue {
  private queues = new Map<string, Promise<unknown>>();

  async enqueue<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(key) ?? Promise.resolve();
    const task: Promise<T> = prev.catch(() => {}).then(() => fn());
    this.queues.set(key, task);

    task.finally(() => {
      if (this.queues.get(key) === task) {
        this.queues.delete(key);
      }
    });

    return task;
  }
}
