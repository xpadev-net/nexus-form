import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { Providers } from "@/components/common/providers";
import { brandConfig } from "@/lib/brand-config";
import { QueryDevtools } from "./integrations/tanstack-query/devtools";
import { AppRouterProvider } from "./router";
import "./styles.css";

document.title = brandConfig.appName;

const rootElement = document.getElementById("app");
if (rootElement && !rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <StrictMode>
      <Providers>
        <AppRouterProvider />
        <QueryDevtools />
      </Providers>
    </StrictMode>,
  );
}
