import * as React from "react";
import { Switch as ThemesSwitch } from "@radix-ui/themes";

export function Switch(
  props: React.ComponentProps<typeof ThemesSwitch>,
) {
  return <ThemesSwitch size="1" {...props} />;
}
