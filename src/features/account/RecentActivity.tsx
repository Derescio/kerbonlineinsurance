import { useId } from "react";

import { Icon } from "#/components/display/Icon";
import type { IconName } from "#/components/display/icons";
import { cx } from "#/lib/cx";
import type { RecentActivity as Activity } from "#/server/data/settings";

import { activityLabel, activityWhen, isWarningActivity } from "./settings-model";

// Recent activity (6.3, decision 7; Figma 06's list): the 10 newest security events, failures in
// the warning colour. The device is the stored summary ("Chrome on Windows"), never an IP.

function iconFor(type: Activity["type"]): IconName {
  if (isWarningActivity(type)) return "triangle-alert";
  if (type.startsWith("two_factor") || type === "backup_codes_regenerated") return "shield-check";
  if (type === "sign_in" || type === "sign_up") return "user";
  return "lock";
}

export function RecentActivity({ activity, now }: { activity: Activity[]; now: Date }) {
  const id = useId();
  return (
    <section className="settings__activity" aria-labelledby={id}>
      <h3 id={id} className="settings__activity-title">
        Recent activity
      </h3>
      {activity.length === 0 ? (
        <p className="settings__security-detail">No activity yet.</p>
      ) : (
        <ul aria-labelledby={id}>
          {activity.map((event, index) => (
            <li
              // Events carry no id to the page; time and place in the list are unique enough
              key={`${event.at}:${index}`}
              className={cx(
                "settings__activity-item",
                isWarningActivity(event.type) && "settings__activity--warning",
              )}
            >
              <Icon name={iconFor(event.type)} size={20} />
              <div>
                <p className="settings__activity-label">
                  {activityLabel(event.type, event.method)}
                </p>
                <p className="settings__activity-meta">
                  {event.device ?? "Unknown device"} · {activityWhen(new Date(event.at), now)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
