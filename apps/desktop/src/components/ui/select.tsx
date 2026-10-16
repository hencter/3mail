import * as React from "react";
import { Select as ThemesSelect } from "@radix-ui/themes";

export function Select({
  value,
  onValueChange,
  children,
}: {
  value?: string;
  onValueChange?: (value: string) => void;
  children?: React.ReactNode;
}) {
  return (
    <ThemesSelect.Root value={value} onValueChange={onValueChange}>
      {children}
    </ThemesSelect.Root>
  );
}

export function SelectTrigger({
  className,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return <ThemesSelect.Trigger className={className} />;
}

export function SelectValue() {
  return null;
}

export function SelectContent({ children }: { children?: React.ReactNode }) {
  return <ThemesSelect.Content>{children}</ThemesSelect.Content>;
}

export function SelectItem({
  value,
  children,
}: {
  value: string;
  children?: React.ReactNode;
}) {
  return <ThemesSelect.Item value={value}>{children}</ThemesSelect.Item>;
}
