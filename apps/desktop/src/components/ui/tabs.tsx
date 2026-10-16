import * as React from "react";
import { Tabs as ThemesTabs } from "@radix-ui/themes";

export function Tabs({
  value,
  onValueChange,
  children,
}: {
  value?: string;
  onValueChange?: (value: string) => void;
  children?: React.ReactNode;
}) {
  return (
    <ThemesTabs.Root value={value} onValueChange={onValueChange}>
      {children}
    </ThemesTabs.Root>
  );
}

export function TabsList({
  className,
  children,
}: {
  className?: string;
  variant?: string;
  children?: React.ReactNode;
}) {
  return (
    <ThemesTabs.List className={className} style={{ width: "100%" }}>
      {children}
    </ThemesTabs.List>
  );
}

export function TabsTrigger({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <ThemesTabs.Trigger value={value} className={className}>
      {children}
    </ThemesTabs.Trigger>
  );
}
