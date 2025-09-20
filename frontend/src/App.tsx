import type { JSX } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';

import ChatPage from './pages/Chat';
import MonitoringPage from './pages/Monitoring';
import ProfilePage from './pages/Profile';
import SettingsPage from './pages/Settings';

function App(): JSX.Element {
  const navClass = ({ isActive }: { isActive: boolean }) =>
    `relative text-sm font-medium transition-colors duration-200 ${
      isActive ? 'text-slate-100' : 'text-slate-500 hover:text-slate-300'
    }`;

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-800/60 bg-slate-950/80 px-6 py-4 backdrop-blur">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
          <span>ChatGPT 5 Thinking</span>
          <span className="text-slate-500">▾</span>
        </div>
        <nav className="flex items-center gap-6">
          <NavLink to="/chat" className={navClass}>
            Chat
          </NavLink>
          <NavLink to="/profile" className={navClass}>
            Profile
          </NavLink>
          <NavLink to="/settings" className={navClass}>
            Settings
          </NavLink>
          <NavLink to="/monitoring" className={navClass}>
            Monitoring
          </NavLink>
          <a
            className="text-sm font-medium text-slate-500 transition-colors hover:text-slate-300"
            href="/docs"
            rel="noreferrer"
          >
            API Docs
          </a>
        </nav>
        <div className="hidden text-slate-500 sm:block">⚙</div>
      </header>
      <main className="flex flex-1 flex-col">
        <Routes>
          <Route path="/" element={<Navigate to="/chat" replace />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/monitoring" element={<MonitoringPage />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
