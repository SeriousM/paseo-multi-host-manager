import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const pingRpc = defineRpc({
  name: "mhm.ping",
  input: z.object({}),
  output: z.object({ ok: z.literal(true) }),
});
