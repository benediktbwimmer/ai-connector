import type { JSX } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';

import ChatPage from './pages/Chat';
import MonitoringPage from './pages/Monitoring';
import ProfilePage from './pages/Profile';
import SettingsPage from './pages/Settings';
import './App.css';

function App(): JSX.Element {
  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>AI Connector</h1>
        <nav>
          <NavLink to="/chat" className={({ isActive }) => (isActive ? 'active' : '')}>
            Chat
          </NavLink>
          <NavLink to="/profile" className={({ isActive }) => (isActive ? 'active' : '')}>
            Profile
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => (isActive ? 'active' : '')}>
            Settings
          </NavLink>
          <NavLink to="/monitoring" className={({ isActive }) => (isActive ? 'active' : '')}>
            Monitoring
          </NavLink>
          <a href="/docs" rel="noreferrer">
            API Docs
          </a>
        </nav>
      </header>
      <main className="app-main">
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
