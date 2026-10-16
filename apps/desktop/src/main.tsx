import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { Theme, type ThemeProps } from "@radix-ui/themes";
import App from "./App";
import { FONT_STACK, useAppearance, useResolvedMode } from "./appearance";
import "./index.css";

function Root() {
  const appearance = useAppearance();
  const mode = useResolvedMode(appearance.mode);
  useEffect(() => {
    document.documentElement.style.colorScheme = mode;
  }, [mode]);
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
      <App />
    </Theme>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
