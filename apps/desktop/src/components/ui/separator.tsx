import { Separator as ThemesSeparator } from "@radix-ui/themes";

export function Separator({ className }: { className?: string }) {
  return <ThemesSeparator size="4" className={className} />;
}
