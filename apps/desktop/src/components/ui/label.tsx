import type { ReactNode } from "react";
import { Text } from "@radix-ui/themes";

export function Label({
  children,
  className,
  htmlFor,
}: {
  children?: ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <label htmlFor={htmlFor} className={className}>
      <Text size="2" weight="medium">
        {children}
      </Text>
    </label>
  );
}
