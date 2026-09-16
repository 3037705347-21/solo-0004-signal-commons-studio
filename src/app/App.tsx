import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { LibraryPage } from "../features/library/LibraryPage";
import { RoutePage } from "../features/route/RoutePage";
import { QualityPage } from "../features/quality/QualityPage";
import { ScenariosPage } from "../features/scenarios/ScenariosPage";
import { SchedulePage } from "../features/schedule/SchedulePage";

export function App() {
  return (
    <BrowserRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<Navigate to="/library" replace />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/route" element={<RoutePage />} />
          <Route path="/schedule" element={<SchedulePage />} />
          <Route path="/quality" element={<QualityPage />} />
          <Route path="/scenarios" element={<ScenariosPage />} />
          <Route path="*" element={<Navigate to="/library" replace />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  );
}
