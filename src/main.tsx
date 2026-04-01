import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app.tsx";
import { MermaidProvider } from "./components/MermaidProvider";
import "katex/dist/katex.min.css";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MermaidProvider>
      <App />
    </MermaidProvider>
  </React.StrictMode>,
);
