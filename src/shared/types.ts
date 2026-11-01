export type TaskType = "binary" | "count" | "duration";
export type Schedule = { kind: "daily" | "weekdays" | "once"; days: number[] };
export type Profile = {
  id: string;
  name: string;
  email: string;
  timezone: string;
};
export type TaskInput = {
  id?: string;
  revision?: number;
  title: string;
  description: string;
  type: TaskType;
  target: number;
  unit: string;
  schedule: Schedule;
  startDate: string;
  endDate: string | null;
  partyId: string | null;
  effective?: "today" | "tomorrow";
};
export type TaskView = Omit<TaskInput, "id" | "revision"> & {
  id: string;
  revision: number;
  date: string;
  value: number;
  percent: number;
  complete: boolean;
  streak: number;
  position: number;
  archived: boolean;
  partyName: string | null;
  hasPendingChanges: boolean;
};
export type TimerState = {
  taskId: string;
  title: string;
  startedAt: string;
  accountedAt: string;
};
export type PartySummary = {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  role: "owner" | "member";
  memberCount: number;
  percent: number | null;
};
export type DaySummary = {
  date: string;
  total: number;
  completed: number;
  percent: number | null;
};
export type Dashboard = {
  user: Profile;
  date: string;
  tasks: TaskView[];
  plannedTasks: TaskView[];
  timer: TimerState | null;
  parties: PartySummary[];
  summary: DaySummary;
};
export type TaskStatistic = {
  id: string;
  title: string;
  type: TaskType;
  unit: string;
  streak: number;
  total: number;
};
export type ProgressData = {
  range: "week" | "month";
  startDate: string;
  endDate: string;
  today: string;
  days: DaySummary[];
  tasks: TaskStatistic[];
  totals: { unit: string; value: number }[];
  history: TaskView[];
};
export type PartyMember = {
  id: string;
  name: string;
  timezone: string;
  date: string;
  percent: number | null;
  completed: number;
  total: number;
  tasks: TaskView[];
};
export type PartyActivity = {
  id: string;
  memberId: string;
  name: string;
  title: string;
  value: number;
  target: number;
  type: TaskType;
  unit: string;
  updatedAt: string;
};
export type InviteView = { id: string; expiresAt: string; revoked: boolean };
export type PartyDetail = PartySummary & {
  members: PartyMember[];
  activity: PartyActivity[];
  invites: InviteView[];
};
export type InvitePreview = {
  partyName: string;
  description: string;
  memberCount: number;
  expiresAt: string;
};
export type Credentials = { email: string; password: string };
export type Registration = Credentials & { name: string; timezone: string };
export type ProgressInput = {
  taskId: string;
  date: string;
  operation: "set" | "add";
  value: number;
};
export type TimerInput = { taskId: string; action: "start" | "pause" };
export type MembershipInput = {
  action: "leave" | "remove" | "transfer";
  memberId?: string;
};
export type ApiError = { error: string; field?: string };
