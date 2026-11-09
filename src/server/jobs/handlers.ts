import { anchorHandler } from "#/server/audit/anchor";

import { cleanupHandler, closuresHandler, housekeepingHandler } from "./daily";
import { emailHandler } from "./email";
import type { Handlers } from "./runner";

// Which handler runs each job type (4.11). Each handler lives next to the code it drives, and is a
// function declaration, so this object can be built while an import cycle through runner.ts is
// still loading.

export const HANDLERS: Handlers = {
  "email.send": emailHandler,
  "account.closures": closuresHandler,
  "uploads.cleanup": cleanupHandler,
  "housekeeping.expired_rows": housekeepingHandler,
  "audit.anchor": anchorHandler,
};
