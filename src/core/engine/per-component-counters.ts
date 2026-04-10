export interface PerComponentTickCounters {
  processed: number;
  drops: number;
  timeouts: number;
  overloaded: number;
  backpressured: number;
}

export const EMPTY_COUNTERS: Readonly<PerComponentTickCounters> = Object.freeze({
  processed: 0,
  drops: 0,
  timeouts: 0,
  overloaded: 0,
  backpressured: 0,
});
