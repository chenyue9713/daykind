// The data-access boundary. Screens and server actions depend only on this
// interface, so a database-backed implementation can replace the sample one
// without touching UI code. Every implementation is scoped to one user.
import type { EveningCheckIn, MorningCheckIn } from "@/lib/domain/checkins";
import type {
  Activity,
  DateRange,
  EveningEntry,
  GoalVersion,
  LocalDate,
  SleepEntry,
  SymptomEntry,
  UserProfile,
  WeightEntry,
} from "@/lib/domain/types";

export type DataSourceKind = "sample";

export type SaveResult =
  | { status: "saved"; savedAt: string }
  /** Input was valid, but this data source does not persist writes. */
  | { status: "not_persisted"; reason: string }
  | { status: "failed"; reason: string };

export interface DayKindRepository {
  readonly kind: DataSourceKind;
  /** True when every record comes from labeled sample data. */
  readonly isSample: boolean;

  getProfile(): Promise<UserProfile>;
  getGoalVersions(): Promise<GoalVersion[]>;
  /** The civil date "today" in the user's timezone. */
  getToday(): Promise<LocalDate>;

  listSleepEntries(range: DateRange): Promise<SleepEntry[]>;
  listEveningEntries(range: DateRange): Promise<EveningEntry[]>;
  listSymptomEntries(range: DateRange): Promise<SymptomEntry[]>;
  listActivities(range: DateRange): Promise<Activity[]>;
  listWeightEntries(range: DateRange): Promise<WeightEntry[]>;

  saveMorningCheckIn(input: MorningCheckIn): Promise<SaveResult>;
  saveEveningCheckIn(input: EveningCheckIn): Promise<SaveResult>;
}
