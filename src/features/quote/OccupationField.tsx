import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { Button } from "#/components/actions/Button";
import { Alert } from "#/components/feedback/Alert";
import { Select } from "#/components/forms/Select";

import {
  isJobStatus,
  jobOptions,
  occupationFor,
  statusOptions,
  type EmploymentStatus,
} from "./occupation";
import { occupationsQuery } from "./occupations-query";

// Employment status, then the occupation when it's a job (5.3, call 10). Retired, unemployed,
// student and looking after the home store their own 4.8 key, so they need no second field and
// still work when the occupation list can't load.

export interface OccupationValue {
  status: EmploymentStatus | "";
  occupation: string;
}

export function OccupationField({
  value,
  onChange,
  errors,
}: {
  value: OccupationValue;
  onChange: (value: OccupationValue) => void;
  errors: { status?: string; occupation?: string };
}) {
  const { status, occupation } = value;
  const job = status !== "" && isJobStatus(status);
  const query = useQuery({ ...occupationsQuery, enabled: job });
  const options = job && query.data ? jobOptions(query.data.occupations, status) : [];
  const known = options.some((o) => o.key === occupation);

  // A stored key the list no longer has (a later version dropped it) is asked for again
  useEffect(() => {
    if (job && query.data && occupation && !known) onChange({ status, occupation: "" });
  }, [job, query.data, occupation, known, status, onChange]);

  function changeStatus(next: EmploymentStatus) {
    // A job carries over between employed and self-employed; anything else is the status's key
    const keep = isJobStatus(next) && job ? occupation : undefined;
    onChange({ status: next, occupation: occupationFor(next, keep) ?? "" });
  }

  return (
    <>
      <Select
        label="Employment status"
        placeholder="Choose a status"
        options={statusOptions}
        value={status}
        error={errors.status}
        onChange={(e) => changeStatus(e.target.value as EmploymentStatus)}
      />
      {job ? (
        <>
          <Select
            label="Occupation"
            placeholder={query.isPending ? "Loading occupations…" : "Choose an occupation"}
            options={options.map((o) => ({ value: o.key, label: o.label }))}
            value={known ? occupation : ""}
            error={errors.occupation}
            onChange={(e) => onChange({ status, occupation: e.target.value })}
          />
          {query.isError ? (
            <Alert tone="warning" announce>
              <p>We couldn&rsquo;t load the list of occupations. Try again in a moment.</p>
              <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
                Try again
              </Button>
            </Alert>
          ) : null}
        </>
      ) : null}
    </>
  );
}
