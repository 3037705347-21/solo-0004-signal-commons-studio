import {
  BookOpen,
  Boxes,
  ChevronRight,
  CircleHelp,
  Compass,
  Gauge,
  LayoutDashboard,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Sparkles,
  SunMedium,
} from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { useStudy } from "../state/StudyContext";
import { Badge } from "./Badge";
import { Button } from "./Button";

const navigation = [
  {
    to: "/library",
    label: "Signal library",
    icon: Boxes,
    detail: "Clips & metadata",
  },
  {
    to: "/route",
    label: "Listening route",
    icon: Compass,
    detail: "Sites & sequence",
  },
  {
    to: "/consent",
    label: "Consent ledger",
    icon: ShieldCheck,
    detail: "Scope & lifecycle",
  },
  {
    to: "/quality",
    label: "Quality desk",
    icon: BookOpen,
    detail: "Findings & release",
  },
  {
    to: "/scenarios",
    label: "Scenario lab",
    icon: Gauge,
    detail: "Field planning",
  },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { state, storageHealthy, resetStudy } = useStudy();
  const location = useLocation();
  const active =
    navigation.find((item) => location.pathname.startsWith(item.to)) ??
    navigation[0];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Sparkles size={17} />
          </div>
          <div>
            <div className="brand-name">Signal Commons</div>
            <div className="brand-sub">Fieldwork workspace</div>
          </div>
        </div>
        <div className="sidebar-project">
          <div className="eyebrow">ACTIVE STUDY</div>
          <div className="project-name">{state.project.title}</div>
          <div className="project-field">
            <SunMedium size={14} /> {state.project.fieldArea}
          </div>
        </div>
        <nav className="main-nav" aria-label="Main navigation">
          {navigation.map(({ to, label, icon: Icon, detail }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `nav-item ${isActive ? "active" : ""}`
              }
            >
              <Icon size={18} />
              <span>
                <strong>{label}</strong>
                <small>{detail}</small>
              </span>
              {location.pathname.startsWith(to) && (
                <ChevronRight size={15} className="nav-chevron" />
              )}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <CircleHelp size={16} />
            <span>
              <strong>Fieldwork tip</strong>
              <small>
                Keep each site's listening question visible while you place
                clips.
              </small>
            </span>
          </div>
          <div className="storage-status">
            <span
              className={`status-dot ${storageHealthy ? "online" : "offline"}`}
            />
            {storageHealthy ? "Saved locally" : "Local save unavailable"}
          </div>
          <Button
            variant="ghost"
            icon={<RotateCcw size={15} />}
            onClick={() => {
              if (window.confirm("Reset this workspace to the sample study?"))
                resetStudy();
            }}
          >
            Reset sample study
          </Button>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb">
            <LayoutDashboard size={15} />
            <span>Signal Commons</span>
            <ChevronRight size={14} />
            <strong>{active.label}</strong>
          </div>
          <div className="topbar-actions">
            <Badge
              tone={state.project.stage === "ready" ? "positive" : "warning"}
            >
              {state.project.stage === "ready"
                ? "Ready to publish"
                : "In quality review"}
            </Badge>
            <Button
              variant="ghost"
              icon={<Settings2 size={17} />}
              aria-label="Open settings"
            />
          </div>
        </header>
        <div className="page-content">{children}</div>
        <footer className="app-footer">
          <span>Signal Commons Studio · offline workspace</span>
          <span>Changes save automatically</span>
        </footer>
      </main>
    </div>
  );
}
