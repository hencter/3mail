import * as React from "react";
import { TextArea } from "@radix-ui/themes";

export function Textarea(props: React.ComponentProps<typeof TextArea>) {
  return <TextArea size="2" {...props} />;
}
