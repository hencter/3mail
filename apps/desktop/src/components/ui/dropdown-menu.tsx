import * as React from "react";
import { DropdownMenu as ThemesMenu } from "@radix-ui/themes";

export function DropdownMenu({
  children,
  onOpenChange,
}: {
  children?: React.ReactNode;
  onOpenChange?: (open: boolean) => void;
}) {
  return <ThemesMenu.Root onOpenChange={onOpenChange}>{children}</ThemesMenu.Root>;
}

export function DropdownMenuTrigger({
  children,
}: {
  asChild?: boolean;
  children: React.ReactElement;
}) {
  return <ThemesMenu.Trigger>{children}</ThemesMenu.Trigger>;
}

export function DropdownMenuContent({
  align,
  side,
  children,
}: {
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  children?: React.ReactNode;
}) {
  return (
    <ThemesMenu.Content align={align} side={side} size="1" variant="soft">
      {children}
    </ThemesMenu.Content>
  );
}

export function DropdownMenuItem({
  onClick,
  shortcut,
  destructive,
  disabled,
  children,
}: {
  onClick?: () => void;
  shortcut?: string;
  destructive?: boolean;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <ThemesMenu.Item
      onSelect={() => onClick?.()}
      shortcut={shortcut}
      color={destructive ? "red" : undefined}
      disabled={disabled}
    >
      {children}
    </ThemesMenu.Item>
  );
}

export function DropdownMenuSeparator() {
  return <ThemesMenu.Separator />;
}

export function DropdownMenuLabel({ children }: { children?: React.ReactNode }) {
  return <ThemesMenu.Label>{children}</ThemesMenu.Label>;
}
