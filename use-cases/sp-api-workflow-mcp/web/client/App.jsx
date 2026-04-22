import React from 'react';
import { Routes, Route } from 'react-router-dom';
import WorkflowList from './WorkflowList.jsx';
import WorkflowContext from './WorkflowContext.jsx';
import WorkflowPlayer from './WorkflowPlayer.jsx';
import Settings from './Settings.jsx';

export default function App() {
  return (
    <div className="app">
      <header className="app-header">
        <nav className="app-nav">
          <a href="/">Workflows</a>
          <a href="/settings">Settings</a>
        </nav>
      </header>
      <main className="app-main">
        <Routes>
          <Route path="/" element={<WorkflowList />} />
          <Route path="/workflows/:workflowId" element={<WorkflowContext />} />
          <Route path="/run/:workflowId" element={<WorkflowPlayer />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}
