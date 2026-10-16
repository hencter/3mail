import * as React from "react";
import { Badge as ThemesBadge } from "@radix-ui/themes";

export function Badge({
  variant = "secondary",
  className,
  children,
}: {
  variant?: "secondary" | "outline" | "default";
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <ThemesBadge
      variant={variant === "outline" ? "outline" : "soft"}
      color="gray"
      radius="full"
      className={className}
    >
      {children}
    </ThemesBadge>
  );
}
