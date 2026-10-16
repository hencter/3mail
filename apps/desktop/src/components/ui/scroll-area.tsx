import * as React from "react";
import { ScrollArea as ThemesScrollArea } from "@radix-ui/themes";

export function ScrollArea({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <ThemesScrollArea
      type="auto"
      scrollbars="vertical"
      className={className}
      style={{ minHeight: 0 }}
    >
      {children}
    </ThemesScrollArea>
  );
}
