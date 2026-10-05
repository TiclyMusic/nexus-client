import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/roboto-flex/full.css";
import "material-symbols/rounded.css";
import "./index.css";
import App from "./App";

// Disabilita il menu contestuale del browser (resta attivo su testo selezionabile e campi input).
document.addEventListener("contextmenu", (e) => {
  const target = e.target as HTMLElement;
  if (!target.closest("input, textarea, .selectable") && !import.meta.env.DEV) e.preventDefault();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
