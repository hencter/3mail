import * as React from "react";
import { Checkbox as ThemesCheckbox } from "@radix-ui/themes";

export function Checkbox(props: React.ComponentProps<typeof ThemesCheckbox>) {
  return <ThemesCheckbox {...props} />;
}
