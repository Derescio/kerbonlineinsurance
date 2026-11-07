import type { Tx } from "#/server/db/tx";

// The R2 hook for the immediate delete (4.7 call 17, engineering.md section 6). It runs inside the
// delete's transaction, after the audit row and before the users row goes, so a throw here rolls
// the whole delete back. A no-op until 4.10 stores files: it then removes the user's R2 objects
// and `files` rows.

export async function deleteUserFiles(_tx: Tx, _userId: string): Promise<void> {}

/** Called through this object, so a test can spy on it or make it throw */
export const filesHook = { deleteUserFiles };
