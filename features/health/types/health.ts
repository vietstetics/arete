// Connected Health — shared contract.
// Like features/steps/types/steps.ts, this file is the canonical TypeScript
// contract; the runtime implementations live alongside it as browser-native
// ES modules (.js) so they run unbundled in the static app and inside the
// Capacitor webview. Run `npm run typecheck` to validate this contract.

export type HealthProviderId =
  | 'apple_health'
  | 'health_connect'
  | 'oura'
  | 'whoop'
  | 'fitbit'
  | 'garmin'
  | 'polar'
  | 'withings'
  | 'samsung_health';

export type HealthRecordType =
  | 'steps'
  | 'sleep'
  | 'workout'
  | 'active_calories'
  | 'distance'
  | 'heart_rate'
  | 'resting_heart_rate'
  | 'hrv'
  | 'weight'
  | 'body_fat';

export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'unavailable';

export interface ConnectionStatus {
  provider: HealthProviderId;
  state: ConnectionState;
  /** OS-level permission state. HealthKit never reveals read denials, hence 'requested'. */
  permissionState: 'not_requested' | 'requested' | 'granted' | 'partial' | 'denied';
  lastSyncAt?: string;      // ISO-8601 of last successful sync
  lastError?: string;       // last sync error, shown in the UI, never destructive
  historyDays?: 1 | 7 | 30 | 90;
}

export type HealthCapability = HealthRecordType;

export interface HealthSyncResult {
  provider: HealthProviderId;
  ok: boolean;
  imported: number;         // new records stored
  duplicates: number;       // skipped/flagged by deduplication
  error?: string;
  syncedAt: string;         // ISO-8601
}

/** One normalised record. Uniqueness key: sourceProvider + sourceRecordId. */
export interface HealthRecord {
  id: string;               // `${sourceProvider}:${sourceRecordId}`
  type: HealthRecordType;

  startTime: string;        // ISO-8601
  endTime?: string;         // ISO-8601

  value?: number;
  unit?: string;

  sourceProvider: HealthProviderId;
  sourceRecordId: string;
  sourceDevice?: string;

  importedAt: string;       // ISO-8601

  /** Set by deduplication when this record duplicates another (kept for audit,
   *  excluded from totals). */
  duplicateOf?: string;
  /** Extra provider fields that don't fit value/unit (e.g. workout activity). */
  meta?: Record<string, string | number>;
}

/** Adapter implemented per provider (native plugin or cloud bridge). */
export interface HealthProviderAdapter {
  provider: HealthProviderId;

  isAvailable(): Promise<boolean>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getConnectionStatus(): Promise<ConnectionStatus>;
  getCapabilities(): Promise<HealthCapability[]>;
  /** Pull records since the ISO cursor (or the configured history range). */
  sync(since?: string): Promise<HealthSyncResult>;
}

/** Which single source feeds each Arete metric. Never sum across providers. */
export type MetricPreferenceKey =
  | 'steps'
  | 'sleep'
  | 'workouts'
  | 'recovery'   // resting HR + HRV readiness inputs
  | 'weight'
  | 'active_calories';

export type SourcePreference = HealthProviderId | 'arete' | 'auto';

export interface HealthRepository {
  /** Insert records, skipping ones whose provider+sourceRecordId already exist.
   *  Returns { added, duplicates }. */
  putRecords(records: HealthRecord[]): { added: number; duplicates: number };
  getRecords(type?: HealthRecordType, sinceISO?: string): HealthRecord[];
  markDuplicate(id: string, duplicateOf: string): void;

  getConnection(provider: HealthProviderId): ConnectionStatus | null;
  setConnection(status: ConnectionStatus): void;

  getCursor(provider: HealthProviderId): string | null;
  setCursor(provider: HealthProviderId, iso: string): void;

  getPreferences(): Record<MetricPreferenceKey, SourcePreference>;
  setPreference(metric: MetricPreferenceKey, source: SourcePreference): void;
}

/** Capacitor native plugin contract (native/ios/HealthPlugin.swift +
 *  native/android/HealthPlugin.kt). Read-only by design — no write methods. */
export interface HealthPlugin {
  isAvailable(): Promise<{ available: boolean; reason?: string }>;
  /** Ask the OS for READ permission for the given types. HealthKit does not
   *  reveal read-permission outcomes; `perType` may report 'unknown'. */
  requestPermissions(options: { types: HealthRecordType[] }): Promise<{
    granted: boolean;
    perType?: Record<string, 'granted' | 'denied' | 'unknown'>;
  }>;
  getPermissionStatus(): Promise<{
    state: 'not_requested' | 'granted' | 'partial' | 'denied' | 'unknown';
  }>;
  /** Query normalised rows. Daily aggregates for steps/distance/active_calories/
   *  heart_rate/resting_heart_rate/hrv; sessions for sleep/workout; samples for
   *  weight/body_fat. Never raw accelerometer data. */
  query(options: { type: HealthRecordType; startISO: string; endISO: string }): Promise<{
    records: Array<{
      sourceRecordId: string;
      startTime: string;
      endTime?: string;
      value?: number;
      unit?: string;
      sourceDevice?: string;
      meta?: Record<string, string | number>;
    }>;
  }>;
  /** Android: open the Health Connect settings/permissions screen. */
  openSettings(): Promise<void>;
}

// ── Phase 2 (scaffold only — requires a real backend with a database) ────────
// Proprietary provider scores are never interchangeable with each other or
// with Arete's readiness. They are stored and displayed per provider.
export interface ProviderMetric {
  provider: 'oura' | 'whoop' | 'garmin' | 'samsung_health';
  metric:
    | 'oura_readiness'
    | 'oura_sleep_score'
    | 'whoop_recovery'
    | 'whoop_strain'
    | 'garmin_body_battery'
    | 'samsung_energy_score';
  value: number;
  recordedAt: string;
}
