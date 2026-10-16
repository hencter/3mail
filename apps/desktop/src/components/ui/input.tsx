import * as React from "react";
import { TextField } from "@radix-ui/themes";

export function Input(props: React.ComponentProps<typeof TextField.Root>) {
  return <TextField.Root size="2" {...props} />;
}
