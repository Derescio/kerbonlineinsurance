import { Button } from "#/components/actions/Button";
import { Icon } from "#/components/display/Icon";

import { AuthShell } from "../AuthShell";
import { notYouTopBar } from "./parts";

// Staff without 2FA, on their way to /staff (Figma 12; call 14). "Log out" is in the top bar.

export function StaffGate({ onSetUp }: { onSetUp: () => void }) {
  return (
    <AuthShell
      topBar={notYouTopBar}
      title="Staff need two-factor"
      subtitle="You'll use it every time you open claims or customer details. Setting it up takes about two minutes."
      icon={
        <span className="auth__icon">
          <Icon name="shield" size={24} />
        </span>
      }
    >
      <Button variant="primary" size="lg" fullWidth onClick={onSetUp}>
        Set up two-factor
      </Button>
    </AuthShell>
  );
}
