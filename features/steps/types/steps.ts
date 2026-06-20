// Shared contract for phone-only step tracking.
// The runtime implementations live alongside this file as browser-native ES
// modules (.js) so they run unbundled in the static app and inside the
// Capacitor webview. This file is the canonical TypeScript contract.

export type StepSource = 'iphone' | 'android-phone' | 'manual';

export interface DailyStepTotal {
  date: string; // local calendar date, YYYY-MM-DD
  steps: number;
  source: StepSource;
}

/** One persisted record per local date (see repositories/stepRepository.js). */
export interface DailySteps {
  date: string;
  steps: number;
  goal: number;
  source: string;
  lastSyncedAt: string; // ISO-8601
}

/** Web/UI facing service. The phone sensor is the source of truth. */
export interface StepTrackingService {
  isAvailable(): Promise<boolean>;
  requestPermission(): Promise<boolean>;
  getTodaySteps(): Promise<number>;
  getStepsForDate(date: string): Promise<number>;
  getStepsForRange(startDate: string, endDate: string): Promise<DailyStepTotal[]>;
  startLiveUpdates(callback: (steps: number) => void): Promise<void>;
  stopLiveUpdates(): Promise<void>;
}

/** Capacitor native plugin contract (implemented in native/ios + native/android). */
export interface StepCounterPlugin {
  isAvailable(): Promise<{ available: boolean; reason?: string }>;
  requestPermission(): Promise<{ granted: boolean }>;
  getTodaySteps(): Promise<{ steps: number }>;
  getStepsForDate(options: { date: string }): Promise<{ steps: number }>;
  getStepsForRange(options: { startDate: string; endDate: string }): Promise<{ totals: DailyStepTotal[] }>;
  startLiveUpdates(): Promise<void>;
  stopLiveUpdates(): Promise<void>;
  addListener(
    eventName: 'stepUpdate',
    listener: (data: { steps: number }) => void
  ): Promise<{ remove: () => void }>;
}

/** Persistence boundary — localStorage by default, swappable for a real DB. */
export interface StepRepository {
  getByDate(date: string): DailySteps | null;
  upsert(record: DailySteps): void;
  getRange(startDate: string, endDate: string): DailySteps[];
  all(): DailySteps[];
  getGoal(): number;
  setGoal(goal: number): void;
}
