import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { Theme, type ThemeProps } from "@radix-ui/themes";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import { FONT_STACK, useAppearance, useResolvedMode } from "./appearance";
import { ComposeHost } from "./ComposeHost";
import { SettingsHost } from "./SettingsHost";
import "./index.css";

function windowLabel(): string {
  try {
    return getCurrentWindow().label;
  } catch {
    return "main";
  }
}

function Root() {
  const appearance = useAppearance();
  const mode = useResolvedMode(appearance.mode);
  const label = windowLabel();
  useEffect(() => {
    document.documentElement.style.colorScheme = mode;
    document.documentElement.dataset.window = label;
  }, [mode, label]);
  const font = FONT_STACK[appearance.font];
  return (
    <Theme
      appearance={mode}
      accentColor={appearance.accent as ThemeProps["accentColor"]}
      grayColor={appearance.gray as ThemeProps["grayColor"]}
      radius={appearance.radius}
      scaling={appearance.scaling}
      panelBackground="solid"
      hasBackground={false}
      style={
        {
          height: "100%",
          "--default-font-family": font,
          "--font-sans": font,
        } as React.CSSProperties
      }
    >
      {label === "compose" ? <ComposeHost /> : label === "settings" ? <SettingsHost /> : <App />}
    </Theme>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
