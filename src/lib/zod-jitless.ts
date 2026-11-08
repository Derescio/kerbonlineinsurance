import { z } from "zod";

// Browser only (imported first by src/client.tsx). zod 4 probes `new Function("")` when it builds
// an object schema, and route files build theirs at load for validateSearch; the CSP has no
// 'unsafe-eval', so every page logged a script-src violation even though zod caught the throw.
// jitless skips the probe and the compiled fast path; parsing is unchanged, a little slower.
// Never on the server: Better Auth shares the server's zod instance (see validation.ts).
z.config({ jitless: true });
