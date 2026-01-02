import React from "react";
import ReactDOM from "react-dom/client";
import RadiologyColombiaViewer from "./RadiologyColombiaViewer";
import "./radiology.css";

const rootElement = document.getElementById("root") as HTMLElement;

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <RadiologyColombiaViewer />
  </React.StrictMode>
);
