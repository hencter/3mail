import * as React from "react";
import { Callout } from "@radix-ui/themes";

export function Alert({
  variant,
  className,
  children,
}: {
  variant?: "destructive" | "default";
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <Callout.Root
      color={variant === "destructive" ? "red" : "gray"}
      className={className}
    >
      {children}
    </Callout.Root>
  );
}

export function AlertDescription({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return <Callout.Text className={className}>{children}</Callout.Text>;
}
