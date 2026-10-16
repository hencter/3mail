import * as React from "react";
import { Dialog as ThemesDialog, IconButton } from "@radix-ui/themes";
import { X } from "lucide-react";

export function Dialog({
  open,
  onOpenChange,
  children,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <ThemesDialog.Root open={open} onOpenChange={onOpenChange}>
      {children}
    </ThemesDialog.Root>
  );
}

export function DialogContent({
  className,
  style,
  children,
  showCloseButton = true,
}: {
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
  showCloseButton?: boolean;
}) {
  return (
    <ThemesDialog.Content
      className={className}
      style={{ maxWidth: "32rem", ...style }}
    >
      {showCloseButton && (
        <ThemesDialog.Close>
          <IconButton
            variant="ghost"
            color="gray"
            aria-label="Close"
            style={{ position: "absolute", top: 8, right: 8 }}
          >
            <X size={16} />
          </IconButton>
        </ThemesDialog.Close>
      )}
      {children}
    </ThemesDialog.Content>
  );
}

export function DialogHeader({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return <div className={className}>{children}</div>;
}

export function DialogTitle({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return <ThemesDialog.Title className={className}>{children}</ThemesDialog.Title>;
}

export function DialogDescription({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <ThemesDialog.Description className={className}>
      {children}
    </ThemesDialog.Description>
  );
}

export function DialogFooter({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return <div className={className ?? "flex justify-end gap-2"}>{children}</div>;
}
