// Employment status picks the occupation (5.3, call 10). The 4.8 occupation list already holds
// the statuses that aren't jobs (retired, unemployed, student, homemaker), so those store their own
// key; employed and self-employed choose a job. The tab keeps the status too, because an employed
// and a self-employed plumber both store `plumber`. 5.6 saves only the key.

export type EmploymentStatus =
  | "employed"
  | "self_employed"
  | "retired"
  | "unemployed"
  | "student"
  | "homemaker";

export const statusOptions: { value: EmploymentStatus; label: string }[] = [
  { value: "employed", label: "Employed" },
  { value: "self_employed", label: "Self-employed" },
  { value: "retired", label: "Retired" },
  { value: "unemployed", label: "Unemployed" },
  { value: "student", label: "Student" },
  { value: "homemaker", label: "Looking after the home" },
];

/** The statuses whose occupation key is fixed; each key is in car v1 (tested there) */
export const STATUS_OCCUPATIONS = {
  retired: "retired",
  unemployed: "unemployed",
  student: "student",
  homemaker: "homemaker",
} as const;

/** Keys left out of the job list: the statuses, and "Self-employed (other)" unless self-employed */
export const HIDDEN_FROM_JOBS: readonly string[] = [
  ...Object.values(STATUS_OCCUPATIONS),
  "self_employed",
];

export type JobStatus = "employed" | "self_employed";

export function isJobStatus(status: EmploymentStatus): status is JobStatus {
  return status === "employed" || status === "self_employed";
}

/** The occupation key this status stores: its fixed key, or the chosen job */
export function occupationFor(
  status: EmploymentStatus,
  job: string | undefined,
): string | undefined {
  return isJobStatus(status) ? job : STATUS_OCCUPATIONS[status];
}

/** The status a fixed key stands for; a job key gives nothing, since it could be either */
export function statusFor(occupation: string): EmploymentStatus | undefined {
  return (Object.keys(STATUS_OCCUPATIONS) as (keyof typeof STATUS_OCCUPATIONS)[]).find(
    (status) => STATUS_OCCUPATIONS[status] === occupation,
  );
}

export interface Occupation {
  key: string;
  label: string;
}

/** The job dropdown, in the order given; self-employed also gets "Self-employed (other)", last */
export function jobOptions(all: readonly Occupation[], status: JobStatus): Occupation[] {
  const jobs = all.filter((o) => !HIDDEN_FROM_JOBS.includes(o.key));
  const other = all.find((o) => o.key === "self_employed");
  return status === "self_employed" && other ? [...jobs, other] : jobs;
}
