import * as React from "react";
import { Button as ThemesButton } from "@radix-ui/themes";

type Variant = "default" | "outline" | "secondary" | "ghost" | "destructive" | "link";
type Size = "default" | "xs" | "sm" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg";

const variantMap: Record<Variant, React.ComponentProps<typeof ThemesButton>["variant"]> = {
  default: "solid",
  outline: "outline",
  secondary: "soft",
  ghost: "ghost",
  destructive: "solid",
  link: "ghost",
};

const sizeMap: Record<Size, React.ComponentProps<typeof ThemesButton>["size"]> = {
  default: "2",
  xs: "1",
  sm: "1",
  lg: "3",
  icon: "2",
  "icon-xs": "1",
  "icon-sm": "1",
  "icon-lg": "2",
};

const colorMap = {
  default: undefined,
  outline: "gray",
  secondary: "gray",
  ghost: "gray",
  destructive: "red",
  link: "gray",
} as const;

export function Button({
  variant = "default",
  size = "default",
  className,
  color: _htmlColor,
  ...props
}: React.ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  const icon = size.startsWith("icon");
  return (
    <ThemesButton
      variant={variantMap[variant]}
      size={sizeMap[size]}
      color={colorMap[variant]}
      className={className}
      style={icon ? { paddingInline: 0 } : undefined}
      {...props}
    />
  );
}
