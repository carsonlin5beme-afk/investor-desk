import { z } from "zod";

// Bind confirmation to the name the person reviewed, including after a rename
// in another tab. Authentication and ownership are checked by each route.
export const portfolioDeleteSchema = z.object({
  name: z.string().min(1).max(80),
});
