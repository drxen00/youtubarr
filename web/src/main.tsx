import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router'
import './index.css'
import App from './App'
import Home from './pages/Home'
import ChannelPage from './pages/Channel'
import SeriesPage from './pages/Series'
import WatchPage from './pages/Watch'
import SettingsPage from './pages/Settings'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<App />}>
          <Route index element={<Home />} />
          <Route path="c/:channelId" element={<ChannelPage />} />
          <Route path="series/:seriesId" element={<SeriesPage />} />
          <Route path="watch/:videoId" element={<WatchPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
