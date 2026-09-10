import { z } from "zod";

/**
 * The two reversible things a superadmin can do to a roster row.
 *
 * Removal and deletion are not here: they arrive as DELETE with a mode, which
 * keeps the destructive pair on the verb that already means destructive rather
 * than hiding them inside a PATCH body alongside "put them back to work".
 */
export const teamMemberActionSchema = z.object({
  action: z.enum(["SUSPEND", "REINSTATE"]),
});

/**
 * Which kind of removal DELETE means.
 *
 * `remove` is the default, and deliberately so: it is the one that is always
 * available and never destroys anything, so an unqualified DELETE does the
 * survivable thing. `delete` has to be asked for by name, and is refused by the
 * service unless the account has no history behind it.
 */
export const teamMemberDeleteModeSchema = z.enum(["remove", "delete"]).default("remove");
