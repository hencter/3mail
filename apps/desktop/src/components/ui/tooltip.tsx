import { Children, isValidElement, type ReactNode } from "react";
import { Tooltip as ThemesTooltip } from "@radix-ui/themes";

export function TooltipProvider({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

export function TooltipTrigger({ children }: { asChild?: boolean; children?: ReactNode }) {
  return <>{children}</>;
}

export function TooltipContent({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

export function Tooltip({ children }: { children?: ReactNode }) {
  let content: ReactNode = null;
  let trigger: ReactNode = null;
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === TooltipContent) {
      content = (child.props as { children?: ReactNode }).children;
    }
    if (child.type === TooltipTrigger) {
      trigger = (child.props as { children?: ReactNode }).children;
    }
  });
  if (!isValidElement(trigger)) return null;
  return <ThemesTooltip content={content}>{trigger}</ThemesTooltip>;
}
